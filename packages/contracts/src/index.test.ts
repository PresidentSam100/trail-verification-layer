import { describe, expect, it } from "vitest";
import { TrailSchema } from "./index.js";

describe("TrailSchema", () => {
  it("rejects a trail without evidence", () => {
    expect(() =>
      TrailSchema.parse({
        schemaVersion: "1.0",
        id: "bad",
        title: "Bad",
        summary: "Missing evidence",
        taskFamily: "test",
        intent: "test",
        provenance: { provider: "benchmark", sourceHash: "12345678", sourceRange: "1-2", redacted: true },
        environment: {},
        preconditions: [],
        negativeConstraints: [],
        triggers: ["start"],
        failureSignatures: [],
        steps: [{ id: "one", action: "guess", tool: "inspect", evidence: [], onFailure: "stop" }],
        applicability: [],
        invalidators: [],
        outcome: "none",
        confidence: 0.1,
        reviewStatus: "draft",
        tags: [],
      }),
    ).toThrow();
  });
});
