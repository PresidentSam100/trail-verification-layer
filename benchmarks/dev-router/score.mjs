#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DECISION_STATUSES = new Set(["matched", "needs_clarification", "abstain"]);
const PROGRESS_STATUSES = new Set(["pending", "running", "blocked", "completed"]);
const SHA256 = /^[a-f0-9]{64}$/i;

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function strings(value) {
  return array(value).filter((item) => typeof item === "string");
}

function unique(values) {
  return [...new Set(values)];
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameSet(left, right) {
  const a = sorted(unique(left));
  const b = sorted(unique(right));
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(4));
}

function counter() {
  return { passed: 0, total: 0 };
}

function record(metric, passed) {
  metric.total += 1;
  if (passed) metric.passed += 1;
}

function responseOf(step) {
  if (!isObject(step)) return null;
  if (isObject(step.response)) return step.response;
  if (isObject(step.output)) return step.output;
  return step;
}

function telemetryOf(step, response) {
  if (isObject(step?.telemetry)) return step.telemetry;
  if (isObject(response?.telemetry)) return response.telemetry;
  return null;
}

function statusOf(response) {
  return DECISION_STATUSES.has(response?.status) ? response.status : null;
}

function parentOf(response) {
  const evidenceParent = response?.evidence?.parentMatch?.id;
  if (typeof evidenceParent === "string") return evidenceParent;
  const parentIds = strings(response?.bundle?.parentSkillIds);
  return parentIds[0] ?? null;
}

function selectedOf(response) {
  return unique(array(response?.bundle?.selectedSubskills).map((item) => item?.id).filter((id) => typeof id === "string"));
}

function viewOf(response) {
  const source = isObject(response?.bundle) ? response.bundle : response;
  if (!isObject(source) || typeof source.bundleId !== "string") return null;
  return {
    bundleId: source.bundleId,
    selectedSubskills: array(source.selectedSubskills),
    todos: array(source.todos),
    state: isObject(source.state) ? source.state : null,
    transitionTrace: array(source.transitionTrace),
  };
}

function addIssue(issues, caseId, stepId, metric, message) {
  issues.push({ caseId, stepId, metric, message });
}

function graphResult(nodesValue, edgesValue) {
  const nodes = strings(nodesValue);
  const edges = array(edgesValue).filter((edge) => isObject(edge) && typeof edge.from === "string" && typeof edge.to === "string");
  if (nodes.length !== unique(nodes).length) return { ok: false, reason: "graph contains duplicate nodes" };
  const nodeSet = new Set(nodes);
  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) return { ok: false, reason: `unknown edge endpoint ${edge.from} -> ${edge.to}` };
    if (edge.from === edge.to) return { ok: false, reason: `self edge ${edge.from}` };
  }
  const edgeKeys = edges.map((edge) => `${edge.from}\u0000${edge.to}`);
  if (edgeKeys.length !== unique(edgeKeys).length) return { ok: false, reason: "graph contains duplicate edges" };

  const incoming = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ready = nodes.filter((node) => incoming.get(node) === 0).sort();
  let visited = 0;
  while (ready.length > 0) {
    const node = ready.shift();
    visited += 1;
    for (const next of outgoing.get(node) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1);
      if (incoming.get(next) === 0) ready.push(next);
    }
  }
  return visited === nodes.length ? { ok: true } : { ok: false, reason: "graph contains a cycle" };
}

