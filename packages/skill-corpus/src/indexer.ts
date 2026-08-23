import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DuckDBInstance } from "@duckdb/node-api";
import { artifactPath, assertInside, assertRegularFile, assertSafeDirectory, ensureCorpusRoot, ensureSafeDirectory } from "./paths.js";
import { deriveFacets, tokenize, weightedSearchTerms } from "./facets.js";
import { parseSkill, sha256Text, SKILL_MAX_BYTES } from "./frontmatter.js";
import {
  activateGeneration,
  assertManifestMatchesSource,
  generationName,
  INDEX_SCHEMA_VERSION,
  PARSER_VERSION,
  RANKER_VERSION,
  readGenerationManifest,
  writeJsonDurably,
} from "./generation.js";
import { acquireCorpusLock } from "./locks.js";
import { maximumSeverity, oversizedContentFinding, RISK_RULESET_VERSION, scanRisk } from "./risk.js";
import { sha256File, verifyArtifact } from "./download.js";
import type { CorpusStats, GenerationManifest, ParsedSkill, RiskSeverity, SkillDatasetRow, SkillSourceManifest } from "./types.js";

const BATCH_SIZE = 500;
const EXPECTED_COLUMNS = ["file_row_number", "content_hash", "computed_hash", "content_bytes", "repo", "path", "stars", "source", "html_url", "content_blob", "lines", "words"] as const;
const EXPECTED_SOURCE_SCHEMA = [
  ["content_hash", "VARCHAR"],
  ["repo", "VARCHAR"],
  ["path", "VARCHAR"],
  ["stars", "BIGINT"],
  ["source", "VARCHAR"],
  ["html_url", "VARCHAR"],
  ["content", "VARCHAR"],
  ["lines", "BIGINT"],
  ["words", "BIGINT"],
] as const;
const FORMAT_CONTROLS = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

function numberValue(value: unknown, label: string): number {
  const result = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(result) || Number(result) < 0) throw new Error(`Invalid ${label} in pinned source dataset: ${String(value)}`);
  return Number(result);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label} type in pinned source dataset`);
  return value;
}

function sanitizeRepository(value: string): string {
  const cleaned = value.replace(FORMAT_CONTROLS, "");
  return /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(cleaned) ? cleaned : "[invalid-repository]";
}

function sanitizePath(value: string): string {
  return value.replace(FORMAT_CONTROLS, "").replace(/\\/g, "/").slice(0, 768);
}

function sanitizeCollectionMethod(value: string): string {
  const cleaned = value.replace(FORMAT_CONTROLS, "").trim();
  return /^[A-Za-z0-9_.-]{1,32}$/.test(cleaned) ? cleaned : "unknown";
}

function sanitizeSourceUrl(value: string, repository: string): string {
  if (repository === "[invalid-repository]") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || (url.port && url.port !== "443")) return "";
    if (!url.pathname.toLocaleLowerCase("en-US").startsWith(`/${repository.toLocaleLowerCase("en-US")}/`)) return "";
    return url.toString().replace(FORMAT_CONTROLS, "").slice(0, 1200);
  } catch {
    return "";
  }
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA trusted_schema = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -65536;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE skills (
      row_id INTEGER PRIMARY KEY,
      content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
      normalized_hash TEXT NOT NULL CHECK (length(normalized_hash) = 64),
      routing_metadata_hash TEXT NOT NULL CHECK (length(routing_metadata_hash) = 64),
      declared_license_hash TEXT,
      source_id TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      first_dataset_row INTEGER NOT NULL,
      repository TEXT NOT NULL,
      path TEXT NOT NULL,
      source_url TEXT NOT NULL,
      stars INTEGER NOT NULL,
      collection_method TEXT NOT NULL,
      lines INTEGER NOT NULL,
      words INTEGER NOT NULL,
      content_bytes INTEGER NOT NULL,
      frontmatter_bytes INTEGER NOT NULL,
      parse_status TEXT NOT NULL,
      license_status TEXT NOT NULL CHECK (license_status = 'unknown'),
      trust_status TEXT NOT NULL CHECK (trust_status = 'quarantined'),
      promotable INTEGER NOT NULL CHECK (promotable = 0),
      risk_severity TEXT NOT NULL,
      risk_count INTEGER NOT NULL,
      risk_json TEXT NOT NULL,
      facets_json TEXT NOT NULL
    );
    CREATE TABLE occurrences (
      source_id TEXT NOT NULL,
      dataset_row INTEGER NOT NULL,
      skill_row_id INTEGER NOT NULL REFERENCES skills(row_id),
      repository TEXT NOT NULL,
      path TEXT NOT NULL,
      source_url TEXT NOT NULL,
      PRIMARY KEY (source_id, dataset_row)
    ) WITHOUT ROWID;
    CREATE TABLE risk_findings (
      skill_row_id INTEGER NOT NULL REFERENCES skills(row_id),
      rule_id TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      line INTEGER,
      evidence_hash TEXT NOT NULL,
      PRIMARY KEY (skill_row_id, rule_id)
    ) WITHOUT ROWID;
    CREATE TABLE skill_facets (
      facet TEXT NOT NULL,
      skill_row_id INTEGER NOT NULL REFERENCES skills(row_id),
      PRIMARY KEY (facet, skill_row_id)
    ) WITHOUT ROWID;
    CREATE TABLE postings (
      token TEXT NOT NULL,
      skill_row_id INTEGER NOT NULL REFERENCES skills(row_id),
      weight INTEGER NOT NULL,
      PRIMARY KEY (token, skill_row_id)
    ) WITHOUT ROWID;
    CREATE TABLE token_stats (
      token TEXT PRIMARY KEY,
      document_frequency INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE rejects (
      source_id TEXT NOT NULL,
      dataset_row INTEGER NOT NULL,
      claimed_hash TEXT NOT NULL,
      repository TEXT NOT NULL,
      path TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (source_id, dataset_row)
    ) WITHOUT ROWID;
  `);
}

