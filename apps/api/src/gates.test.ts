import { describe, expect, it } from "vitest";
import { evaluateReleaseGate } from "./gates.js";

const evidence = [
  { id: "workspace", kind: "environment" as const, description: "target", required: true, expected: "service-live" },
  { id: "scope", kind: "changed_scope" as const, description: "scope", required: true, expected: "service-live/" },
  { id: "tests", kind: "test" as const, description: "tests", required: true, expected: "true" },
];

describe("release gates", () => {
  it("blocks a passing test from the wrong checkout", () => {
    const result = evaluateReleaseGate(evidence, { environment: { workspace: "service-copy" }, changedFiles: ["service-copy/route.ts"], testPassed: true });
    expect(result.passed).toBe(false);
    expect(result.results.filter((item) => !item.passed)).toHaveLength(2);
  });

  it("passes only when every required evidence item passes", () => {
    expect(evaluateReleaseGate(evidence, { environment: { workspace: "service-live" }, changedFiles: ["service-live/route.ts"], testPassed: true }).passed).toBe(true);
  });
});
