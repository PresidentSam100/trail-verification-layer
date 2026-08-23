import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RetrievalRequestSchema } from "@trail/contracts";
import { config } from "./config.js";
import { TrailDatabase } from "./database.js";
import { ensureActivePolicy } from "./policy.js";
import { retrieveTrails } from "./retrieval.js";

type BenchmarkTask = {
  id: string;
  family: string;
  correctTrailId: string;
  request: unknown;
  baselineVerified: boolean;
  baselineUnsafeApproval: boolean;
};

type RetrievalCase = { id: string; correctTrailId: string; request: unknown };

export function runBenchmark(db: TrailDatabase) {
  const tasks = JSON.parse(readFileSync(join(config.benchmarkPath, "tasks.json"), "utf8")) as BenchmarkTask[];
  const retrievalCases = JSON.parse(readFileSync(join(config.benchmarkPath, "retrieval-cases.json"), "utf8")) as RetrievalCase[];
  const policy = ensureActivePolicy(db);
  const results = [];
  for (const task of tasks) {
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const request = RetrievalRequestSchema.parse(task.request);
      const retrieval = retrieveTrails(db, request, policy);
      const guidedVerified = retrieval.matches.some((match) => match.trail.id === task.correctTrailId);
      results.push({ taskId: task.id, family: task.family, repetition, condition: "baseline", verified: task.baselineVerified, unsafeApproval: task.baselineUnsafeApproval });
      results.push({ taskId: task.id, family: task.family, repetition, condition: "guided", verified: guidedVerified, unsafeApproval: false, topTrailId: retrieval.matches[0]?.trail.id ?? null });
    }
  }
  const ranking = retrievalCases.map((item) => {
    const retrieval = retrieveTrails(db, RetrievalRequestSchema.parse(item.request), policy);
    const rank = retrieval.matches.findIndex((match) => match.trail.id === item.correctTrailId) + 1;
    return { id: item.id, rank, correctTrailId: item.correctTrailId, returned: retrieval.matches.map((match) => match.trail.id) };
  });
  const baseline = results.filter((item) => item.condition === "baseline");
  const guided = results.filter((item) => item.condition === "guided");
  const recallAt = (limit: number) => ranking.filter((item) => item.rank > 0 && item.rank <= limit).length / ranking.length;
  return {
    executor: "deterministic-fixture",
    disclaimer: "These are deterministic fixture results, not live-model results.",
    endToEndRuns: results.length,
    taskCount: tasks.length,
    repetitions: 3,
    metrics: {
      baselineVerified: { numerator: baseline.filter((item) => item.verified).length, denominator: baseline.length },
      guidedVerified: { numerator: guided.filter((item) => item.verified).length, denominator: guided.length },
      unsafeApprovals: { baseline: baseline.filter((item) => item.unsafeApproval).length, guided: guided.filter((item) => item.unsafeApproval).length },
      recallAt1: Number(recallAt(1).toFixed(4)),
      recallAt3: Number(recallAt(3).toFixed(4)),
      mrr: Number((ranking.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) / ranking.length).toFixed(4)),
    },
    results,
    ranking,
  };
}
