import { createHash, randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  fstatSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  truncateSync,
} from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ipaddr from "ipaddr.js";
import type { SkillSourceManifest } from "./types.js";
import { acquireCorpusLock } from "./locks.js";
import { artifactPath, assertInside, assertRegularFile, assertSafeFileParent, ensureCorpusRoot } from "./paths.js";

const MAX_REDIRECTS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 90_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export type DownloadProgress = { downloaded: number; total: number; resumed: boolean };
type LookupResult = Array<{ address: string; family: number }>;

export type DownloadOptions = {
  repair?: boolean;
  root?: string;
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<LookupResult>;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  onProgress?: (progress: DownloadProgress) => void;
};

function hostAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

async function assertSafeRemote(url: URL, allowedHosts: string[], lookup: (hostname: string) => Promise<LookupResult>) {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Refusing a non-HTTPS, credential-bearing, or non-443 download URL");
  if (!hostAllowed(url.hostname, allowedHosts)) throw new Error(`Download redirect left the host allowlist: ${url.hostname}`);
  const addresses = await lookup(url.hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error(`Download host did not resolve exclusively to public addresses: ${url.hostname}`);
}

async function defaultLookup(hostname: string): Promise<LookupResult> {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function fetchFollowingAllowedRedirects(
  url: string,
  headers: Headers,
  allowedHosts: string[],
  fetchImpl: typeof fetch,
  lookup: (hostname: string) => Promise<LookupResult>,
  signal: AbortSignal,
): Promise<Response> {
  let current = new URL(url);
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    await assertSafeRemote(current, allowedHosts, lookup);
    const response = await fetchImpl(current, { headers, redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error(`Download redirect ${count + 1} omitted Location`);
    current = new URL(location, current);
  }
  throw new Error("Too many redirects while downloading the pinned artifact");
}

function sameFileIdentity(path: string, descriptor: number): void {
  const before = assertRegularFile(path, "artifact");
  const opened = fstatSync(descriptor);
  const deviceChanged = process.platform !== "win32" && before.dev !== opened.dev;
  if (before.size !== opened.size || before.ino !== opened.ino || deviceChanged) throw new Error(`Artifact changed while opening: ${path}`);
}

export async function sha256File(path: string): Promise<string> {
  const descriptor = openSync(path, "r");
  try {
    sameFileIdentity(path, descriptor);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path, { fd: descriptor, autoClose: false })) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

export async function verifyArtifact(path: string, source: SkillSourceManifest): Promise<void> {
  const descriptor = openSync(path, "r");
  try {
    sameFileIdentity(path, descriptor);
    const stat = fstatSync(descriptor);
    if (stat.size !== source.bytes) throw new Error(`Artifact size mismatch: expected ${source.bytes}, got ${stat.size}`);
    const start = Buffer.alloc(4);
    const end = Buffer.alloc(4);
    if (readSync(descriptor, start, 0, 4, 0) !== 4 || readSync(descriptor, end, 0, 4, stat.size - 4) !== 4 || start.toString("ascii") !== "PAR1" || end.toString("ascii") !== "PAR1") {
      throw new Error("Artifact is not a complete Parquet file");
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path, { fd: descriptor, autoClose: false })) hash.update(chunk as Buffer);
    const digest = hash.digest("hex");
    if (digest !== source.sha256) throw new Error(`Artifact SHA-256 mismatch: expected ${source.sha256}, got ${digest}`);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncParentBestEffort(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(dirname(path), "r");
    fsyncSync(descriptor);
  } catch {
    // Windows does not consistently allow directory fsync. File fsync and
    // same-directory rename still provide atomic visibility.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function quarantineInvalid(path: string, root: string): string {
  assertRegularFile(path, "invalid artifact");
  const quarantined = assertInside(root, `${path}.invalid-${randomUUID()}`);
  renameSync(path, quarantined);
  return quarantined;
}

export async function downloadArtifact(
  source: SkillSourceManifest,
  options: DownloadOptions = {},
): Promise<{ path: string; bytes: number; resumed: boolean; alreadyPresent: boolean; repaired: boolean }> {
  const root = options.root ? ensureCorpusRoot(options.root) : ensureCorpusRoot();
  const releaseLock = acquireCorpusLock(root, "download");
  try {
    const finalPath = assertSafeFileParent(root, artifactPath(source, root));
    const partPath = assertInside(root, `${finalPath}.part`);
    let repaired = false;

    if (existsSync(finalPath)) {
      try {
        await verifyArtifact(finalPath, source);
        return { path: finalPath, bytes: source.bytes, resumed: false, alreadyPresent: true, repaired: false };
      } catch (error) {
        if (!options.repair) throw new Error(`Existing artifact failed verification; rerun with --repair to quarantine and replace it. ${error instanceof Error ? error.message : String(error)}`);
        quarantineInvalid(finalPath, root);
        repaired = true;
      }
    }

    if (existsSync(partPath)) {
      const part = assertRegularFile(partPath, "partial artifact");
      if (part.size === source.bytes) {
        try {
          await verifyArtifact(partPath, source);
          renameSync(partPath, finalPath);
          fsyncParentBestEffort(finalPath);
          return { path: finalPath, bytes: source.bytes, resumed: true, alreadyPresent: false, repaired };
        } catch {
          quarantineInvalid(partPath, root);
        }
      } else if (part.size > source.bytes) {
        quarantineInvalid(partPath, root);
      }
    }

    let offset = existsSync(partPath) ? assertRegularFile(partPath, "partial artifact").size : 0;
    let resumed = offset > 0;
    const headers = new Headers({
      Accept: "application/octet-stream",
      "Accept-Encoding": "identity",
      "User-Agent": "TRAIL-skill-corpus/0.1",
    });
    if (offset > 0) headers.set("Range", `bytes=${offset}-`);

    const controller = new AbortController();
    const totalTimer = setTimeout(() => controller.abort(new Error("Artifact download exceeded its total timeout")), options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new Error("Artifact download stalled")), options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    };

    try {
      resetIdleTimer();
      const fetchImpl = options.fetchImpl ?? fetch;
      const lookup = options.lookup ?? defaultLookup;
      let response = await fetchFollowingAllowedRedirects(source.url, headers, source.allowedDownloadHosts, fetchImpl, lookup, controller.signal);
      if (offset > 0 && response.status === 200) {
        await response.body?.cancel();
        assertRegularFile(partPath, "partial artifact");
        truncateSync(partPath, 0);
        offset = 0;
        resumed = false;
        headers.delete("Range");
        response = await fetchFollowingAllowedRedirects(source.url, headers, source.allowedDownloadHosts, fetchImpl, lookup, controller.signal);
      }
      if (offset > 0) {
        const expectedRange = `bytes ${offset}-${source.bytes - 1}/${source.bytes}`;
        if (response.status !== 206 || response.headers.get("content-range") !== expectedRange) {
          await response.body?.cancel();
          throw new Error(`Unsafe resume response: ${response.status} ${response.headers.get("content-range") ?? "no Content-Range"}`);
        }
      } else if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error(`Download failed with HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Download response had no body");

      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      const remaining = source.bytes - offset;
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || (declaredLength > 0 && declaredLength !== remaining)) {
        await response.body.cancel();
        throw new Error(`Download length mismatch: expected ${remaining}, server declared ${String(response.headers.get("content-length"))}`);
      }

      const descriptor = existsSync(partPath) ? openSync(partPath, "r+") : openSync(partPath, "wx", 0o600);
      try {
        sameFileIdentity(partPath, descriptor);
        if (fstatSync(descriptor).size !== offset) throw new Error("Partial artifact changed before download write");
        let downloaded = offset;
        options.onProgress?.({ downloaded, total: source.bytes, resumed });
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, streamController) {
            resetIdleTimer();
            downloaded += chunk.byteLength;
            if (downloaded > source.bytes) throw new Error(`Download exceeded the pinned ${source.bytes}-byte limit`);
            options.onProgress?.({ downloaded, total: source.bytes, resumed });
            streamController.enqueue(chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(response.body.pipeThrough(counter) as never),
          createWriteStream(partPath, { fd: descriptor, autoClose: false, start: offset }),
        );
        if (downloaded !== source.bytes) throw new Error(`Download ended early: expected ${source.bytes}, got ${downloaded}`);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    } finally {
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }

    await verifyArtifact(partPath, source);
    renameSync(partPath, finalPath);
    fsyncParentBestEffort(finalPath);
    await verifyArtifact(finalPath, source);
    return { path: finalPath, bytes: source.bytes, resumed, alreadyPresent: false, repaired };
  } finally {
    releaseLock();
  }
}
