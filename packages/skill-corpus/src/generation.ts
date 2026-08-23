import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertInside, assertRegularFile, assertSafeDirectory, ensureCorpusRoot, ensureSafeDirectory } from "./paths.js";
import type { ActiveGeneration, GenerationManifest, SkillSourceManifest } from "./types.js";
import { RISK_RULESET_VERSION } from "./risk.js";

export const INDEX_SCHEMA_VERSION = 3;
export const PARSER_VERSION = "2026-08-23.2";
export const RANKER_VERSION = "2026-08-23.2";

function sha256Bytes(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fsyncParentBestEffort(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(dirname(path), "r");
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is not consistently supported on Windows.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function generationName(source: { id: string; sha256: string }, riskVersion: string): string {
  const identity = sha256Bytes(`${source.sha256}\0${INDEX_SCHEMA_VERSION}\0${PARSER_VERSION}\0${riskVersion}\0${RANKER_VERSION}`);
  return `${source.id}-${identity.slice(0, 32)}`;
}

export function activePointerPath(root = ensureCorpusRoot()): string {
  return assertInside(root, resolve(root, "active.json"));
}

export function writeFileDurably(path: string, value: string, root: string, replace = false): void {
  const safePath = assertInside(root, path);
  ensureSafeDirectory(root, dirname(safePath));
  if (!replace && existsSync(safePath)) throw new Error(`Refusing to replace existing generated file: ${safePath}`);
  if (replace && existsSync(safePath)) assertRegularFile(safePath, "generated file");
  const temporary = assertInside(root, `${safePath}.${process.pid}.${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    const body = Buffer.from(value, "utf8");
    let offset = 0;
    while (offset < body.length) offset += writeSync(descriptor, body, offset, body.length - offset, offset);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, safePath);
  fsyncParentBestEffort(safePath);
}

export function writeJsonDurably(path: string, value: unknown, root: string, replace = false): void {
  writeFileDurably(path, `${JSON.stringify(value, null, 2)}\n`, root, replace);
}

export function validateGenerationManifest(value: unknown): GenerationManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Generation manifest must be an object");
  const manifest = value as GenerationManifest;
  const sha = /^[a-f0-9]{64}$/;
  if (manifest.schemaVersion !== "1.0" || !/^[a-zA-Z0-9-]{16,100}$/.test(manifest.generation)) throw new Error("Invalid generation identity");
  if (!manifest.source || !sha.test(manifest.source.sha256) || !Number.isSafeInteger(manifest.source.bytes) || manifest.source.bytes <= 0 || !Number.isSafeInteger(manifest.source.rows) || manifest.source.rows <= 0) throw new Error("Invalid generation source identity");
  if (manifest.source.compilationLicense !== "CC-BY-4.0" || manifest.source.itemLicensePolicy !== "inherit-upstream-unresolved") throw new Error("Invalid generation license policy");
  if (!manifest.implementation || manifest.implementation.indexSchemaVersion !== INDEX_SCHEMA_VERSION || manifest.implementation.parserVersion !== PARSER_VERSION || manifest.implementation.riskRulesetVersion !== RISK_RULESET_VERSION || manifest.implementation.rankerVersion !== RANKER_VERSION) throw new Error("Generation implementation version mismatch");
  if (!manifest.catalog || manifest.catalog.file !== "catalog.sqlite" || !sha.test(manifest.catalog.sha256) || manifest.catalog.canonicalDigest !== manifest.catalog.sha256 || !Number.isSafeInteger(manifest.catalog.bytes) || manifest.catalog.bytes <= 0) throw new Error("Invalid generation catalog identity");
  if (!manifest.stats || manifest.stats.file !== "stats.json" || !sha.test(manifest.stats.sha256) || !Number.isSafeInteger(manifest.stats.bytes) || manifest.stats.bytes <= 0) throw new Error("Invalid generation stats identity");
  if (manifest.safety?.trustStatus !== "quarantined" || manifest.safety.promotable !== false || manifest.safety.rawBodiesStoredInIndex !== false || manifest.safety.rawBodiesReturnedByApi !== false) throw new Error("Generation violates the quarantine boundary");
  if (!Number.isFinite(Date.parse(manifest.builtAt))) throw new Error("Invalid generation build timestamp");
  return manifest;
}

export function readGenerationManifest(directory: string, root = ensureCorpusRoot()): { manifest: GenerationManifest; bytes: Buffer; path: string } {
  const safeDirectory = assertSafeDirectory(root, directory);
  const path = assertInside(root, resolve(safeDirectory, "generation.json"));
  assertRegularFile(path, "generation manifest");
  const bytes = readFileSync(path);
  return { manifest: validateGenerationManifest(JSON.parse(bytes.toString("utf8")) as unknown), bytes, path };
}

export function activateGeneration(manifest: GenerationManifest, root = ensureCorpusRoot()): ActiveGeneration {
  const generations = assertSafeDirectory(root, resolve(root, "generations"));
  const directory = assertSafeDirectory(root, resolve(generations, manifest.generation));
  const loaded = readGenerationManifest(directory, root);
  if (loaded.manifest.generation !== manifest.generation || loaded.manifest.catalog.sha256 !== manifest.catalog.sha256) throw new Error("Published generation manifest does not match the completed build");
  const pointer: ActiveGeneration = {
    schemaVersion: "1.0",
    generation: manifest.generation,
    manifestSha256: sha256Bytes(loaded.bytes),
    activatedAt: new Date().toISOString(),
  };
  writeJsonDurably(activePointerPath(root), pointer, root, true);
  return pointer;
}

export function loadActiveGeneration(root = ensureCorpusRoot()): { pointer: ActiveGeneration; manifest: GenerationManifest; directory: string } | null {
  const path = activePointerPath(root);
  if (!existsSync(path)) return null;
  assertRegularFile(path, "active generation pointer");
  const pointer = JSON.parse(readFileSync(path, "utf8")) as ActiveGeneration;
  if (pointer.schemaVersion !== "1.0" || !/^[a-zA-Z0-9-]{16,100}$/.test(pointer.generation) || !/^[a-f0-9]{64}$/.test(pointer.manifestSha256) || !Number.isFinite(Date.parse(pointer.activatedAt))) {
    throw new Error(`Invalid active skill-corpus pointer: ${path}`);
  }
  const directory = assertSafeDirectory(root, resolve(root, "generations", pointer.generation));
  const loaded = readGenerationManifest(directory, root);
  if (loaded.manifest.generation !== pointer.generation || sha256Bytes(loaded.bytes) !== pointer.manifestSha256) throw new Error("Active generation manifest hash mismatch");
  return { pointer, manifest: loaded.manifest, directory };
}

export function assertManifestMatchesSource(manifest: GenerationManifest, source: SkillSourceManifest): void {
  if (manifest.source.id !== source.id || manifest.source.dataset !== source.dataset || manifest.source.revision !== source.revision || manifest.source.sha256 !== source.sha256 || manifest.source.bytes !== source.bytes || manifest.source.rows !== source.rows) {
    throw new Error("Generation does not match the pinned source manifest");
  }
}
