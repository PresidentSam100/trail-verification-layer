#!/usr/bin/env node
import { resolve } from "node:path";
import { config } from "./config.js";
import { TrailDatabase } from "./database.js";
import { loadCorpus } from "./corpus.js";
import { previewTranscriptFile } from "./adapters.js";
import { indexLocalSources } from "./source-index.js";
import { runBenchmark } from "./benchmark.js";
import { HarnessService } from "./harness.js";
import { publishVerificationStatus } from "./github-status.js";
import { ensureActivePolicy } from "./policy.js";

const db = new TrailDatabase(config.databasePath);
loadCorpus(db);
ensureActivePolicy(db);
const [command, ...args] = process.argv.slice(2);

const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

try {
  if (command === "ingest" && args[0] === "--scan") {
    console.log(JSON.stringify(indexLocalSources(db), null, 2));
  } else if (command === "ingest" && args[0]) {
    const preview = previewTranscriptFile(resolve(args[0]));
    db.saveIngestion(preview);
    console.log(JSON.stringify(preview, null, 2));
  } else if (command === "benchmark") {
    console.log(JSON.stringify(runBenchmark(db), null, 2));
  } else if (command === "run") {
    const result = new HarnessService(db).startPairedRun(0);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    console.log(JSON.stringify({ ...result, run: db.getRun(result.runId), events: db.getRunEvents(result.runId) }, null, 2));
  } else if (command === "verify-pr") {
    const repo = option("--repo");
    const sha = option("--sha");
    const state = option("--state") as "pending" | "success" | "failure" | undefined;
    if (!repo || !sha || !state || !["pending", "success", "failure"].includes(state)) throw new Error("Usage: trail verify-pr --repo owner/name --sha COMMIT --state pending|success|failure");
    console.log(JSON.stringify(publishVerificationStatus({ repo, sha, state, description: option("--description") ?? `TRAIL verification ${state}` }), null, 2));
  } else {
    console.log("TRAIL CLI\n  trail ingest --scan\n  trail ingest <transcript.jsonl>\n  trail benchmark\n  trail run\n  trail verify-pr --repo owner/name --sha COMMIT --state pending|success|failure");
  }
} finally {
  db.close();
}
