#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { SkillCatalog } from "./catalog.js";
import { downloadArtifact, verifyArtifact } from "./download.js";
import { loadActiveGeneration } from "./generation.js";
import { buildSkillIndex, verifyCompletedGeneration } from "./indexer.js";
import { artifactPath } from "./paths.js";
import { loadSourceManifest } from "./source.js";
import type { RiskSeverity } from "./types.js";

const [command = "help", ...args] = process.argv.slice(2);

function readOptions(allowedValueOptions: string[], allowedFlags: string[]): { options: Map<string, string>; flags: Set<string>; positionals: string[] } {
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (allowedValueOptions.includes(value)) {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value`);
      if (options.has(value)) throw new Error(`${value} may only be supplied once`);
      options.set(value, next);
      index += 1;
    } else if (allowedFlags.includes(value)) {
      if (flags.has(value)) throw new Error(`${value} may only be supplied once`);
      flags.add(value);
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }
  return { options, flags, positionals };
}

function boundedLimit(value: string | undefined, fallback: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 100) throw new Error("--limit must be an integer from 1 to 100");
  return number;
}

function elapsed(start: number): number {
  return Number((performance.now() - start).toFixed(1));
}

function help(): void {
  console.log(`TRAIL skill corpus (offline quarantine)\n\n  pnpm skills status [--source skillmd-138k]\n  pnpm skills sync [--source skillmd-138k] [--repair]\n  pnpm skills index [--source skillmd-138k]\n  pnpm skills verify [--source skillmd-138k]\n  pnpm skills search "stripe billing webhook" [--limit 20] [--max-risk medium]\n  pnpm skills inspect <full-sha256>\n\nSearch and inspect return derived metadata only. There is intentionally no raw-body, install-all, execute, or auto-promote command.`);
}

try {
  const started = performance.now();
  if (command === "help" || command === "--help" || command === "-h") {
    help();
  } else if (command === "sync") {
    const parsed = readOptions(["--source"], ["--repair"]);
    if (parsed.positionals.length > 0) throw new Error("sync does not accept positional arguments");
    const source = loadSourceManifest(parsed.options.get("--source") ?? "skillmd-138k");
    let lastPercent = -1;
    const result = await downloadArtifact(source, {
      repair: parsed.flags.has("--repair"),
      onProgress({ downloaded, total }) {
        const percent = Math.floor(downloaded / total * 100);
        if (percent >= lastPercent + 5 || downloaded === total) {
          process.stderr.write(`download ${percent}% (${downloaded}/${total})\n`);
          lastPercent = percent;
        }
      },
    });
    console.log(JSON.stringify({ ok: true, source: source.id, elapsedMs: elapsed(started), ...result }, null, 2));
  } else if (command === "index") {
    const parsed = readOptions(["--source"], []);
    if (parsed.positionals.length > 0) throw new Error("index does not accept positional arguments");
    const source = loadSourceManifest(parsed.options.get("--source") ?? "skillmd-138k");
    let last = 0;
    const result = await buildSkillIndex(source, {
      onProgress(done, total) {
        if (done === total || done - last >= 5000) {
          process.stderr.write(`index ${done}/${total}\n`);
          last = done;
        }
      },
    });
    console.log(JSON.stringify({ ok: true, elapsedMs: elapsed(started), ...result }, null, 2));
  } else if (command === "verify") {
    const parsed = readOptions(["--source"], []);
    if (parsed.positionals.length > 0) throw new Error("verify does not accept positional arguments");
    const source = loadSourceManifest(parsed.options.get("--source") ?? "skillmd-138k");
    const artifact = artifactPath(source);
    await verifyArtifact(artifact, source);
    const active = loadActiveGeneration();
    const generation = active ? await verifyCompletedGeneration(active.directory, source) : null;
    console.log(JSON.stringify({ ok: true, elapsedMs: elapsed(started), artifact: { path: artifact, bytes: source.bytes, sha256: source.sha256, verified: true }, generation: generation ? { verified: true, manifest: generation.manifest, stats: generation.stats } : null }, null, 2));
  } else if (command === "search") {
    const parsed = readOptions(["--limit", "--max-risk"], []);
    const query = parsed.positionals.join(" ").trim();
    if (!query) throw new Error("Usage: pnpm skills search \"stripe billing webhook\" [--limit 20] [--max-risk medium]");
    const maxRisk = (parsed.options.get("--max-risk") ?? "medium") as RiskSeverity | "none";
    if (!(new Set(["none", "low", "medium", "high", "critical"]) as Set<string>).has(maxRisk)) throw new Error("--max-risk must be none|low|medium|high|critical");
    const catalog = new SkillCatalog();
    try {
      console.log(JSON.stringify({ ok: true, elapsedMs: elapsed(started), ...catalog.search(query, boundedLimit(parsed.options.get("--limit"), 20), maxRisk) }, null, 2));
    } finally {
      catalog.close();
    }
  } else if (command === "inspect") {
    const parsed = readOptions([], []);
    if (parsed.positionals.length !== 1) throw new Error("Usage: pnpm skills inspect <full-sha256>");
    const catalog = new SkillCatalog();
    try {
      console.log(JSON.stringify({ ok: true, elapsedMs: elapsed(started), ...catalog.inspect(parsed.positionals[0]!) }, null, 2));
    } finally {
      catalog.close();
    }
  } else if (command === "status") {
    const parsed = readOptions(["--source"], []);
    if (parsed.positionals.length > 0) throw new Error("status does not accept positional arguments");
    const source = loadSourceManifest(parsed.options.get("--source") ?? "skillmd-138k");
    const artifact = artifactPath(source);
    const active = loadActiveGeneration();
    let stats = null;
    if (active) {
      const catalog = new SkillCatalog(active.directory);
      try { stats = catalog.stats(); } finally { catalog.close(); }
    }
    console.log(JSON.stringify({
      ok: true,
      elapsedMs: elapsed(started),
      source: { id: source.id, dataset: source.dataset, revision: source.revision, expectedRows: source.rows, expectedBytes: source.bytes, sha256: source.sha256, compilationLicense: source.compilationLicense, itemLicensePolicy: source.itemLicensePolicy, trustTier: source.trustTier },
      artifact: { present: existsSync(artifact), bytes: existsSync(artifact) ? statSync(artifact).size : 0, path: artifact, integrityCheckedThisRun: false },
      active: active ? { pointer: active.pointer, manifest: active.manifest } : null,
      stats,
      safety: { installed: false, executable: false, rawBodiesStoredInIndex: false, rawBodiesReturnedByApi: false, rawBodiesInRouter: false, automaticPromotion: false },
    }, null, 2));
  } else {
    throw new Error(`Unknown command: ${command}. Run \`pnpm skills help\`.`);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