function setMeta(db: DatabaseSync, key: string, value: string | number): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
}

function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function initializeBuild(db: DatabaseSync, source: SkillSourceManifest): void {
  setMeta(db, "index_schema", INDEX_SCHEMA_VERSION);
  setMeta(db, "parser_version", PARSER_VERSION);
  setMeta(db, "risk_ruleset", RISK_RULESET_VERSION);
  setMeta(db, "ranker_version", RANKER_VERSION);
  setMeta(db, "source_id", source.id);
  setMeta(db, "source_revision", source.revision);
  setMeta(db, "source_sha256", source.sha256);
  setMeta(db, "expected_rows", source.rows);
  setMeta(db, "trust_status", "quarantined");
  setMeta(db, "raw_bodies_stored", "false");
}

function scalar(db: DatabaseSync, sql: string, ...parameters: Array<string | number>): number {
  return Number((db.prepare(sql).get(...parameters) as { value: number }).value);
}

function buildStatsBase(db: DatabaseSync, source: SkillSourceManifest, builtAt: string): Omit<CorpusStats, "catalogBytes" | "catalogSha256" | "canonicalDigest"> {
  const parseStatuses: ParsedSkill["status"][] = ["valid", "missing-frontmatter", "missing-required-fields", "invalid-frontmatter", "oversized", "invalid-text"];
  const riskStatuses: Array<RiskSeverity | "none"> = ["none", "low", "medium", "high", "critical"];
  const parseStatus = Object.fromEntries(parseStatuses.map((status) => [status, scalar(db, "SELECT COUNT(*) AS value FROM skills WHERE parse_status = ?", status)])) as CorpusStats["parseStatus"];
  const heuristicRisk = Object.fromEntries(riskStatuses.map((status) => [status, scalar(db, "SELECT COUNT(*) AS value FROM skills WHERE risk_severity = ?", status)])) as CorpusStats["heuristicRisk"];
  const occurrences = scalar(db, "SELECT COUNT(*) AS value FROM occurrences");
  const uniqueSkills = scalar(db, "SELECT COUNT(*) AS value FROM skills");
  const rejected = scalar(db, "SELECT COUNT(*) AS value FROM rejects");
  return {
    schemaVersion: "1.0",
    sourceId: source.id,
    sourceRevision: source.revision,
    sourceSha256: source.sha256,
    compilationLicense: source.compilationLicense,
    itemLicensePolicy: source.itemLicensePolicy,
    expectedRows: source.rows,
    rowsSeen: occurrences + rejected,
    occurrencesIndexed: occurrences,
    uniqueSkills,
    duplicateOccurrences: occurrences - uniqueSkills,
    rowsRejected: rejected,
    hashMismatches: scalar(db, "SELECT COUNT(*) AS value FROM rejects WHERE reason = 'content-hash-mismatch'"),
    parseStatus,
    heuristicRisk,
    quarantined: scalar(db, "SELECT COUNT(*) AS value FROM skills WHERE trust_status = 'quarantined'"),
    unknownLicense: scalar(db, "SELECT COUNT(*) AS value FROM skills WHERE license_status = 'unknown'"),
    tokenPostings: scalar(db, "SELECT COUNT(*) AS value FROM postings"),
    uniqueTokens: scalar(db, "SELECT COUNT(*) AS value FROM token_stats"),
    sourceContentBytes: scalar(db, "SELECT COALESCE(SUM(content_bytes), 0) AS value FROM skills"),
    builtAt,
  };
}

