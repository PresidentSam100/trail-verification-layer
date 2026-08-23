import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tokenize } from "./facets.js";
import { assertInside, assertRegularFile, assertSafeDirectory, ensureCorpusRoot } from "./paths.js";
import { loadActiveGeneration, readGenerationManifest } from "./generation.js";
import type { CorpusStats, IndexedSkillSummary, RiskSeverity } from "./types.js";
import { severityRank } from "./risk.js";

const WARNING = "UNTRUSTED RESEARCH METADATA — not an approved skill, instruction, plan, or runtime route";

type SearchRow = {
  content_hash: string;
  repository: string;
  path: string;
  source_url: string;
  stars: number;
  parse_status: IndexedSkillSummary["parseStatus"];
  risk_severity: RiskSeverity | "none";
  risk_count: number;
  facets_json: string;
  matched_terms: string;
  score: number;
};

type InspectRow = {
  content_hash: string;
  normalized_hash: string;
  routing_metadata_hash: string;
  declared_license_hash: string | null;
  source_id: string;
  source_revision: string;
  first_dataset_row: number;
  repository: string;
  path: string;
  source_url: string;
  stars: number;
  collection_method: string;
  lines: number;
  words: number;
  content_bytes: number;
  frontmatter_bytes: number;
  parse_status: IndexedSkillSummary["parseStatus"];
  risk_severity: RiskSeverity | "none";
  risk_count: number;
  risk_json: string;
  facets_json: string;
  occurrence_count: number;
};

function parseStringArray(value: string, label: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error(`Invalid ${label} in skill catalog`);
  return parsed;
}

