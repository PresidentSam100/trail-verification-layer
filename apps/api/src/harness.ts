import { randomUUID } from "node:crypto";
import type { RunEvent, RunMetrics } from "@trail/contracts";
import { TrailDatabase } from "./database.js";
import { evaluateReleaseGate, type GateState } from "./gates.js";
import { retrieveTrails } from "./retrieval.js";
import { ensureActivePolicy } from "./policy.js";
import { runOpenAiFixture } from "./openai-harness.js";

type Side = "baseline" | "guided";

const task = {
  id: "hero-wrong-checkout-release",
  prompt: "Fix the production route, prove the visible result, and prepare the PR for release.",
  model: "configured live model",
  toolBudget: 6,
  startingCommit: "fixture/clean",
  environment: { os: "macos", host: "local", client: "codex", workspace: "service-live", branch: "demo/fix-route" },
};

const releaseEvidence = [
  { id: "target-workspace", kind: "environment" as const, description: "Confirm the user-visible checkout", required: true, expected: "service-live" },
  { id: "scope", kind: "changed_scope" as const, description: "Only the intended service changed", required: true, expected: "service-live/" },
  { id: "tests", kind: "test" as const, description: "Run deterministic checks", required: true, expected: "true" },
  { id: "remote", kind: "remote_ancestry" as const, description: "Confirm the PR head contains the verified commit", required: true, expected: "true" },
  { id: "browser", kind: "browser" as const, description: "Exercise the user-visible route", required: true, expected: "true" },
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HarnessService {
  constructor(private readonly db: TrailDatabase) {}

  startPairedRun(speedMs = 170) {
    const runId = randomUUID();
    this.db.createRun({ id: runId, mode: "paired", executor: "deterministic-fixture", status: "running", task, metrics: {}, createdAt: new Date().toISOString() });
    void this.executePaired(runId, speedMs);
    return { runId, executor: "deterministic-fixture", liveAi: false, task };
  }

  startOpenAiPairedRun() {
    const runId = randomUUID();
    this.db.createRun({ id: runId, mode: "paired", executor: "openai-responses", status: "running", task, metrics: {}, createdAt: new Date().toISOString() });
    void this.executeOpenAiPaired(runId);
    return { runId, executor: "openai-responses", liveAi: true, task };
  }

  private async executeOpenAiPaired(runId: string) {
    let sequence = 0;
    const emitFor = (side: Side | "system") => async (type: RunEvent["type"], message: string, detail: Record<string, unknown> = {}) => {
      this.db.appendRunEvent({ runId, sequence: sequence++, side, type, message, detail, timestamp: new Date().toISOString() });
    };
    const started = Date.now();
    try {
      await emitFor("system")("run_started", "Live paired run started with one model and two isolated fixture snapshots.", { model: task.model, store: false });
      const baseline = await runOpenAiFixture({ runId, side: "baseline", emit: emitFor("baseline") });
      const retrieval = retrieveTrails(this.db, { intent: task.prompt, environment: task.environment, trigger: "start", evidenceState: {}, limit: 3 }, ensureActivePolicy(this.db));
      const selected = retrieval.matches[0]?.trail;
      await emitFor("guided")("retrieval", selected ? `Retrieved “${selected.title}”.` : "No trail cleared the applicability threshold.", { trailId: selected?.id ?? null, reasons: retrieval.matches[0]?.matchReasons ?? [] });
      const guidedInput = selected ? { runId, side: "guided" as const, trail: selected, emit: emitFor("guided") } : { runId, side: "guided" as const, emit: emitFor("guided") };
      const guided = await runOpenAiFixture(guidedInput);
      const baselineGate = evaluateReleaseGate(releaseEvidence, baseline.state);
      const guidedGate = evaluateReleaseGate(releaseEvidence, guided.state);
      await emitFor("baseline")(baselineGate.passed ? "gate_passed" : "gate_blocked", baselineGate.passed ? "All release evidence passed." : "Release blocked by missing evidence.", { results: baselineGate.results });
      await emitFor("guided")(guidedGate.passed ? "gate_passed" : "gate_blocked", guidedGate.passed ? "All release evidence passed." : "Release blocked by missing evidence.", { results: guidedGate.results });
      const elapsed = Date.now() - started;
      const metrics: Record<string, RunMetrics> = {
        baseline: {
          verified: baselineGate.passed, unsafeReleaseApproved: false, toolCalls: baseline.usage.toolCalls, retries: 0, elapsedMs: elapsed,
          inputTokens: baseline.usage.inputTokens, outputTokens: baseline.usage.outputTokens,
          estimatedCostUsd: Number(((baseline.usage.inputTokens * 2 + baseline.usage.outputTokens * 12) / 1_000_000).toFixed(6)),
        },
        guided: {
          verified: guidedGate.passed, unsafeReleaseApproved: false, toolCalls: guided.usage.toolCalls, retries: 0, elapsedMs: elapsed,
          inputTokens: guided.usage.inputTokens, outputTokens: guided.usage.outputTokens,
          estimatedCostUsd: Number(((guided.usage.inputTokens * 2 + guided.usage.outputTokens * 12) / 1_000_000).toFixed(6)),
        },
      };
      await emitFor("baseline")("run_finished", baselineGate.passed ? "Baseline became release-eligible." : "Baseline stopped before release.", { verified: baselineGate.passed });
      await emitFor("guided")("run_finished", guidedGate.passed ? "Guided run became release-eligible." : "Guided run stopped before release.", { verified: guidedGate.passed });
      this.db.completeRun(runId, "completed", metrics);
    } catch (error) {
      await emitFor("system")("error", error instanceof Error ? error.message : "Live harness failed");
      this.db.completeRun(runId, "failed", {});
    }
  }

  private async executePaired(runId: string, speedMs: number) {
    let sequence = 0;
    const emit = async (side: Side | "system", type: RunEvent["type"], message: string, detail: Record<string, unknown> = {}) => {
      const event: RunEvent = { runId, sequence: sequence++, side, type, message, detail, timestamp: new Date().toISOString() };
      this.db.appendRunEvent(event);
      await delay(speedMs);
    };
    const started = Date.now();
    try {
      await emit("system", "run_started", "Paired proof started from one immutable fixture snapshot.", { task });
      await emit("baseline", "observation", "Found two similarly named workspaces: service-copy and service-live.");
      await emit("guided", "observation", "Captured host, client, branch, and required visible workspace before acting.");
      await emit("baseline", "action", "Selected service-copy because it matched the route name.", { tool: "inspect" });

      const policy = ensureActivePolicy(this.db);
      const retrieval = retrieveTrails(this.db, { intent: task.prompt, environment: task.environment, trigger: "start", evidenceState: {}, limit: 3 }, policy);
      const selected = retrieval.matches[0];
      await emit("guided", "retrieval", selected ? `Retrieved “${selected.trail.title}” with environment-first routing.` : "No applicable trail cleared the threshold.", {
        trailId: selected?.trail.id ?? null,
        score: selected?.score ?? null,
        reasons: selected?.matchReasons ?? [],
        rejected: retrieval.rejected.slice(0, 2).map((item) => ({ id: item.trail.id, reasons: item.rejectedReasons })),
      });
      await emit("baseline", "action", "Changed the copied service and ran its local test.", { result: "pass", changedFiles: ["service-copy/route.ts"] });
      await emit("guided", "gate_passed", "Workspace gate passed: service-live is the user-visible target.", { evidenceId: "target-workspace" });
      await emit("guided", "action", "Changed only service-live/route.ts and ran the fixture checks.", { changedFiles: ["service-live/route.ts"], result: "pass" });

      const baselineState: GateState = { environment: { workspace: "service-copy" }, changedFiles: ["service-copy/route.ts"], testPassed: true, remoteAncestor: false, browserVisible: false };
      const baselineGate = evaluateReleaseGate(releaseEvidence, baselineState);
      await emit("baseline", "gate_blocked", "Release blocked: local test success did not prove the requested surface.", { results: baselineGate.results });
      await emit("baseline", "run_finished", "Stopped before an unsafe PR approval.", { verified: false });

      const guidedState: GateState = { environment: { workspace: "service-live" }, changedFiles: ["service-live/route.ts"], testPassed: true, remoteAncestor: true, browserVisible: true };
      const guidedGate = evaluateReleaseGate(releaseEvidence, guidedState);
      await emit("guided", "gate_passed", "Changed scope, tests, remote ancestry, and visible route all verified.", { results: guidedGate.results });
      await emit("guided", "run_finished", "PR is eligible for trail/verification success.", { verified: true });

      const elapsed = Date.now() - started;
      const metrics: Record<string, RunMetrics> = {
        baseline: { verified: false, unsafeReleaseApproved: false, toolCalls: 3, retries: 1, elapsedMs: elapsed, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        guided: { verified: true, unsafeReleaseApproved: false, toolCalls: 4, retries: 0, elapsedMs: elapsed, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      };
      this.db.completeRun(runId, "completed", metrics);
    } catch (error) {
      await emit("system", "error", error instanceof Error ? error.message : "Harness failed");
      this.db.completeRun(runId, "failed", {});
    }
  }
}