function validateStats(stats: CorpusStats, source: SkillSourceManifest): void {
  if (stats.schemaVersion !== "1.0" || stats.sourceId !== source.id || stats.sourceRevision !== source.revision || stats.sourceSha256 !== source.sha256 || stats.expectedRows !== source.rows) throw new Error("Generation stats do not match the pinned source");
  if (stats.rowsSeen !== source.rows || stats.occurrencesIndexed + stats.rowsRejected !== source.rows) throw new Error("Generation row-accounting invariant failed");
  if (stats.uniqueSkills + stats.duplicateOccurrences !== stats.occurrencesIndexed || stats.quarantined !== stats.uniqueSkills || stats.unknownLicense !== stats.uniqueSkills) throw new Error("Generation quarantine/deduplication invariant failed");
  if (!/^[a-f0-9]{64}$/.test(stats.catalogSha256) || stats.canonicalDigest !== stats.catalogSha256) throw new Error("Generation stats contain invalid digests");
}

function sqliteIntegrity(db: DatabaseSync): void {
  const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
  if (result.integrity_check !== "ok") throw new Error(`Catalog integrity check failed: ${result.integrity_check}`);
}

export async function verifyCompletedGeneration(directory: string, source: SkillSourceManifest, root = ensureCorpusRoot()): Promise<{ manifest: GenerationManifest; stats: CorpusStats }> {
  const safeDirectory = assertSafeDirectory(root, directory);
  const { manifest } = readGenerationManifest(safeDirectory, root);
  assertManifestMatchesSource(manifest, source);
  if (manifest.generation !== basename(safeDirectory) || manifest.implementation.riskRulesetVersion !== RISK_RULESET_VERSION) throw new Error("Generation implementation identity mismatch");

  const catalogPath = assertInside(root, resolve(safeDirectory, manifest.catalog.file));
  const statsPath = assertInside(root, resolve(safeDirectory, manifest.stats.file));
  const catalogStat = assertRegularFile(catalogPath, "skill catalog");
  const statsStat = assertRegularFile(statsPath, "skill catalog stats");
  if (catalogStat.size !== manifest.catalog.bytes || statsStat.size !== manifest.stats.bytes) throw new Error("Generation file-size mismatch");
  const [catalogHash, statsHash] = await Promise.all([sha256File(catalogPath), sha256File(statsPath)]);
  if (catalogHash !== manifest.catalog.sha256 || statsHash !== manifest.stats.sha256) throw new Error("Generation file hash mismatch");
  const stats = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(statsPath, "utf8"))) as CorpusStats;
  validateStats(stats, source);
  if (stats.catalogBytes !== manifest.catalog.bytes || stats.catalogSha256 !== manifest.catalog.sha256 || stats.canonicalDigest !== manifest.catalog.canonicalDigest) throw new Error("Generation manifest/stats mismatch");

  const db = new DatabaseSync(catalogPath, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;");
    sqliteIntegrity(db);
    if (getMeta(db, "source_sha256") !== source.sha256 || getMeta(db, "raw_bodies_stored") !== "false") throw new Error("Catalog metadata mismatch");
  } finally {
    db.close();
  }
  return { manifest, stats };
}

