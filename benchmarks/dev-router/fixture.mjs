#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIGEST = "a".repeat(64);

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function unique(values) {
  return [...new Set(values)];
}

function directDependencies(testCase, subskillId) {
  return unique(testCase.expectation.dependencies
    .filter((constraint) => constraint.after === subskillId)
    .map((constraint) => constraint.before));
}

function deriveStatus(bundle, completedSubskills) {
  const completed = new Set(completedSubskills);
  const todos = bundle.todos.map((todo) => ({
    ...todo,
    status: completed.has(todo.subskillId) ? "completed" : "pending",
  }));
  const completedTodoIds = new Set(todos.filter((todo) => todo.status === "completed").map((todo) => todo.id));
  const availableNext = todos
    .filter((todo) => todo.status === "pending" && todo.dependsOn.every((dependency) => completedTodoIds.has(dependency)))
    .map((todo) => todo.id)
    .sort();
  const blocked = todos
    .filter((todo) => todo.status === "pending" && !availableNext.includes(todo.id))
    .map((todo) => ({ todoId: todo.id, blockedBy: todo.dependsOn.filter((dependency) => !completedTodoIds.has(dependency)).sort() }))
    .sort((left, right) => left.todoId.localeCompare(right.todoId));
  const selectedSubskills = bundle.selectedSubskills.map((item) => ({
    id: item.id,
    title: item.title,
    status: completed.has(item.id) ? "completed" : "pending",
    todoIds: todos.filter((todo) => todo.subskillId === item.id).map((todo) => todo.id),
  }));
  return {
    bundleId: bundle.bundleId,
    bundlePath: `.trail/dev-router/bundles/${bundle.bundleId}.json`,
    selectedSubskills,
    todos: todos.map((todo) => ({ ...todo, blockedBy: blocked.find((item) => item.todoId === todo.id)?.blockedBy ?? [] })),
    state: {
      currentNodes: [],
      availableNext,
      unlocked: unique([...completedTodoIds, ...availableNext]).sort(),
      completed: [...completedTodoIds].sort(),
      blocked,
    },
    transitionTrace: bundle.transitionTrace,
    eventCount: completed.size,
  };
}

function makeBundle(testCase) {
  const ids = testCase.expectation.requiredSubskills;
  const bundleId = `plan-${testCase.id.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}`;
  const coverageText = testCase.expectation.planCoverage
    ? testCase.expectation.planCoverage.requiredConceptGroups.map((group) => group[0]).join("; ")
    : "inspect, implement, and verify the requested scope";
  const selectedSubskills = ids.map((id) => ({
    id,
    parentId: testCase.expectation.parent,
    title: id.replaceAll("-", " "),
    status: "pending",
    reasons: ["fixture-expectation"],
    source: { relativePath: `${testCase.expectation.parent}/${id}/SUBSKILL.md`, digest: DIGEST },
  }));
  const plan = ids.map((id) => ({
    id: `${id}.work`,
    subskillId: id,
    title: `Complete ${id}`,
    kind: id === "quality-assurance" ? "verify" : id === "product-discovery" ? "inspect" : "implement",
    description: `${coverageText}. Complete ${id} without using background research indexing as success evidence.`,
    dependsOn: directDependencies(testCase, id).map((dependency) => `${dependency}.work`).sort(),
    outputs: [`${id} deliverable`],
    acceptance: [`${id} observable acceptance evidence`],
  }));
  const edges = plan.flatMap((step) => step.dependsOn.map((dependency) => ({ from: dependency, to: step.id })))
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
  const transitionTrace = [
    { sequence: 0, from: "global-search", to: testCase.expectation.parent, status: "completed", reason: "fixture parent match" },
    ...ids.map((id, index) => ({ sequence: index + 1, from: testCase.expectation.parent, to: id, status: "pending", reason: "fixture child match" })),
  ];
  const seed = {
    schemaVersion: "1.0",
    bundleVersion: 1,
    bundleId,
    request: testCase.request,
    normalizedRequest: testCase.request.toLocaleLowerCase("en-US"),
    repositorySnapshot: {
      algorithm: "sha256",
      digest: DIGEST,
      fileCount: 42,
      totalBytes: 4096,
      head: "fixture-head",
      manifests: ["package.json"],
      languages: ["TypeScript"],
    },
    registryDigest: DIGEST,
    parentSkillIds: [testCase.expectation.parent],
    selectedSubskills,
    graph: { nodes: plan.map((step) => step.id).sort(), edges },
    plan,
    todos: plan.map((step) => ({ id: step.id, subskillId: step.subskillId, title: step.title, status: "pending", dependsOn: [...step.dependsOn] })),
    transitionTrace,
  };
  const dispatchPackets = ids.map((id) => ({
    id: `dispatch.${id}`,
    subskillId: id,
    objective: `Deliver ${id}`,
    taskIds: [`${id}.work`],
    dependsOn: directDependencies(testCase, id).map((dependency) => `dispatch.${dependency}`).sort(),
    allowedPaths: ["apps/**"],
    constraints: ["Preserve the observed product boundary"],
    deliverables: [`${id} deliverable`],
    verification: [`Verify ${id}`],
    bounds: { maxFiles: 12, maxTurns: 12, allowDelegation: false },
    pinnedDigests: { bundleId, repositorySnapshot: DIGEST, registry: DIGEST, skillSource: DIGEST },
  }));
  const bundle = { ...seed, dispatchPackets, state: null };
  bundle.state = deriveStatus(bundle, []).state;
  return bundle;
}