function sha256FileSync(path: string): string {
  assertRegularFile(path, "generated file");
  const descriptor = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
  try {
    let position = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, buffer.length, position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

export class SkillCatalog {
  readonly db: DatabaseSync;
  readonly directory: string;
  readonly root: string;

  constructor(directory?: string, root = ensureCorpusRoot()) {
    this.root = root;
    const active = directory ? null : loadActiveGeneration(root);
    const candidate = directory ?? active?.directory;
    if (!candidate) throw new Error("No active skill corpus. Run `pnpm skills sync` and `pnpm skills index` first.");
    this.directory = assertSafeDirectory(root, candidate);
    const { manifest } = readGenerationManifest(this.directory, root);
    const databasePath = assertInside(root, resolve(this.directory, manifest.catalog.file));
    const stat = assertRegularFile(databasePath, "skill catalog");
    if (stat.size !== manifest.catalog.bytes) throw new Error("Skill catalog size no longer matches its generation manifest");
    if (sha256FileSync(databasePath) !== manifest.catalog.sha256) throw new Error("Skill catalog hash no longer matches its generation manifest");
    this.db = new DatabaseSync(databasePath, { readOnly: true });
    this.db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON;");
  }

  close(): void {
    this.db.close();
  }

  stats(): CorpusStats {
    const path = assertInside(this.root, resolve(this.directory, "stats.json"));
    const { manifest } = readGenerationManifest(this.directory, this.root);
    const stat = assertRegularFile(path, "skill catalog stats");
    if (stat.size !== manifest.stats.bytes || sha256FileSync(path) !== manifest.stats.sha256) throw new Error("Skill catalog stats no longer match their generation manifest");
    return JSON.parse(readFileSync(path, "utf8")) as CorpusStats;
  }

  search(
    query: string,
    limit = 20,
    maxRisk: RiskSeverity | "none" = "medium",
  ): {
    warning: string;
    mode: "quarantined-derived-metadata";
    authoritative: false;
    rawBodiesIncluded: false;
    queryTerms: string[];
    results: IndexedSkillSummary[];
  } {
    if (typeof query !== "string" || query.length > 4096) throw new Error("Search query must be at most 4096 characters");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Search limit must be an integer from 1 to 100");
    if (!(new Set(["none", "low", "medium", "high", "critical"]) as Set<string>).has(maxRisk)) throw new Error("Invalid maximum risk severity");
    const terms = tokenize(query).slice(0, 16);
    const empty = { warning: WARNING, mode: "quarantined-derived-metadata" as const, authoritative: false as const, rawBodiesIncluded: false as const, queryTerms: terms, results: [] as IndexedSkillSummary[] };
    if (terms.length === 0) return empty;

    const total = Number((this.db.prepare("SELECT COUNT(*) AS count FROM skills WHERE parse_status = 'valid'").get() as { count: number }).count);
    const termStats = this.db.prepare("SELECT document_frequency FROM token_stats WHERE token = ?");
    const weightedTerms = terms.flatMap((term) => {
      const row = termStats.get(term) as { document_frequency: number } | undefined;
      if (!row) return [];
      return [{ term, idf: Math.log((total + 1) / (Number(row.document_frequency) + 1)) + 1 }];
    });
    if (weightedTerms.length === 0) return empty;

    const values = weightedTerms.map(() => "(?, ?)").join(", ");
    const parameters: Array<string | number> = weightedTerms.flatMap(({ term, idf }) => [term, idf]);
    parameters.push(severityRank(maxRisk), weightedTerms.length, limit);
    const rows = this.db.prepare(`
      WITH query_terms(token, idf) AS (VALUES ${values}),
      scored AS (
        SELECT p.skill_row_id,
               SUM(p.weight * q.idf) AS raw_score,
               COUNT(*) AS matched_count,
               GROUP_CONCAT(q.token, char(31)) AS matched_terms
        FROM query_terms q
        JOIN postings p ON p.token = q.token
        JOIN skills filtered ON filtered.row_id = p.skill_row_id
        WHERE filtered.parse_status = 'valid'
          AND CASE filtered.risk_severity
            WHEN 'none' THEN 0 WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 ELSE 99 END <= ?
        GROUP BY p.skill_row_id
      )
      SELECT s.content_hash, s.repository, s.path, s.source_url, s.stars, s.parse_status,
             s.risk_severity, s.risk_count, s.facets_json, scored.matched_terms,
             scored.raw_score * (0.5 + 0.5 * (1.0 * scored.matched_count / ?)) AS score
      FROM scored JOIN skills s ON s.row_id = scored.skill_row_id
      ORDER BY score DESC, s.stars DESC, s.content_hash ASC
      LIMIT ?
    `).all(...parameters) as SearchRow[];

    return {
      warning: WARNING,
      mode: "quarantined-derived-metadata",
      authoritative: false,
      rawBodiesIncluded: false,
      queryTerms: terms,
      results: rows.map((row) => ({
        id: row.content_hash,
        repository: row.repository,
        path: row.path,
        sourceUrl: row.source_url,
        stars: Number(row.stars),
        parseStatus: row.parse_status,
        licenseStatus: "unknown",
        trustStatus: "quarantined",
        promotable: false,
        heuristicRiskSeverity: row.risk_severity,
        heuristicRiskCount: Number(row.risk_count),
        facets: parseStringArray(row.facets_json, "facets"),
        matchedTerms: row.matched_terms ? row.matched_terms.split("\u001F").sort() : [],
        score: Number(Number(row.score).toFixed(4)),
      })),
    };
  }

  inspect(contentHash: string): Record<string, unknown> {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Skill id must be a full SHA-256 hash");
    const row = this.db.prepare(`
      SELECT s.*, (SELECT COUNT(*) FROM occurrences o WHERE o.skill_row_id = s.row_id) AS occurrence_count
      FROM skills s WHERE s.content_hash = ?
    `).get(contentHash) as InspectRow | undefined;
    if (!row) throw new Error(`Unknown skill id: ${contentHash}`);
    return {
      warning: WARNING,
      mode: "quarantined-derived-metadata",
      authoritative: false,
      rawBodyAvailableThroughApi: false,
      id: row.content_hash,
      normalizedHash: row.normalized_hash,
      routingMetadataHash: row.routing_metadata_hash,
      declaredLicenseHash: row.declared_license_hash,
      source: {
        id: row.source_id,
        revision: row.source_revision,
        firstDatasetRow: Number(row.first_dataset_row),
        occurrences: Number(row.occurrence_count),
        repository: row.repository,
        path: row.path,
        url: row.source_url,
        method: row.collection_method,
        stars: Number(row.stars),
      },
      shape: {
        bytes: Number(row.content_bytes),
        lines: Number(row.lines),
        words: Number(row.words),
        frontmatterBytes: Number(row.frontmatter_bytes),
        parseStatus: row.parse_status,
      },
      safety: {
        trustStatus: "quarantined",
        licenseStatus: "unknown",
        promotable: false,
        heuristicOnly: true,
        heuristicRiskSeverity: row.risk_severity,
        findings: JSON.parse(row.risk_json) as unknown[],
      },
      facets: parseStringArray(row.facets_json, "facets"),
    };
  }
}