function dependencyResult(bundle, constraints) {
  const packets = array(bundle?.dispatchPackets);
  const packetBySubskill = new Map(packets.map((packet) => [packet?.subskillId, packet]));
  const outgoing = new Map([...packetBySubskill.keys()].map((id) => [id, []]));
  for (const packet of packets) {
    if (typeof packet?.subskillId !== "string") continue;
    for (const dependency of strings(packet.dependsOn)) {
      const before = dependency.startsWith("dispatch.") ? dependency.slice("dispatch.".length) : dependency;
      if (outgoing.has(before)) outgoing.get(before).push(packet.subskillId);
    }
  }

  function direct(before, after) {
    return (outgoing.get(before) ?? []).includes(after);
  }

  function reachable(before, after) {
    const pending = [...(outgoing.get(before) ?? [])];
    const seen = new Set();
    while (pending.length > 0) {
      const node = pending.shift();
      if (node === after) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      pending.push(...(outgoing.get(node) ?? []));
    }
    return false;
  }

  const failures = [];
  for (const constraint of array(constraints)) {
    if (!packetBySubskill.has(constraint.before) || !packetBySubskill.has(constraint.after)) {
      failures.push(`missing dependency endpoint ${constraint.before} -> ${constraint.after}`);
      continue;
    }
    const satisfied = constraint.relation === "direct"
      ? direct(constraint.before, constraint.after)
      : reachable(constraint.before, constraint.after);
    if (!satisfied) failures.push(`expected ${constraint.relation} dependency ${constraint.before} -> ${constraint.after}`);
  }
  return { ok: failures.length === 0, failures };
}

function bundleResult(response, expectedParent, expectedDependencies) {
  const failures = [];
  const bundle = response?.bundle;
  if (statusOf(response) !== "matched" || !isObject(bundle)) return { ok: false, failures: ["matched response did not contain a bundle"] };
  if (typeof response.bundlePath !== "string" || response.bundlePath.length === 0) failures.push("bundlePath missing");
  if (bundle.schemaVersion !== "1.0" || bundle.bundleVersion !== 1) failures.push("bundle version missing or unsupported");
  if (typeof bundle.bundleId !== "string" || bundle.bundleId.length < 8) failures.push("bundleId missing");
  if (strings(bundle.parentSkillIds)[0] !== expectedParent) failures.push("bundle parent does not match expected parent");

  const snapshot = bundle.repositorySnapshot;
  if (!isObject(snapshot) || snapshot.algorithm !== "sha256" || !SHA256.test(snapshot.digest ?? "")) failures.push("repository snapshot digest missing");
  if (!isObject(snapshot) || !Number.isInteger(snapshot.fileCount) || snapshot.fileCount < 0) failures.push("repository snapshot fileCount invalid");
  if (!isObject(snapshot) || !Number.isInteger(snapshot.totalBytes) || snapshot.totalBytes < 0) failures.push("repository snapshot totalBytes invalid");
  if (!isObject(snapshot) || !Array.isArray(snapshot.manifests) || !Array.isArray(snapshot.languages)) failures.push("repository snapshot inventory missing");
  if (!SHA256.test(bundle.registryDigest ?? "")) failures.push("registry digest missing");

  const selected = array(bundle.selectedSubskills);
  const selectedIds = selected.map((item) => item?.id).filter((id) => typeof id === "string");
  if (selectedIds.length === 0 || selectedIds.length !== unique(selectedIds).length) failures.push("selected subskills missing or duplicated");
  for (const item of selected) {
    if (item?.parentId !== expectedParent) failures.push(`selected subskill ${item?.id ?? "?"} has wrong parent`);
    if (!SHA256.test(item?.source?.digest ?? "") || typeof item?.source?.relativePath !== "string") failures.push(`selected subskill ${item?.id ?? "?"} source is not pinned`);
  }

  const plan = array(bundle.plan);
  const todos = array(bundle.todos);
  const packets = array(bundle.dispatchPackets);
  const graph = bundle.graph;
  const planIds = plan.map((item) => item?.id).filter((id) => typeof id === "string");
  const todoIds = todos.map((item) => item?.id).filter((id) => typeof id === "string");
  const graphNodes = strings(graph?.nodes);
  if (planIds.length === 0 || planIds.length !== unique(planIds).length) failures.push("plan steps missing or duplicated");
  if (!sameSet(planIds, todoIds) || !sameSet(planIds, graphNodes)) failures.push("plan, todo, and graph node sets differ");
  if (!sameSet(selectedIds, packets.map((packet) => packet?.subskillId).filter((id) => typeof id === "string"))) failures.push("dispatch packets do not cover selected subskills atomically");

  const edgeKeys = array(graph?.edges).map((edge) => `${edge?.from}\u0000${edge?.to}`);
  const planEdgeKeys = plan.flatMap((step) => strings(step?.dependsOn).map((dependency) => `${dependency}\u0000${step.id}`));
  if (!sameSet(edgeKeys, planEdgeKeys)) failures.push("graph edges differ from plan dependencies");
  const todoById = new Map(todos.map((todo) => [todo?.id, todo]));
  for (const step of plan) {
    const todo = todoById.get(step?.id);
    if (!todo || todo.subskillId !== step.subskillId || !sameSet(strings(todo.dependsOn), strings(step.dependsOn))) failures.push(`todo does not mirror plan step ${step?.id ?? "?"}`);
  }

  const graphCheck = graphResult(graph?.nodes, graph?.edges);
  if (!graphCheck.ok) failures.push(graphCheck.reason);
  const dependencyCheck = dependencyResult(bundle, expectedDependencies);
  failures.push(...dependencyCheck.failures);

  for (const packet of packets) {
    if (packet?.id !== `dispatch.${packet?.subskillId}`) failures.push(`dispatch id mismatch for ${packet?.subskillId ?? "?"}`);
    if (!sameSet(strings(packet?.taskIds), plan.filter((step) => step?.subskillId === packet?.subskillId).map((step) => step.id))) failures.push(`dispatch task set mismatch for ${packet?.subskillId ?? "?"}`);
    const pins = packet?.pinnedDigests;
    if (pins?.bundleId !== bundle.bundleId || pins?.repositorySnapshot !== snapshot?.digest || pins?.registry !== bundle.registryDigest) failures.push(`dispatch pins mismatch for ${packet?.subskillId ?? "?"}`);
    const skillDigest = selected.find((item) => item?.id === packet?.subskillId)?.source?.digest;
    if (pins?.skillSource !== skillDigest) failures.push(`dispatch source pin mismatch for ${packet?.subskillId ?? "?"}`);
    for (const dependency of strings(packet?.dependsOn)) {
      if (!packets.some((candidate) => candidate?.id === dependency)) failures.push(`dispatch dependency ${dependency} is outside the bundle`);
    }
  }
  return { ok: failures.length === 0, failures, graphOk: graphCheck.ok, dependenciesOk: dependencyCheck.ok };
}

