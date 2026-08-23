import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecisionEvidence, LoadedSkill, RouteDecision, SearchTelemetry, TransitionRecord } from "./contracts.ts";
import { buildPlanBundle } from "./bundle.ts";
import { normalizeRequest } from "./canonical.ts";
import { loadRegistry } from "./loader.ts";
import { searchParent, selectChildren } from "./router.ts";
import { snapshotRepository } from "./snapshot.ts";
import { computeClarificationId, readClarification, writeBundle, writeClarification } from "./store.ts";

export interface RouteOptions {
  request: string;
  projectRoot: string;
  registryRoot?: string;
}

export interface ResumeOptions {
  clarificationId: string;
  optionId: string;
  projectRoot: string;
  registryRoot?: string;
}

export function defaultRegistryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "registry");
}

function baseEvidence(request: string): DecisionEvidence {
  return { request: request.trim(), normalizedRequest: normalizeRequest(request), parentMatch: null, childMatches: [] };
}

function abstain(input: {
  request: string;
  reasonCodes: string[];
  diagnostics: string[];
  evidence?: DecisionEvidence;
  telemetry: SearchTelemetry;
  transitionTrace?: TransitionRecord[];
}): RouteDecision {
  return {
    status: "abstain",
    reasonCodes: input.reasonCodes,
    diagnostics: input.diagnostics,
    evidence: input.evidence ?? baseEvidence(input.request),
    telemetry: input.telemetry,
    transitionTrace: input.transitionTrace ?? [],
  };
}

function matchSelected(input: {
  request: string;
  projectRoot: string;
  registryDigest: string;
  parent: LoadedSkill;
  parentEvidence: NonNullable<DecisionEvidence["parentMatch"]>;
  selected: ReturnType<typeof selectChildren>;
  snapshot: ReturnType<typeof snapshotRepository>;
  telemetry: SearchTelemetry;
}): RouteDecision {
  if (input.selected.kind !== "selected" || input.selected.selected.length === 0) {
    return abstain({ request: input.request, reasonCodes: ["no-child-match"], diagnostics: ["The selected parent has no applicable SUBSKILL procedure."], evidence: { request: input.request.trim(), normalizedRequest: normalizeRequest(input.request), parentMatch: input.parentEvidence, childMatches: input.selected.evidence }, telemetry: input.telemetry });
  }
  const bundle = buildPlanBundle({
    request: input.request,
    parent: input.parent,
    parentEvidence: input.parentEvidence,
    selected: input.selected.selected,
    reasons: input.selected.reasons,
    repositorySnapshot: input.snapshot,
    registryDigest: input.registryDigest,
  });
  const bundlePath = writeBundle(input.projectRoot, bundle);
  return {
    status: "matched",
    bundlePath,
    bundle,
    evidence: { request: input.request.trim(), normalizedRequest: normalizeRequest(input.request), parentMatch: input.parentEvidence, childMatches: input.selected.evidence },
    telemetry: input.telemetry,
    transitionTrace: bundle.transitionTrace,
  };
}

export function routeDevelopmentRequest(options: RouteOptions): RouteDecision {
  const request = options.request.trim();
  if (request.length < 3 || request.length > 4000) throw new Error("Request must be 3..4000 characters");
  const projectRoot = resolve(options.projectRoot);
  const registry = loadRegistry(options.registryRoot ?? defaultRegistryRoot());
  const snapshot = snapshotRepository(projectRoot);
  const parentSearch = searchParent(registry, request);
  const telemetry: SearchTelemetry = { globalSearchCount: 1, scope: "registry:parents" };
  if (!parentSearch.selected || !parentSearch.selectedEvidence) {
    return abstain({
      request,
      reasonCodes: [parentSearch.reasonCode ?? "no-parent-match"],
      diagnostics: parentSearch.candidates.map((candidate) => `${candidate.id}:${candidate.score}`),
      telemetry,
    });
  }
  const parent = parentSearch.selected;
  const parentEvidence = parentSearch.selectedEvidence;
  const childSelection = selectChildren(parent, request);
  const evidence: DecisionEvidence = { request, normalizedRequest: normalizeRequest(request), parentMatch: parentEvidence, childMatches: childSelection.evidence };
  if (childSelection.kind === "question" && childSelection.question) {
    const sessionIdentity = {
      schemaVersion: "1.0" as const,
      request,
      normalizedRequest: normalizeRequest(request),
      parentSkillId: parent.document.id,
      registryDigest: registry.digest,
      snapshotDigest: snapshot.digest,
      stableSubskillIds: childSelection.selected.map((child) => child.document.id),
      question: childSelection.question,
    };
    const clarificationId = computeClarificationId(sessionIdentity);
    const question = {
      ...childSelection.question,
      clarificationId,
      rerunHint: `pnpm dev-route clarify ${clarificationId} <option-id> --project-root ${JSON.stringify(projectRoot)} --json`,
    };
    writeClarification(projectRoot, { ...sessionIdentity, clarificationId });
    const transitionTrace: TransitionRecord[] = [
      { sequence: 0, from: "global-search", to: parent.document.id, status: "completed", reason: parentEvidence.reasons.join(", ") },
      { sequence: 1, from: parent.document.id, to: clarificationId, status: "blocked", reason: childSelection.question.id },
    ];
    return { status: "needs_clarification", question, stableSubskillIds: childSelection.selected.map((child) => child.document.id), evidence, telemetry, transitionTrace };
  }
  return matchSelected({ request, projectRoot, registryDigest: registry.digest, parent, parentEvidence, selected: childSelection, snapshot, telemetry });
}

export function resumeClarification(options: ResumeOptions): RouteDecision {
  const projectRoot = resolve(options.projectRoot);
  const session = readClarification(projectRoot, options.clarificationId);
  const registry = loadRegistry(options.registryRoot ?? defaultRegistryRoot());
  const telemetry: SearchTelemetry = { globalSearchCount: 0, scope: `parent:${session.parentSkillId}:children` };
  const parent = registry.skills.find((skill) => skill.document.id === session.parentSkillId);
  const evidence = baseEvidence(session.request);
  if (!parent || registry.digest !== session.registryDigest) return abstain({ request: session.request, reasonCodes: ["stale-registry"], diagnostics: ["The checked-in skill registry changed after clarification."], evidence, telemetry });
  const snapshot = snapshotRepository(projectRoot);
  if (snapshot.digest !== session.snapshotDigest) return abstain({ request: session.request, reasonCodes: ["stale-project-snapshot"], diagnostics: ["The project changed after clarification; start a new route."], evidence, telemetry });
  const option = session.question.options.find((candidate) => candidate.id === options.optionId);
  if (!option) return abstain({ request: session.request, reasonCodes: ["invalid-clarification-option"], diagnostics: [`Expected one of: ${session.question.options.map((candidate) => candidate.id).join(", ")}`], evidence, telemetry });
  const parentEvidence = { id: parent.document.id, title: parent.document.title, score: 0, reasons: [`clarification:${session.question.id}:${option.id}`] };
  const selected = selectChildren(parent, session.request, option.selectedSubskillIds);
  return matchSelected({ request: session.request, projectRoot, registryDigest: registry.digest, parent, parentEvidence, selected, snapshot, telemetry });
}
