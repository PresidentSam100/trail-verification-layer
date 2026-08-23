import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makePerfectTrace } from "./fixture.mjs";
import { parseTrace, scoreSuite } from "./score.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(readFileSync(resolve(root, "cases.json"), "utf8"));

function clone(value) {
  return structuredClone(value);
}

function step(trace, caseId, stepId) {
  return trace.cases.find((item) => item.caseId === caseId).steps.find((item) => item.stepId === stepId);
}

test("the suite stays narrow, transcript-grounded, and explicit", () => {
  assert.equal(suite.cases.length, 4);
  const golden = suite.cases.find((item) => item.primary);
  assert.equal(golden.id, "golden-existing-inference-site-ingestion-qa");
  assert.equal(golden.expectation.parent, "site-development");
  assert.equal(golden.expectation.clarification.necessary, false);
  assert.deepEqual(golden.expectation.requiredSubskills, [
    "product-discovery",
    "data-ingestion",
    "api-integration",
    "product-interface",
    "quality-assurance",
  ]);
  assert.deepEqual(golden.expectation.dependencies, [
    { before: "product-discovery", after: "data-ingestion", relation: "direct" },
    { before: "data-ingestion", after: "api-integration", relation: "direct" },
    { before: "data-ingestion", after: "product-interface", relation: "direct" },
    { before: "data-ingestion", after: "quality-assurance", relation: "direct" },
    { before: "api-integration", after: "quality-assurance", relation: "direct" },
    { before: "product-interface", after: "quality-assurance", relation: "direct" },
  ]);
  assert.equal(golden.expectation.globalSearch.maxTotal, 1);
  assert.equal(golden.expectation.nonBlockingWork.some((item) => item.includes("research-corpus")), true);
  assert.equal(golden.expectation.planCoverage.forbiddenSuccessSignals.some((item) => item.includes("row count")), true);
});

test("a perfect router trace earns every metric without using corpus size", () => {
  const report = scoreSuite(suite, makePerfectTrace(suite));
  assert.equal(report.pass, true, JSON.stringify(report.issues, null, 2));
  assert.equal(report.metrics.parentRecallAt1.value, 1);
  assert.equal(report.metrics.childF1.value, 1);
  assert.equal(report.metrics.forbiddenSelectionRate.value, 0);
  assert.equal(report.metrics.clarificationDiscrimination.value, 1);
  assert.equal(report.metrics.dagValidity.value, 1);
  assert.equal(report.metrics.noRepeatGlobalSearch.value, 1);
  assert.equal(report.metrics.bundleAtomicityAndSnapshot.value, 1);
  assert.equal(report.metrics.progressStateCorrectness.value, 1);
  assert.match(report.note, /Corpus row counts are not a success signal/);
});

test("the scorer catches misrouting, forbidden expansion, DAG cycles, repeat search, and progress regression", () => {
  const trace = makePerfectTrace(suite);
  const goldenRoute = step(trace, "golden-existing-inference-site-ingestion-qa", "route");
  goldenRoute.response.evidence.parentMatch.id = "inference-product";

  goldenRoute.response.bundle.selectedSubskills.push({
    id: "marketing",
    parentId: "site-development",
    title: "marketing",
    status: "pending",
    reasons: ["bad-expansion"],
    source: { relativePath: "site-development/marketing/SUBSKILL.md", digest: "a".repeat(64) },
  });

  const discovery = goldenRoute.response.bundle.plan.find((item) => item.subskillId === "product-discovery");
  discovery.dependsOn.push("quality-assurance.work");
  goldenRoute.response.bundle.todos.find((item) => item.id === discovery.id).dependsOn.push("quality-assurance.work");
  goldenRoute.response.bundle.graph.edges.push({ from: "quality-assurance.work", to: discovery.id });

  step(trace, "golden-existing-inference-site-ingestion-qa", "complete-data-ingestion").telemetry.globalSearchCount = 1;
  const final = step(trace, "golden-existing-inference-site-ingestion-qa", "complete-quality-assurance").response;
  const regressed = final.todos.find((item) => item.subskillId === "product-discovery");
  regressed.status = "pending";

  const report = scoreSuite(suite, trace);
  assert.equal(report.pass, false);
  assert.ok(report.metrics.parentRecallAt1.value < 1);
  assert.ok(report.metrics.childPrecision.value < 1);
  assert.ok(report.metrics.forbiddenSelectionRate.value > 0);
  assert.ok(report.metrics.dagValidity.value < 1);
  assert.ok(report.metrics.noRepeatGlobalSearch.value < 1);
  assert.ok(report.metrics.progressStateCorrectness.value < 1);
});

test("the adapter accepts one JSON object or JSONL case-step records", () => {
  const trace = makePerfectTrace(suite);
  const json = parseTrace(JSON.stringify(trace));
  assert.equal(scoreSuite(suite, json).pass, true);

  const records = trace.cases.flatMap((item) => item.steps.map((entry) => ({ caseId: item.caseId, ...entry })));
  const jsonl = records.map((record) => JSON.stringify(record)).join("\n");
  assert.equal(scoreSuite(suite, parseTrace(jsonl)).pass, true);
});