function nonMatchedAtomicResult(response) {
  if (!isObject(response)) return { ok: false, reason: "decision response missing" };
  if (statusOf(response) === "matched") return { ok: true };
  const leaksBundle = Object.hasOwn(response, "bundle") || Object.hasOwn(response, "bundlePath");
  return leaksBundle ? { ok: false, reason: "non-matched decision exposed a partial bundle" } : { ok: true };
}

function questionResult(response, expectation) {
  const failures = [];
  const question = response?.question;
  if (statusOf(response) !== "needs_clarification" || !isObject(question)) return { ok: false, failures: ["clarification question missing"] };
  if (typeof question.clarificationId !== "string" || typeof question.prompt !== "string") failures.push("clarification identity or prompt missing");
  const normalizedPrompt = String(question.prompt ?? "").toLocaleLowerCase("en-US");
  for (const group of array(expectation.requiredConceptGroups)) {
    if (!strings(group).some((term) => normalizedPrompt.includes(term.toLocaleLowerCase("en-US")))) failures.push(`question does not cover one of: ${strings(group).join(" | ")}`);
  }
  const options = array(question.options);
  const fingerprints = options.map((option) => typeof option?.planFingerprint === "string" ? option.planFingerprint : canonical(sorted(strings(option?.selectedSubskillIds))));
  const minimum = expectation.minimumDistinctPlans ?? 2;
  if (new Set(fingerprints).size < minimum) failures.push(`question exposes fewer than ${minimum} distinct plans`);
  if (!options.some((option) => option?.id === expectation.expectedOptionId)) failures.push(`expected option ${expectation.expectedOptionId} missing`);
  return { ok: failures.length === 0, failures };
}

