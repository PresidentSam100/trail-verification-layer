import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { SkillSourceManifest } from "./types.js";
import { assertInside, sourceManifestRoot } from "./paths.js";

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SAFE_DATASET = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SAFE_ARTIFACT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.parquet$/;
const SAFE_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function validateSourceManifest(value: unknown, expectedId?: string): SkillSourceManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Source manifest must be an object");
  const source = value as Partial<SkillSourceManifest>;
  if (source.schemaVersion !== "1.0" || source.kind !== "huggingface-parquet") throw new Error("Unsupported source manifest schema or kind");
  if (!SAFE_ID.test(source.id ?? "") || (expectedId && source.id !== expectedId)) throw new Error("Invalid source id");
  if (!SAFE_DATASET.test(source.dataset ?? "")) throw new Error("Invalid dataset id");
  if (!REVISION.test(source.revision ?? "") || !SHA256.test(source.sha256 ?? "")) throw new Error("Invalid pinned source identity");
  if (!SAFE_ARTIFACT.test(source.artifact ?? "") || basename(source.artifact ?? "") !== source.artifact) throw new Error("Invalid artifact basename");
  if (!Number.isSafeInteger(source.bytes) || Number(source.bytes) <= 0 || Number(source.bytes) > 4 * 1024 ** 3) throw new Error("Invalid source byte bound");
  if (!Number.isSafeInteger(source.rows) || Number(source.rows) <= 0 || Number(source.rows) > 10_000_000) throw new Error("Invalid source row bound");
  if (source.compilationLicense !== "CC-BY-4.0") throw new Error("Unexpected compilation license");
  if (source.itemLicensePolicy !== "inherit-upstream-unresolved") throw new Error("Item licenses must remain unresolved");
  if (source.trustTier !== "quarantine-research") throw new Error("Bulk sources must remain quarantined");
  if (!Array.isArray(source.allowedDownloadHosts) || source.allowedDownloadHosts.length === 0 || source.allowedDownloadHosts.length > 8) throw new Error("Invalid source host allowlist");

  const allowedHosts = source.allowedDownloadHosts.map((entry) => String(entry).toLowerCase().replace(/\.$/, ""));
  if (new Set(allowedHosts).size !== allowedHosts.length || allowedHosts.some((entry) => !SAFE_HOST.test(entry))) throw new Error("Invalid source host allowlist entry");

  let url: URL;
  try {
    url = new URL(source.url ?? "");
  } catch {
    throw new Error("Invalid source URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Source URL must use HTTPS port 443 without credentials");
  if (!isAllowedHost(url.hostname, allowedHosts)) throw new Error("Source URL host is outside its allowlist");
  const requiredPath = `/datasets/${source.dataset}/resolve/${source.revision}/${source.artifact}`;
  if (url.pathname !== requiredPath) throw new Error("Source URL must exactly match the declared dataset, revision, and artifact");

  return { ...source, allowedDownloadHosts: allowedHosts } as SkillSourceManifest;
}

export function loadSourceManifest(id = "skillmd-138k"): SkillSourceManifest {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid source id: ${id}`);
  const path = assertInside(sourceManifestRoot, resolve(sourceManifestRoot, `${id}.source.json`));
  return validateSourceManifest(JSON.parse(readFileSync(path, "utf8")) as unknown, id);
}
