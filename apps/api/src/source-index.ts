import { createHash } from "node:crypto";
import { openSync, closeSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { config } from "./config.js";
import { TrailDatabase } from "./database.js";

const maxSampleBytes = 196_608;

function walk(root: string): string[] {
  const output: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(child);
    }
  };
  try { visit(root); } catch { return []; }
  return output;
}

function sample(path: string) {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    const firstLength = Math.min(maxSampleBytes / 2, size);
    const lastLength = Math.min(maxSampleBytes / 2, Math.max(0, size - firstLength));
    const buffer = Buffer.alloc(firstLength + lastLength);
    readSync(fd, buffer, 0, firstLength, 0);
    if (lastLength) readSync(fd, buffer, firstLength, lastLength, size - lastLength);
    return buffer.toString("utf8");
  } finally { closeSync(fd); }
}

export function indexLocalSources(db: TrailDatabase) {
  const providers = [
    { provider: "codex", root: config.codexSessionsPath },
    { provider: "claude", root: config.claudeSessionsPath },
  ] as const;
  let indexed = 0;
  for (const { provider, root } of providers) {
    for (const path of walk(root)) {
      const metadata = statSync(path);
      const text = sample(path);
      const signals: string[] = [];
      if (/exit code [1-9]|is_error|error:/i.test(text)) signals.push("tool-error");
      if (/not working|i don.t see|still see|wrong|not the/i.test(text)) signals.push("user-correction");
      if (/ubuntu|remote|worktree|checkout|branch/i.test(text)) signals.push("environment-change");
      if (/pull request|merge|deploy|production|remote main/i.test(text)) signals.push("release-proof");
      if (/browser|provider|serial|verified|opened successfully/i.test(text)) signals.push("runtime-proof");
      db.upsertSource({
        pathHash: createHash("sha256").update(path).digest("hex"),
        provider,
        sourceName: basename(path),
        sizeBytes: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        signals,
      });
      indexed += 1;
    }
  }
  return { indexed, ...db.sourceSummary(), shortlist: db.sourceCandidates() };
}