function statusViewResult(view) {
  const failures = [];
  if (!view || !isObject(view.state)) return { ok: false, failures: ["bundle status view missing"] };
  const todos = view.todos;
  const ids = todos.map((todo) => todo?.id).filter((id) => typeof id === "string");
  if (ids.length === 0 || ids.length !== unique(ids).length) failures.push("status todos missing or duplicated");
  const byId = new Map(todos.map((todo) => [todo?.id, todo]));
  for (const todo of todos) {
    if (!PROGRESS_STATUSES.has(todo?.status)) failures.push(`todo ${todo?.id ?? "?"} has invalid status`);
    for (const dependency of strings(todo?.dependsOn)) if (!byId.has(dependency)) failures.push(`todo ${todo?.id ?? "?"} has unknown dependency ${dependency}`);
  }
  const graph = graphResult(ids, todos.flatMap((todo) => strings(todo?.dependsOn).map((dependency) => ({ from: dependency, to: todo.id }))));
  if (!graph.ok) failures.push(graph.reason);

  const completed = new Set(todos.filter((todo) => todo?.status === "completed").map((todo) => todo.id));
  const running = todos.filter((todo) => todo?.status === "running").map((todo) => todo.id);
  const available = todos
    .filter((todo) => todo?.status === "pending" && strings(todo?.dependsOn).every((dependency) => completed.has(dependency)))
    .map((todo) => todo.id);
  if (!sameSet(strings(view.state.completed), [...completed])) failures.push("state.completed does not match completed todos");
  if (!sameSet(strings(view.state.currentNodes), running)) failures.push("state.currentNodes does not match running todos");
  if (!sameSet(strings(view.state.availableNext), available)) failures.push("state.availableNext violates dependency readiness");

  const selected = view.selectedSubskills;
  for (const subskill of selected) {
    const owned = todos.filter((todo) => todo?.subskillId === subskill?.id);
    if (owned.length === 0) {
      failures.push(`subskill ${subskill?.id ?? "?"} has no todos`);
      continue;
    }
    const expectedStatus = owned.every((todo) => todo.status === "completed")
      ? "completed"
      : owned.some((todo) => todo.status === "blocked")
        ? "blocked"
        : owned.some((todo) => todo.status === "running")
          ? "running"
          : "pending";
    if (subskill.status !== expectedStatus) failures.push(`subskill ${subskill.id} status ${subskill.status} should be ${expectedStatus}`);
  }
  return { ok: failures.length === 0, failures };
}

function stateExpectationResult(view, expected) {
  const failures = [];
  const todoById = new Map(view.todos.map((todo) => [todo?.id, todo]));
  const completedSubskills = view.selectedSubskills.filter((item) => item?.status === "completed").map((item) => item.id);
  const availableSubskills = unique(strings(view.state?.availableNext).map((todoId) => todoById.get(todoId)?.subskillId).filter((id) => typeof id === "string"));
  if (!sameSet(completedSubskills, strings(expected.completedSubskills))) failures.push(`completed subskills were ${sorted(completedSubskills).join(", ") || "none"}`);
  if (!sameSet(availableSubskills, strings(expected.availableSubskills))) failures.push(`available subskills were ${sorted(availableSubskills).join(", ") || "none"}`);
  for (const forbidden of strings(expected.unavailableSubskills)) if (availableSubskills.includes(forbidden)) failures.push(`${forbidden} became available too early`);
  return { ok: failures.length === 0, failures };
}

