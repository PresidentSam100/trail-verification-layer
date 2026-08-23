import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import type { RepositorySnapshot } from "./contracts.ts";
import { canonicalJson, compareText, sha256, uniqueSorted } from "./canonical.ts";

const EXCLUDED_DIRECTORIES = new Set([".git", ".trail", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);
const MAX_FILES = 25_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

interface SnapshotFile {
  path: string;
  bytes: number;
  digest: string;
}

function languageFor(path: string): string | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLocaleLowerCase("en-US");
  const names: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", py: "Python", rs: "Rust", go: "Go",
    rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift", php: "PHP", cs: "C#", cpp: "C++", c: "C",
  };
  return extension ? names[extension] ?? null : null;
}

function walk(root: string, directory: string, files: SnapshotFile[], manifests: string[], languages: string[], totals: { bytes: number }): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const relativePath = relative(root, absolute).split(sep).join("/").normalize("NFC");
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      walk(root, absolute, files, manifests, languages, totals);
      continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) continue;
    if (files.length >= MAX_FILES) throw new Error(`Repository snapshot exceeds ${MAX_FILES} files`);
    let bytes: Uint8Array;
    if (stat.isSymbolicLink()) {
      bytes = Buffer.from(`symlink:${readlinkSync(absolute)}`, "utf8");
    } else {
      if (stat.size > MAX_FILE_BYTES) throw new Error(`Repository file exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`);
      bytes = readFileSync(absolute);
    }
    totals.bytes += bytes.byteLength;
    if (totals.bytes > MAX_TOTAL_BYTES) throw new Error(`Repository snapshot exceeds ${MAX_TOTAL_BYTES} bytes`);
    files.push({ path: relativePath, bytes: bytes.byteLength, digest: sha256(bytes) });
    const fileName = basename(relativePath).toLocaleLowerCase("en-US");
    if (["package.json", "pyproject.toml", "cargo.toml", "go.mod", "gemfile", "composer.json", "pom.xml"].includes(fileName)) manifests.push(relativePath);
    const language = languageFor(relativePath);
    if (language) languages.push(language);
  }
}

function readHead(root: string): string | null {
  try {
    const head = readFileSync(resolve(root, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      if (ref.includes("..") || ref.startsWith("/")) return null;
      return readFileSync(resolve(root, ".git", ...ref.split("/")), "utf8").trim() || null;
    }
    return /^[a-f0-9]{40,64}$/i.test(head) ? head : null;
  } catch {
    return null;
  }
}

export function snapshotRepository(projectRoot: string): RepositorySnapshot {
  const root = resolve(projectRoot);
  const files: SnapshotFile[] = [];
  const manifests: string[] = [];
  const languages: string[] = [];
  const totals = { bytes: 0 };
  walk(root, root, files, manifests, languages, totals);
  files.sort((left, right) => compareText(left.path, right.path));
  const digest = createHash("sha256").update(canonicalJson(files)).digest("hex");
  return {
    algorithm: "sha256",
    digest,
    fileCount: files.length,
    totalBytes: totals.bytes,
    head: readHead(root),
    manifests: uniqueSorted(manifests),
    languages: uniqueSorted(languages),
  };
}
