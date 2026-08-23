import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { downloadArtifact, isPublicAddress, verifyArtifact } from "./download.js";
import { artifactPath, ensureCorpusRoot } from "./paths.js";
import type { SkillSourceManifest } from "./types.js";

const temporary: string[] = [];
function temp(): string {
  const path = mkdtempSync(join(tmpdir(), "trail-download-test-"));
  temporary.push(path);
  return path;
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const bytes = Buffer.concat([Buffer.from("PAR1"), Buffer.from("bounded fixture"), Buffer.from("PAR1")]);
const revision = "a".repeat(40);
const source: SkillSourceManifest = {
  schemaVersion: "1.0",
  id: "download-test",
  kind: "huggingface-parquet",
  dataset: "owner/data",
  revision,
  artifact: "train.parquet",
  url: `https://huggingface.co/datasets/owner/data/resolve/${revision}/train.parquet`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
  rows: 1,
  compilationLicense: "CC-BY-4.0",
  itemLicensePolicy: "inherit-upstream-unresolved",
  trustTier: "quarantine-research",
  allowedDownloadHosts: ["huggingface.co", "hf.co"],
};
const publicLookup = async () => [{ address: "1.1.1.1", family: 4 }];

function response(body: Uint8Array, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body as BodyInit, { status, headers: { "content-length": String(body.byteLength), ...headers } });
}

describe("pinned artifact downloader", () => {
  it("downloads, verifies, atomically publishes, and reuses exact bytes", async () => {
    const project = temp();
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return response(bytes);
    };
    const first = await downloadArtifact(source, { root: project, fetchImpl: fetchImpl as typeof fetch, lookup: publicLookup });
    expect(first.alreadyPresent).toBe(false);
    expect(readFileSync(first.path)).toEqual(bytes);
    await verifyArtifact(first.path, source);
    const second = await downloadArtifact(source, { root: project, fetchImpl: fetchImpl as typeof fetch, lookup: publicLookup });
    expect(second.alreadyPresent).toBe(true);
    expect(fetches).toBe(1);
  });

  it("safely resumes only an exact Content-Range", async () => {
    const project = temp();
    const root = ensureCorpusRoot(project);
    const final = artifactPath(source, root);
    mkdirSync(dirname(final), { recursive: true });
    const offset = 7;
    writeFileSync(`${final}.part`, bytes.subarray(0, offset));
    const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("range")).toBe(`bytes=${offset}-`);
      return response(bytes.subarray(offset), 206, { "content-range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}` });
    };
    const result = await downloadArtifact(source, { root: project, fetchImpl: fetchImpl as typeof fetch, lookup: publicLookup });
    expect(result.resumed).toBe(true);
    expect(readFileSync(result.path)).toEqual(bytes);
  });

  it("follows only allowlisted public HTTPS redirects", async () => {
    const project = temp();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 302, headers: { location: "https://us.aws.cdn.hf.co/blob" } });
      return response(bytes);
    };
    await downloadArtifact(source, { root: project, fetchImpl: fetchImpl as typeof fetch, lookup: publicLookup });
    expect(calls).toBe(2);
  });

  it("rejects private DNS answers before fetching", async () => {
    const project = temp();
    let fetched = false;
    await expect(downloadArtifact(source, {
      root: project,
      fetchImpl: (async () => { fetched = true; return response(bytes); }) as typeof fetch,
      lookup: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
    })).rejects.toThrow(/public addresses/);
    expect(fetched).toBe(false);
  });

  it("repairs by quarantining an invalid final rather than overwriting it in place", async () => {
    const project = temp();
    const root = ensureCorpusRoot(project);
    const final = artifactPath(source, root);
    mkdirSync(dirname(final), { recursive: true });
    writeFileSync(final, Buffer.alloc(bytes.length, 0));
    await expect(downloadArtifact(source, { root: project, fetchImpl: (async () => response(bytes)) as typeof fetch, lookup: publicLookup })).rejects.toThrow(/--repair/);
    const repaired = await downloadArtifact(source, { root: project, repair: true, fetchImpl: (async () => response(bytes)) as typeof fetch, lookup: publicLookup });
    expect(repaired.repaired).toBe(true);
    expect(readdirSync(dirname(final)).some((name) => name.includes(".invalid-"))).toBe(true);
    expect(existsSync(final)).toBe(true);
  });

  it.each(["127.0.0.1", "10.0.0.1", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fc00::1", "ff02::1", "::ffff:192.168.1.1"])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
