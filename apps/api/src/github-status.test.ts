import { describe, expect, it } from "vitest";
import { ContextBundleSchema, EvidenceObservationSchema } from "@trail/contracts";
import { assertSuccessEligible, publishVerificationStatus } from "./github-status.js";

describe("GitHub status boundary", () => {
  it("rejects unresolved repositories and SHAs before invoking gh", () => {
    expect(() => publishVerificationStatus({ repo: "*", sha: "main", state: "success", description: "bad" })).toThrow("owner/name");
    expect(() => publishVerificationStatus({ repo: "owner/repo", sha: "main", state: "success", description: "bad" })).toThrow("Commit SHA");
  });

  it("requires the latest observation for every required gate to pass", () => {
    const bundle = ContextBundleSchema.parse({
      schemaVersion: "1.0", id: "release-bundle", parentId: null, status: "ready", originalPrompt: "Verify this release", trigger: "release",
      environment: {}, missingEnvironment: [], directives: [{ id: "d1", text: "Verify this release", type: "goal", source: { kind: "current_request", sourceQuote: "Verify this release" } }],
      route: [], evidence: [{ id: "tests", kind: "test", description: "Tests pass", required: true, expected: "pass" }],
      stopConditions: [], matchedTrails: [], rejectedTrails: [], compiledPrompt: "proof", recoveryCount: 0, createdAt: "2026-08-23T12:00:00.000Z",
    });
    const observation = (passed: boolean, timestamp: string) => EvidenceObservationSchema.parse({
      id: `observation-${timestamp}`, bundleId: bundle.id, evidenceId: "tests", verifier: "check:test", expected: "pass", observed: passed ? "exit 0" : "exit 1", passed, timestamp,
    });

    expect(() => assertSuccessEligible(bundle, [])).toThrow("not fully verified");
    expect(() => assertSuccessEligible(bundle, [observation(true, "2026-08-23T12:01:00.000Z")])).not.toThrow();
    expect(() => assertSuccessEligible(bundle, [observation(true, "2026-08-23T12:01:00.000Z"), observation(false, "2026-08-23T12:02:00.000Z")])).toThrow("not fully verified");
    expect(() => assertSuccessEligible(bundle, [observation(false, "2026-08-23T12:01:00.000Z"), observation(true, "2026-08-23T12:02:00.000Z")])).not.toThrow();
  });
});
