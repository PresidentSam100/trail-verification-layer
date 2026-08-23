import { randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent, Trail } from "@trail/contracts";
import { config } from "./config.js";
import { TrailDatabase } from "./database.js";
import { runOpenAiFixture } from "./openai-harness.js";
import type { FixtureManifest } from "./sandbox.js";

export const domainIds = ["robotics", "saas", "ai-ml"] as const;
export type DomainId = (typeof domainIds)[number];

type ConditionResult = {
  condition: "baseline" | "guided";
  verified: boolean;
  releaseBlocked: boolean;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  changedFiles: string[];
  failedEvidence: string[];
  events: Array<{ type: RunEvent["type"]; message: string }>;
};

type PairResult = {
  domain: DomainId;
  repetition: number;
  order: Array<"baseline" | "guided">;
  task: string;
  trail: { id: string; title: string; provenance: Trail["provenance"] };
  baseline: ConditionResult;
  guided: ConditionResult;
};

function manifestFor(domain: DomainId) {
  return JSON.parse(readFileSync(join(config.benchmarkPath, "fixtures", domain, "manifest.json"), "utf8")) as FixtureManifest;
}

function failedEvidence(result: Awaited<ReturnType<typeof runOpenAiFixture>>, manifest: FixtureManifest) {
  const missing: string[] = [];
  if (result.state.environment.workspace !== manifest.intendedWorkspace) missing.push("authoritative workspace");
  if (!result.state.testPassed) missing.push(manifest.checks[0]);
  if (!result.state.browserVisible) missing.push(manifest.checks[1]);
  if (result.state.changedFiles.some((path) => path !== manifest.targetPath)) missing.push("changed-file scope");
  return missing;
}

async function runCondition(input: {
  pairId: string;
  condition: "baseline" | "guided";
  domain: DomainId;
  manifest: FixtureManifest;
  trail: Trail;
}): Promise<ConditionResult> {
  const events: ConditionResult["events"] = [];
  const started = Date.now();
  const result = await runOpenAiFixture({
    runId: input.pairId,
    side: input.condition,
    fixtureId: input.domain,
    ...(input.condition === "guided" ? { trail: input.trail, humanContext: input.manifest.humanContext } : {}),
    emit: async (type, message) => { events.push({ type, message }); },
  });
  const missing = failedEvidence(result, input.manifest);
  return {
    condition: input.condition,
    verified: missing.length === 0,
    releaseBlocked: missing.length > 0,
    toolCalls: result.usage.toolCalls,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedCostUsd: Number(((result.usage.inputTokens * 2 + result.usage.outputTokens * 12) / 1_000_000).toFixed(6)),
    elapsedMs: Date.now() - started,
    changedFiles: result.state.changedFiles,
    failedEvidence: missing,
    events,
  };
}

function aggregate(results: PairResult[]) {
  const summarize = (condition: "baseline" | "guided") => {
    const runs = results.map((result) => result[condition]);
    const sum = (field: "toolCalls" | "inputTokens" | "outputTokens" | "estimatedCostUsd" | "elapsedMs") => runs.reduce((total, run) => total + run[field], 0);
    return {
      verified: { numerator: runs.filter((run) => run.verified).length, denominator: runs.length },
      unsafeReleaseApprovals: 0,
      averageToolCalls: Number((sum("toolCalls") / runs.length).toFixed(2)),
      averageInputTokens: Math.round(sum("inputTokens") / runs.length),
      averageOutputTokens: Math.round(sum("outputTokens") / runs.length),
      averageElapsedMs: Math.round(sum("elapsedMs") / runs.length),
      totalEstimatedCostUsd: Number(sum("estimatedCostUsd").toFixed(6)),
    };
  };
  const baseline = summarize("baseline");
  const guided = summarize("guided");
  return {
    baseline,
    guided,
    verifiedSuccessDeltaPercentagePoints: Number(((guided.verified.numerator / guided.verified.denominator - baseline.verified.numerator / baseline.verified.denominator) * 100).toFixed(1)),
  };
}

export function getDomainEvalSetup() {
  const latestPath = join(config.benchmarkPath, "..", ".trail", "evals", "domain-live-latest.json");
  const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, "utf8")) as unknown : null;
  return {
    label: "controlled executable evaluation",
    liveResultsAvailable: Boolean(latest),
    disclaimer: "The fixtures are synthetic and intentionally expose known failure families. Results are populated only by live model executions; they are not evidence of broad statistical significance.",
    controls: {
      sameTask: true,
      sameModel: true,
      sameReasoningEffort: true,
      sameToolBudget: 6,
      isolatedSnapshots: true,
      randomizedPairedOrder: true,
      hardGateFromObservedState: true,
      agentProseAcceptedAsEvidence: false,
    },
    domains: domainIds.map((domain) => {
      const manifest = manifestFor(domain);
      return { id: domain, task: manifest.task, checks: manifest.checks, reviewedTrailId: manifest.reviewedTrailId };
    }),
    latest,
  };
}

export function saveDomainEvalResult(result: unknown) {
  const directory = join(config.benchmarkPath, "..", ".trail", "evals");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "domain-live-latest.json");
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return path;
}

export async function runDomainEvals(db: TrailDatabase, repetitions = 3) {
  if (!config.openAiKey) throw new Error("Live domain evals require OPENAI_API_KEY.");
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error("repetitions must be an integer from 1 to 10");
  const startedAt = new Date().toISOString();
  const byDomain = await Promise.all(domainIds.map(async (domain) => {
    const manifest = manifestFor(domain);
    const trail = db.getTrails().find((candidate) => candidate.id === manifest.reviewedTrailId);
    if (!trail) throw new Error(`Approved trail is missing: ${manifest.reviewedTrailId}`);
    const pairs: PairResult[] = [];
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const pairId = `domain-${domain}-${randomUUID()}`;
      const order: Array<"baseline" | "guided"> = randomInt(2) === 0 ? ["baseline", "guided"] : ["guided", "baseline"];
      const conditions = new Map<"baseline" | "guided", ConditionResult>();
      for (const condition of order) {
        conditions.set(condition, await runCondition({ pairId, condition, domain, manifest, trail }));
      }
      pairs.push({
        domain,
        repetition,
        order,
        task: manifest.task,
        trail: { id: trail.id, title: trail.title, provenance: trail.provenance },
        baseline: conditions.get("baseline")!,
        guided: conditions.get("guided")!,
      });
    }
    return pairs;
  }));
  const results = byDomain.flat();
  return {
    executor: "live-responses-api",
    resultLabel: "LIVE MODEL · CONTROLLED FIXTURES",
    disclaimer: "Measured on purpose-built fixtures with a small sample. Do not interpret as statistical significance or broad model performance.",
    provider: config.providerLabel,
    model: config.agentModel,
    reasoningEffort: config.reasoningEffort,
    store: false,
    startedAt,
    finishedAt: new Date().toISOString(),
    domainsRunInParallel: true,
    taskCount: domainIds.length,
    repetitions,
    endToEndRuns: results.length * 2,
    metrics: aggregate(results),
    byDomain: domainIds.map((domain) => {
      const domainResults = results.filter((result) => result.domain === domain);
      return { domain, metrics: aggregate(domainResults), pairs: domainResults };
    }),
    results,
  };
}