function fsyncDirectoryBestEffort(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is not consistently available on Windows.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function cleanupOwnedStage(stage: string, generations: string): void {
  const safe = assertInside(generations, stage);
  if (!basename(safe).startsWith(".staging-")) throw new Error(`Refusing to clean unexpected generation path: ${safe}`);
  if (!existsSync(safe)) return;
  const stat = lstatSync(safe);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing to clean unsafe staging path: ${safe}`);
  rmSync(safe, { recursive: true, force: false });
}

export async function buildSkillIndex(
  source: SkillSourceManifest,
  options: { projectRoot?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ directory: string; stats: CorpusStats; reused: boolean }> {
  const root = ensureCorpusRoot(options.projectRoot);
  const releaseLock = acquireCorpusLock(root, "index");
  let stage = "";
  try {
    const sourcePath = artifactPath(source, root);
    await verifyArtifact(sourcePath, source);
    const name = generationName(source, RISK_RULESET_VERSION);
    const generations = ensureSafeDirectory(root, resolve(root, "generations"));
    const finalDirectory = assertInside(root, resolve(generations, name));
    if (existsSync(finalDirectory)) {
      const completed = await verifyCompletedGeneration(finalDirectory, source, root);
      activateGeneration(completed.manifest, root);
      return { directory: finalDirectory, stats: completed.stats, reused: true };
    }

    stage = ensureSafeDirectory(root, resolve(generations, `.staging-${randomUUID()}`));
    const databasePath = assertInside(root, resolve(stage, "catalog.sqlite"));
    const duckTemp = ensureSafeDirectory(root, resolve(stage, "duckdb-temp"));
    const db = new DatabaseSync(databasePath);
    let duck: DuckDBInstance | undefined;
    let connection: Awaited<ReturnType<DuckDBInstance["connect"]>> | undefined;
    let processed = 0;
    try {
      assertRegularFile(databasePath, "new skill catalog");
      createSchema(db);
      initializeBuild(db, source);

      const insertSkill = db.prepare(`INSERT INTO skills (
        content_hash, normalized_hash, routing_metadata_hash, declared_license_hash, source_id, source_revision, first_dataset_row,
        repository, path, source_url, stars, collection_method, lines, words, content_bytes, frontmatter_bytes, parse_status,
        license_status, trust_status, promotable, risk_severity, risk_count, risk_json, facets_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'quarantined', 0, ?, ?, ?, ?)`);
      const findSkill = db.prepare("SELECT row_id FROM skills WHERE content_hash = ?");
      const insertOccurrence = db.prepare("INSERT INTO occurrences (source_id, dataset_row, skill_row_id, repository, path, source_url) VALUES (?, ?, ?, ?, ?, ?)");
      const insertRisk = db.prepare("INSERT INTO risk_findings (skill_row_id, rule_id, category, severity, line, evidence_hash) VALUES (?, ?, ?, ?, ?, ?)");
      const insertFacet = db.prepare("INSERT INTO skill_facets (facet, skill_row_id) VALUES (?, ?)");
      const insertPosting = db.prepare("INSERT INTO postings (token, skill_row_id, weight) VALUES (?, ?, ?)");
      const insertReject = db.prepare("INSERT INTO rejects (source_id, dataset_row, claimed_hash, repository, path, reason) VALUES (?, ?, ?, ?, ?, ?)");

      duck = await DuckDBInstance.create(":memory:", {
        threads: "1",
        memory_limit: "512MB",
        max_temp_directory_size: "1GB",
        temp_directory: duckTemp,
        preserve_insertion_order: "true",
        autoinstall_known_extensions: "false",
        autoload_known_extensions: "false",
      });
      connection = await duck.connect();
      const schemaReader = await connection.runAndReadAll(`
        SELECT column_id, name, duckdb_type
        FROM parquet_schema($artifact)
        WHERE column_id <> 0
        ORDER BY column_id
      `, { artifact: sourcePath });
      const schemaRows = schemaReader.getRowObjectsJS() as Array<{ column_id: number | bigint; name: string; duckdb_type: string }>;
      if (schemaRows.length !== EXPECTED_SOURCE_SCHEMA.length || schemaRows.some((row, index) => {
        const expected = EXPECTED_SOURCE_SCHEMA[index];
        return !expected || Number(row.column_id) !== index + 1 || row.name !== expected[0] || row.duckdb_type !== expected[1];
      })) throw new Error("Pinned Parquet schema does not match the SkillMD source contract");
      const metadataReader = await connection.runAndReadAll(`
        SELECT num_rows, num_row_groups, file_size_bytes
        FROM parquet_file_metadata($artifact)
      `, { artifact: sourcePath });
      const metadataRows = metadataReader.getRowObjectsJS() as Array<{ num_rows: number | bigint; num_row_groups: number | bigint; file_size_bytes: number | bigint }>;
      if (metadataRows.length !== 1 || Number(metadataRows[0]?.num_rows) !== source.rows || Number(metadataRows[0]?.num_row_groups) !== 1 || Number(metadataRows[0]?.file_size_bytes) !== source.bytes) {
        throw new Error("Pinned Parquet physical metadata does not match the source manifest");
      }
      const result = await connection.stream(`
        SELECT file_row_number,
               content_hash,
               sha256(content) AS computed_hash,
               octet_length(encode(content)) AS content_bytes,
               repo, path, stars, "source", html_url,
               CASE WHEN octet_length(encode(content)) <= ${SKILL_MAX_BYTES} THEN encode(content) ELSE NULL END AS content_blob,
               lines, words
        FROM read_parquet($artifact, file_row_number = true)
      `, { artifact: sourcePath });
      const actualColumns = result.columnNames();
      if (actualColumns.length !== EXPECTED_COLUMNS.length || actualColumns.some((column, index) => column !== EXPECTED_COLUMNS[index])) throw new Error(`Unexpected Parquet projection: ${actualColumns.join(", ")}`);

      db.exec("BEGIN IMMEDIATE");
      try {
        for await (const chunk of result.yieldRowObjectJs()) {
          for (const rawRow of chunk) {
            const row = rawRow as unknown as SkillDatasetRow;
            const datasetRow = numberValue(row.file_row_number, "file_row_number");
            if (datasetRow >= source.rows) throw new Error(`Source row number exceeds pinned bound: ${datasetRow}`);
            const claimedHash = stringValue(row.content_hash, "content_hash").toLocaleLowerCase("en-US");
            const computedHash = stringValue(row.computed_hash, "computed_hash").toLocaleLowerCase("en-US");
            const contentBytes = numberValue(row.content_bytes, "content_bytes");
            const repository = sanitizeRepository(stringValue(row.repo, "repo"));
            const path = sanitizePath(stringValue(row.path, "path"));
            const sourceUrl = sanitizeSourceUrl(stringValue(row.html_url, "html_url"), repository);
            if (!/^[a-f0-9]{64}$/.test(claimedHash) || !/^[a-f0-9]{64}$/.test(computedHash) || computedHash !== claimedHash) {
              insertReject.run(source.id, datasetRow, claimedHash.slice(0, 64), repository, path, "content-hash-mismatch");
            } else {
              // Validate the byte projection before decoding. The DuckDB Node text
              // converter strips a leading UTF-8 BOM from some otherwise valid rows.
              const contentBlob = row.content_blob;
              const contentBuffer = contentBlob instanceof Uint8Array ? Buffer.from(contentBlob) : null;
              const boundedContentMissing = contentBuffer === null && contentBytes <= SKILL_MAX_BYTES;
              const projectedBytesMismatch = contentBuffer !== null && contentBuffer.length !== contentBytes;
              const projectedHashMismatch = contentBuffer !== null && createHash("sha256").update(contentBuffer).digest("hex") !== computedHash;
              const content = contentBuffer?.toString("utf8") ?? null;
              const decodedTextMismatch = contentBuffer !== null && !Buffer.from(content!, "utf8").equals(contentBuffer);
              if ((contentBlob !== null && contentBuffer === null) || boundedContentMissing || projectedBytesMismatch || projectedHashMismatch || decodedTextMismatch) {
                insertReject.run(source.id, datasetRow, claimedHash, repository, path, "content-projection-mismatch");
                processed += 1;
                if (processed % BATCH_SIZE === 0) {
                  db.exec("COMMIT; BEGIN IMMEDIATE");
                  options.onProgress?.(processed, source.rows);
                }
                continue;
              }
              const prior = findSkill.get(computedHash) as { row_id: number } | undefined;
              let skillRowId = prior?.row_id;
              if (!skillRowId) {
                const parsed: ParsedSkill = content === null
                  ? { status: "oversized", name: null, description: null, compatibility: null, declaredLicense: null, headings: [], frontmatterBytes: 0, normalizedHash: computedHash }
                  : parseSkill(content);
                const findings = content === null ? [oversizedContentFinding(contentBytes)] : scanRisk(content);
                const riskSeverity = maximumSeverity(findings);
                const metadataText = parsed.status === "valid"
                  ? [parsed.name, parsed.description, parsed.compatibility, ...parsed.headings, repository, path].filter(Boolean).join(" ")
                  : `${repository} ${path}`;
                const facets = deriveFacets(tokenize(metadataText));
                const routingMetadataHash = sha256Text(JSON.stringify({ name: parsed.name, description: parsed.description, compatibility: parsed.compatibility, headings: parsed.headings }));
                const result = insertSkill.run(
                  computedHash,
                  parsed.normalizedHash,
                  routingMetadataHash,
                  parsed.declaredLicense ? sha256Text(parsed.declaredLicense) : null,
                  source.id,
                  source.revision,
                  datasetRow,
                  repository,
                  path,
                  sourceUrl,
                  numberValue(row.stars, "stars"),
                  sanitizeCollectionMethod(stringValue(row.source, "source")),
                  numberValue(row.lines, "lines"),
                  numberValue(row.words, "words"),
                  contentBytes,
                  parsed.frontmatterBytes,
                  parsed.status,
                  riskSeverity,
                  findings.length,
                  JSON.stringify(findings),
                  JSON.stringify(facets),
                );
                skillRowId = Number(result.lastInsertRowid);
                for (const finding of findings) insertRisk.run(skillRowId, finding.ruleId, finding.category, finding.severity, finding.line, finding.evidenceHash);
                for (const facet of facets) insertFacet.run(facet, skillRowId);
                const terms = weightedSearchTerms({
                  name: parsed.status === "valid" ? parsed.name : null,
                  description: parsed.status === "valid" ? parsed.description : null,
                  compatibility: parsed.status === "valid" ? parsed.compatibility : null,
                  headings: parsed.status === "valid" ? parsed.headings : [],
                  repository,
                  path,
                  facets,
                });
                for (const [token, weight] of terms) insertPosting.run(token, skillRowId, weight);
              }
              insertOccurrence.run(source.id, datasetRow, skillRowId, repository, path, sourceUrl);
            }
            processed += 1;
            if (processed % BATCH_SIZE === 0) {
              db.exec("COMMIT; BEGIN IMMEDIATE");
              options.onProgress?.(processed, source.rows);
            }
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* The active batch may already have rolled back. */ }
        throw error;
      }
      options.onProgress?.(processed, source.rows);
      if (processed !== source.rows) throw new Error(`Parquet scan returned ${processed} rows instead of ${source.rows}`);

      connection.disconnectSync();
      connection = undefined;
      duck.closeSync();
      duck = undefined;

      db.exec(`
        INSERT INTO token_stats (token, document_frequency)
          SELECT postings.token, COUNT(*)
          FROM postings
          JOIN skills ON skills.row_id = postings.skill_row_id
          WHERE skills.parse_status = 'valid'
          GROUP BY postings.token;
        CREATE INDEX skills_search_filter ON skills(parse_status, risk_severity, row_id);
        CREATE INDEX skills_stars ON skills(stars DESC, row_id);
        CREATE INDEX occurrences_skill ON occurrences(skill_row_id);
        ANALYZE;
      `);
      sqliteIntegrity(db);
      const builtAt = new Date().toISOString();
      const baseStats = buildStatsBase(db, source, builtAt);
      if (baseStats.rowsSeen !== source.rows || baseStats.occurrencesIndexed + baseStats.rowsRejected !== source.rows) throw new Error("Final source accounting invariant failed");
      db.exec("PRAGMA optimize; VACUUM;");
      sqliteIntegrity(db);
      db.close();

      await verifyArtifact(sourcePath, source);
      const catalogBytes = assertRegularFile(databasePath, "completed skill catalog").size;
      const catalogSha256 = await sha256File(databasePath);
      const stats: CorpusStats = { ...baseStats, catalogBytes, catalogSha256, canonicalDigest: catalogSha256 };
      validateStats(stats, source);
      const statsPath = assertInside(root, resolve(stage, "stats.json"));
      writeJsonDurably(statsPath, stats, root);
      const statsBytes = assertRegularFile(statsPath, "skill catalog stats").size;
      const statsSha256 = await sha256File(statsPath);
      const manifest: GenerationManifest = {
        schemaVersion: "1.0",
        generation: name,
        source: {
          id: source.id,
          dataset: source.dataset,
          revision: source.revision,
          sha256: source.sha256,
          bytes: source.bytes,
          rows: source.rows,
          compilationLicense: source.compilationLicense,
          itemLicensePolicy: source.itemLicensePolicy,
        },
        implementation: {
          indexSchemaVersion: INDEX_SCHEMA_VERSION,
          parserVersion: PARSER_VERSION,
          riskRulesetVersion: RISK_RULESET_VERSION,
          rankerVersion: RANKER_VERSION,
        },
        catalog: { file: "catalog.sqlite", bytes: catalogBytes, sha256: catalogSha256, canonicalDigest: catalogSha256 },
        stats: { file: "stats.json", bytes: statsBytes, sha256: statsSha256 },
        safety: { trustStatus: "quarantined", promotable: false, rawBodiesStoredInIndex: false, rawBodiesReturnedByApi: false },
        builtAt,
      };
      writeJsonDurably(assertInside(root, resolve(stage, "generation.json")), manifest, root);
      rmSync(duckTemp, { recursive: true, force: false });
      fsyncDirectoryBestEffort(stage);
      if (existsSync(finalDirectory)) throw new Error(`Generation appeared concurrently despite index lock: ${finalDirectory}`);
      renameSync(stage, finalDirectory);
      stage = "";
      fsyncDirectoryBestEffort(generations);
      const verified = await verifyCompletedGeneration(finalDirectory, source, root);
      activateGeneration(verified.manifest, root);
      return { directory: finalDirectory, stats: verified.stats, reused: false };
    } finally {
      try { connection?.disconnectSync(); } catch { /* best effort */ }
      try { duck?.closeSync(); } catch { /* best effort */ }
      try { db.close(); } catch { /* already closed */ }
    }
  } catch (error) {
    if (stage) {
      const generations = assertSafeDirectory(root, resolve(root, "generations"));
      cleanupOwnedStage(stage, generations);
    }
    throw error;
  } finally {
    releaseLock();
  }
}