function comparableState(view) {
  return canonical({
    bundleId: view?.bundleId,
    selectedSubskills: array(view?.selectedSubskills).map((item) => ({ id: item?.id, status: item?.status })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    todos: array(view?.todos).map((item) => ({ id: item?.id, status: item?.status, dependsOn: sorted(strings(item?.dependsOn)) })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    state: view?.state,
  });
}

function coverageResult(bundle, expectation) {
  const planText = [
    bundle?.request,
    ...array(bundle?.selectedSubskills).flatMap((item) => [item?.title, ...strings(item?.reasons)]),
    ...array(bundle?.plan).flatMap((item) => [item?.title, item?.description, ...strings(item?.outputs), ...strings(item?.acceptance)]),
    ...array(bundle?.dispatchPackets).flatMap((item) => [item?.objective, ...strings(item?.constraints), ...strings(item?.deliverables), ...strings(item?.verification)]),
  ].filter((item) => typeof item === "string").join(" ").toLocaleLowerCase("en-US");
  const failures = [];
  for (const group of array(expectation?.requiredConceptGroups)) {
    if (!strings(group).some((term) => planText.includes(term.toLocaleLowerCase("en-US")))) failures.push(`plan misses one of: ${strings(group).join(" | ")}`);
  }
  for (const forbidden of strings(expectation?.forbiddenSuccessSignals)) {
    if (planText.includes(forbidden.toLocaleLowerCase("en-US"))) failures.push(`plan treats forbidden signal as success: ${forbidden}`);
  }
  return { ok: failures.length === 0, failures };
}

export function parseTrace(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Prediction trace is empty");
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}

export function normalizeTrace(input) {
  const rawCases = Array.isArray(input) ? input : Array.isArray(input?.cases) ? input.cases : [input];
  const cases = new Map();
  for (const item of rawCases) {
    if (!isObject(item)) continue;
    const caseId = item.caseId ?? item.id;
    if (typeof caseId !== "string") continue;
    if (!cases.has(caseId)) cases.set(caseId, { caseId, steps: [] });
    const target = cases.get(caseId);
    const itemSteps = Array.isArray(item.steps) ? item.steps : [item];
    for (const step of itemSteps) {
      if (!isObject(step)) continue;
      const stepId = step.stepId ?? step.id;
      if (typeof stepId === "string") target.steps.push({ ...step, stepId });
    }
  }
  return cases;
}

export function scoreSuite(suite, traceInput) {
  if (!isObject(suite) || !Array.isArray(suite.cases)) throw new Error("Suite must contain cases[]");
  const predictions = normalizeTrace(traceInput);
  const issues = [];
  const counters = {
    parentRecallAt1: counter(),
    clarificationNecessityAccuracy: counter(),
    clarificationDiscrimination: counter(),
    abstentionAccuracy: counter(),
    dagValidity: counter(),
    noRepeatGlobalSearch: counter(),
    bundleAtomicityAndSnapshot: counter(),
    progressStateCorrectness: counter(),
    sessionCoverage: counter(),
  };
  const child = { truePositive: 0, falsePositive: 0, falseNegative: 0 };
  let forbiddenHits = 0;
  let forbiddenOpportunities = 0;
  let forbiddenCaseViolations = 0;

  for (const testCase of suite.cases) {
    const caseId = testCase.id;
    const expectation = testCase.expectation;
    const predictedCase = predictions.get(caseId);
    const byStep = new Map(array(predictedCase?.steps).map((step) => [step.stepId, step]));
    const routeExpected = testCase.steps.find((step) => step.operation === "route");
    const routePrediction = routeExpected ? byStep.get(routeExpected.id) : null;
    const routeResponse = responseOf(routePrediction);
    const actualInitialStatus = statusOf(routeResponse);

    const needsQuestion = expectation.clarification?.necessary === true;
    const clarificationCorrect = (actualInitialStatus === "needs_clarification") === needsQuestion;
    record(counters.clarificationNecessityAccuracy, clarificationCorrect);
    if (!clarificationCorrect) addIssue(issues, caseId, routeExpected?.id ?? "route", "clarificationNecessityAccuracy", `expected clarification=${needsQuestion}, got ${actualInitialStatus ?? "missing"}`);

    const abstentionCorrect = (actualInitialStatus === "abstain") === (expectation.abstain === true);
    record(counters.abstentionAccuracy, abstentionCorrect);
    if (!abstentionCorrect) addIssue(issues, caseId, routeExpected?.id ?? "route", "abstentionAccuracy", `expected abstain=${expectation.abstain === true}, got ${actualInitialStatus ?? "missing"}`);

    if (needsQuestion) {
      const questionCheck = questionResult(routeResponse, expectation.clarification);
      record(counters.clarificationDiscrimination, questionCheck.ok);
      for (const failure of questionCheck.failures) addIssue(issues, caseId, routeExpected?.id ?? "route", "clarificationDiscrimination", failure);
    }

    const resolutionExpected = needsQuestion
      ? testCase.steps.find((step) => step.operation === "clarify")
      : routeExpected;
    const resolutionPrediction = resolutionExpected ? byStep.get(resolutionExpected.id) : null;
    const resolutionResponse = responseOf(resolutionPrediction);
    const expectedResolvedStatus = expectation.resolvedStatus;

    if (expectedResolvedStatus === "matched") {
      const parentCorrect = parentOf(resolutionResponse) === expectation.parent;
      record(counters.parentRecallAt1, parentCorrect);
      if (!parentCorrect) addIssue(issues, caseId, resolutionExpected?.id ?? "route", "parentRecallAt1", `expected ${expectation.parent}, got ${parentOf(resolutionResponse) ?? "none"}`);

      const predictedChildren = selectedOf(resolutionResponse);
      const required = unique(strings(expectation.requiredSubskills));
      const allowed = new Set(unique(strings(expectation.allowedSubskills).length > 0 ? strings(expectation.allowedSubskills) : required));
      const requiredSet = new Set(required);
      child.truePositive += predictedChildren.filter((id) => requiredSet.has(id)).length;
      child.falsePositive += predictedChildren.filter((id) => !allowed.has(id)).length;
      child.falseNegative += required.filter((id) => !predictedChildren.includes(id)).length;

      const forbidden = unique(strings(expectation.forbiddenSubskills));
      const hits = predictedChildren.filter((id) => forbidden.includes(id));
      forbiddenHits += hits.length;
      forbiddenOpportunities += forbidden.length;
      if (hits.length > 0) {
        forbiddenCaseViolations += 1;
        addIssue(issues, caseId, resolutionExpected?.id ?? "route", "forbiddenSelectionRate", `selected forbidden subskills: ${hits.join(", ")}`);
      }

      const bundleCheck = bundleResult(resolutionResponse, expectation.parent, expectation.dependencies);
      record(counters.dagValidity, bundleCheck.graphOk === true && bundleCheck.dependenciesOk === true);
      record(counters.bundleAtomicityAndSnapshot, bundleCheck.ok);
      for (const failure of bundleCheck.failures) {
        const metric = failure.includes("dependency") || failure.includes("graph") || failure.includes("cycle") ? "dagValidity" : "bundleAtomicityAndSnapshot";
        addIssue(issues, caseId, resolutionExpected?.id ?? "route", metric, failure);
      }

      if (expectation.planCoverage) {
        const coverage = coverageResult(resolutionResponse?.bundle, expectation.planCoverage);
        record(counters.sessionCoverage, coverage.ok);
        for (const failure of coverage.failures) addIssue(issues, caseId, resolutionExpected?.id ?? "route", "sessionCoverage", failure);
      }
    } else {
      const atomic = nonMatchedAtomicResult(resolutionResponse);
      record(counters.bundleAtomicityAndSnapshot, atomic.ok);
      if (!atomic.ok) addIssue(issues, caseId, resolutionExpected?.id ?? "route", "bundleAtomicityAndSnapshot", atomic.reason);
    }

    if (needsQuestion) {
      const initialAtomic = nonMatchedAtomicResult(routeResponse);
      record(counters.bundleAtomicityAndSnapshot, initialAtomic.ok);
      if (!initialAtomic.ok) addIssue(issues, caseId, routeExpected?.id ?? "route", "bundleAtomicityAndSnapshot", initialAtomic.reason);
      if (statusOf(resolutionResponse) !== expectedResolvedStatus) addIssue(issues, caseId, resolutionExpected?.id ?? "clarify", "clarificationDiscrimination", `clarification resolved to ${statusOf(resolutionResponse) ?? "missing"}`);
    }

    let searchOk = true;
    let totalSearches = 0;
    for (const expectedStep of testCase.steps) {
      const predictedStep = byStep.get(expectedStep.id);
      const response = responseOf(predictedStep);
      const telemetry = telemetryOf(predictedStep, response);
      const actual = telemetry?.globalSearchCount;
      if (actual !== expectedStep.globalSearchCount) {
        searchOk = false;
        addIssue(issues, caseId, expectedStep.id, "noRepeatGlobalSearch", `expected globalSearchCount=${expectedStep.globalSearchCount}, got ${actual ?? "missing"}`);
      }
      if (Number.isInteger(actual)) totalSearches += actual;
    }
    if (totalSearches > expectation.globalSearch.maxTotal) {
      searchOk = false;
      addIssue(issues, caseId, "*", "noRepeatGlobalSearch", `global search ran ${totalSearches} times; maximum is ${expectation.globalSearch.maxTotal}`);
    }
    record(counters.noRepeatGlobalSearch, searchOk);

    if (expectation.bundle?.stableAcrossProgress && expectedResolvedStatus === "matched") {
      const baseView = viewOf(resolutionResponse);
      let previousView = baseView;
      const viewByStep = new Map();
      if (resolutionExpected && baseView) viewByStep.set(resolutionExpected.id, baseView);
      const expectedSelected = strings(expectation.requiredSubskills);
      if (resolutionExpected?.expectedState) {
        let ok = true;
        if (!baseView) {
          ok = false;
          addIssue(issues, caseId, resolutionExpected.id, "progressStateCorrectness", "initial matched bundle has no progress state");
        } else {
          const intrinsic = statusViewResult(baseView);
          if (!intrinsic.ok) ok = false;
          for (const failure of intrinsic.failures) addIssue(issues, caseId, resolutionExpected.id, "progressStateCorrectness", failure);
          const expectedState = stateExpectationResult(baseView, resolutionExpected.expectedState);
          if (!expectedState.ok) ok = false;
          for (const failure of expectedState.failures) addIssue(issues, caseId, resolutionExpected.id, "progressStateCorrectness", failure);
        }
        record(counters.progressStateCorrectness, ok);
      }
      for (const expectedStep of testCase.steps) {
        if (expectedStep.id === resolutionExpected?.id || (expectedStep.operation !== "complete_subskill" && expectedStep.operation !== "status")) continue;
        const prediction = byStep.get(expectedStep.id);
        const view = viewOf(responseOf(prediction));
        let ok = true;
        if (!view) {
          ok = false;
          addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", "progress/status response missing bundle state");
        } else {
          viewByStep.set(expectedStep.id, view);
          if (view.bundleId !== baseView?.bundleId) {
            ok = false;
            addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", "bundleId changed during child progress");
          }
          if (!sameSet(view.selectedSubskills.map((item) => item?.id).filter((id) => typeof id === "string"), expectedSelected)) {
            ok = false;
            addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", "selected child set changed during progress");
          }
          const intrinsic = statusViewResult(view);
          if (!intrinsic.ok) ok = false;
          for (const failure of intrinsic.failures) addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", failure);
          if (expectedStep.expectedState) {
            const expectedState = stateExpectationResult(view, expectedStep.expectedState);
            if (!expectedState.ok) ok = false;
            for (const failure of expectedState.failures) addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", failure);
          }
          if (expectedStep.sameStateAs) {
            const prior = viewByStep.get(expectedStep.sameStateAs);
            if (!prior || comparableState(prior) !== comparableState(view)) {
              ok = false;
              addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", `status response changed state from ${expectedStep.sameStateAs}`);
            }
          }
          if (previousView) {
            const priorStatuses = new Map(previousView.todos.map((todo) => [todo?.id, todo?.status]));
            for (const todo of view.todos) {
              if (priorStatuses.get(todo?.id) === "completed" && todo?.status !== "completed") {
                ok = false;
                addIssue(issues, caseId, expectedStep.id, "progressStateCorrectness", `completed todo ${todo.id} was repeated or regressed`);
              }
            }
          }
          previousView = view;
        }
        record(counters.progressStateCorrectness, ok);
      }
    }
  }

  const childPrecision = ratio(child.truePositive, child.truePositive + child.falsePositive);
  const childRecall = ratio(child.truePositive, child.truePositive + child.falseNegative);
  const childF1 = childPrecision + childRecall === 0 ? 0 : Number((2 * childPrecision * childRecall / (childPrecision + childRecall)).toFixed(4));
  const metricReport = {};
  for (const [name, value] of Object.entries(counters)) {
    metricReport[name] = { value: ratio(value.passed, value.total), ...value };
  }
  metricReport.childPrecision = { value: childPrecision, truePositive: child.truePositive, falsePositive: child.falsePositive };
  metricReport.childRecall = { value: childRecall, truePositive: child.truePositive, falseNegative: child.falseNegative };
  metricReport.childF1 = { value: childF1 };
  metricReport.forbiddenSelectionRate = {
    value: ratio(forbiddenHits, forbiddenOpportunities),
    hits: forbiddenHits,
    opportunities: forbiddenOpportunities,
    caseViolationRate: ratio(forbiddenCaseViolations, suite.cases.filter((item) => item.expectation.resolvedStatus === "matched").length),
  };

  const higherIsPerfect = [
    metricReport.parentRecallAt1.value,
    metricReport.childPrecision.value,
    metricReport.childRecall.value,
    metricReport.childF1.value,
    metricReport.clarificationNecessityAccuracy.value,
    metricReport.clarificationDiscrimination.value,
    metricReport.abstentionAccuracy.value,
    metricReport.dagValidity.value,
    metricReport.noRepeatGlobalSearch.value,
    metricReport.bundleAtomicityAndSnapshot.value,
    metricReport.progressStateCorrectness.value,
    metricReport.sessionCoverage.value,
  ];
  const pass = higherIsPerfect.every((value) => value === 1) && metricReport.forbiddenSelectionRate.value === 0;
  return {
    schemaVersion: "1.0",
    suiteId: suite.suiteId,
    caseCount: suite.cases.length,
    pass,
    note: "Routing success is defined by parent/child decisions, dependency and state invariants, and product evidence. Corpus row counts are not a success signal.",
    metrics: metricReport,
    issues,
  };
}

function parseArgs(argv) {
  const args = { cases: resolve(dirname(fileURLToPath(import.meta.url)), "cases.json"), predictions: null, requirePerfect: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--cases") args.cases = resolve(argv[++index]);
    else if (value === "--predictions") args.predictions = resolve(argv[++index]);
    else if (value === "--require-perfect") args.requirePerfect = true;
    else if (!value.startsWith("-") && !args.predictions) args.predictions = resolve(value);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.predictions) throw new Error("Usage: node score.mjs --predictions <trace.json|trace.jsonl> [--cases cases.json] [--require-perfect]");
    const suite = JSON.parse(readFileSync(args.cases, "utf8"));
    const trace = parseTrace(readFileSync(args.predictions, "utf8"));
    const report = scoreSuite(suite, trace);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (args.requirePerfect && !report.pass) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