function matchedResponse(testCase, bundle, globalSearchCount) {
  return {
    status: "matched",
    bundlePath: `.trail/dev-router/bundles/${bundle.bundleId}.json`,
    bundle,
    evidence: {
      request: testCase.request,
      normalizedRequest: testCase.request.toLocaleLowerCase("en-US"),
      parentMatch: { id: testCase.expectation.parent, title: testCase.expectation.parent, score: 100, reasons: ["fixture"] },
      childMatches: testCase.expectation.requiredSubskills.map((id) => ({ id, score: 10, reasons: ["fixture"], selected: true })),
    },
    telemetry: { globalSearchCount, scope: globalSearchCount === 1 ? "global-parent" : `parent:${testCase.expectation.parent}` },
    transitionTrace: bundle.transitionTrace,
  };
}

function questionResponse(testCase) {
  const expected = testCase.expectation.clarification;
  return {
    status: "needs_clarification",
    question: {
      clarificationId: `clarify-${testCase.id}`,
      id: "inference-product-scope",
      prompt: "Does the inference API/backend already work, so I should finish the customer site/dashboard and product around it, or should I build the inference core?",
      options: [
        {
          id: expected.expectedOptionId,
          label: "Existing API, full product",
          description: "Build the site, formal ingestion, integration, interface, and QA around the existing backend.",
          selectedSubskillIds: [...testCase.expectation.requiredSubskills],
          planFingerprint: "existing-api-full-product-plan",
        },
        {
          id: "inference-core",
          label: "Inference core",
          description: "Implement the model-serving core first.",
          selectedSubskillIds: ["inference-api"],
          planFingerprint: "inference-core-plan",
        },
      ],
      rerunHint: `clarify clarify-${testCase.id} ${expected.expectedOptionId}`,
    },
    stableSubskillIds: [],
    evidence: {
      request: testCase.request,
      normalizedRequest: testCase.request.toLocaleLowerCase("en-US"),
      parentMatch: { id: testCase.expectation.parent, title: testCase.expectation.parent, score: 20, reasons: ["fixture"] },
      childMatches: [],
    },
    telemetry: { globalSearchCount: 1, scope: "global-parent" },
    transitionTrace: [],
  };
}

export function makePerfectTrace(suite) {
  return {
    schemaVersion: "1.0",
    suiteId: suite.suiteId,
    cases: suite.cases.map((testCase) => {
      if (testCase.expectation.abstain) {
        return {
          caseId: testCase.id,
          steps: [{
            stepId: "route",
            response: {
              status: "abstain",
              reasonCodes: ["no-parent-match"],
              diagnostics: ["No development route matched."],
              evidence: { request: testCase.request, normalizedRequest: testCase.request.toLocaleLowerCase("en-US"), parentMatch: null, childMatches: [] },
              telemetry: { globalSearchCount: 1, scope: "global-parent" },
              transitionTrace: [],
            },
          }],
        };
      }

      const bundle = makeBundle(testCase);
      const steps = [];
      if (testCase.expectation.clarification.necessary) {
        steps.push({ stepId: "route", response: questionResponse(testCase) });
        steps.push({ stepId: "clarify", optionId: testCase.clarificationAnswer.optionId, response: matchedResponse(testCase, bundle, 0) });
      } else {
        steps.push({ stepId: "route", response: matchedResponse(testCase, bundle, 1) });
      }

      const completed = [];
      for (const expectedStep of testCase.steps) {
        if (expectedStep.operation === "complete_subskill") {
          completed.push(expectedStep.subskillId);
          steps.push({
            stepId: expectedStep.id,
            telemetry: { globalSearchCount: 0, scope: `bundle:${bundle.bundleId}` },
            response: deriveStatus(bundle, completed),
          });
        } else if (expectedStep.operation === "status") {
          steps.push({
            stepId: expectedStep.id,
            telemetry: { globalSearchCount: 0, scope: `bundle:${bundle.bundleId}` },
            response: deriveStatus(bundle, completed),
          });
        }
      }
      return { caseId: testCase.id, steps };
    }),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const suitePath = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), "cases.json");
  const suite = JSON.parse(readFileSync(suitePath, "utf8"));
  process.stdout.write(`${JSON.stringify(makePerfectTrace(suite), null, 2)}\n`);
}
