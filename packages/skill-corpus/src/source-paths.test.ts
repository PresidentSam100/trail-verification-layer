import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertInside, ensureCorpusRoot, ensureSafeDirectory } from "./paths.js";
import { validateSourceManifest } from "./source.js";

const temporary: string[] = [];
function temp(): string {
  const path = mkdtempSync(join(tmpdir(), "trail-skill-test-"));
  temporary.push(path);
  return path;
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const revision = "a".repeat(40);
const manifest = {
  schemaVersion: "1.0",
  id: "skillmd-test",
  kind: "huggingface-parquet",
  dataset: "owner/data",
  revision,
  artifact: "train.parquet",
  url: `https://huggingface.co/datasets/owner/data/resolve/${revision}/train.parquet`,
  sha256: "b".repeat(64),
  bytes: 100,
  rows: 2,
  compilationLicense: "CC-BY-4.0",
  itemLicensePolicy: "inherit-upstream-unresolved",
  trustTier: "quarantine-research",
  allowedDownloadHosts: ["huggingface.co", "hf.co"],
};

describe("source and path trust roots", () => {
  it("accepts only the exact pinned dataset path and quarantine policy", () => {
    expect(validateSourceManifest(manifest).dataset).toBe("owner/data");
    expect(() => validateSourceManifest({ ...manifest, url: `https://huggingface.co/datasets/other/data/resolve/${revision}/train.parquet` })).toThrow(/exactly match/);
    expect(() => validateSourceManifest({ ...manifest, trustTier: "trusted" })).toThrow(/quarantined/);
    expect(() => validateSourceManifest({ ...manifest, itemLicensePolicy: "permissive" })).toThrow(/unresolved/);
    expect(() => validateSourceManifest({ ...manifest, artifact: "../train.parquet" })).toThrow(/artifact/);
  });

  it("rejects traversal and sibling-prefix paths", () => {
    const root = temp();
    expect(assertInside(root, resolve(root, "child"))).toBe(resolve(root, "child"));
    expect(() => assertInside(root, resolve(root, "..", "outside"))).toThrow(/escapes/);
    expect(() => assertInside(root, `${root}-sibling`)).toThrow(/escapes/);
  });

  it("creates the corpus root one checked segment at a time", () => {
    const project = temp();
    expect(ensureCorpusRoot(project)).toBe(resolve(project, ".trail", "skill-corpus"));
  });

  it("rejects a junction before creating a child outside the root", () => {
    const root = temp();
    const outside = temp();
    const link = resolve(root, "linked");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => ensureSafeDirectory(root, resolve(link, "must-not-exist"))).toThrow(/symlinked/);
    expect(() => assertInside(root, resolve(outside, "must-not-exist"))).toThrow();
  });
});
