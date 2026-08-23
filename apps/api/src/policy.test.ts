import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrailDatabase } from "./database.js";
import { ensureActivePolicy, evaluatePolicy, proposePolicy } from "./policy.js";

describe("bounded policy improvement", () => {
  let directory: string;
  let db: TrailDatabase;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "trail-policy-")); db = new TrailDatabase(join(directory, "test.db")); ensureActivePolicy(db); });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it("adopts an immutable candidate only when held-out results improve", () => {
    const candidate = proposePolicy(db, "environment fix");
    const result = evaluatePolicy(db, candidate);
    expect(result.accepted).toBe(true);
    expect(db.getActivePolicy()?.id).toBe(candidate.id);
    expect(db.getActivePolicy()?.status).toBe("active");
    expect(db.getPolicies().find((policy) => policy.id === "policy-v1")?.status).toBe("rejected");
    expect(candidate.parentId).toBe("policy-v1");
  });

  it("rejects a candidate with an unsafe approval", () => {
    const candidate = proposePolicy(db, "unsafe change");
    const result = evaluatePolicy(db, candidate, {
      baseline: { verifiedSuccess: 6, unsafeApprovals: 0, familyScores: { environment: 1 }, recallAt1: 0.7, mrr: 0.8 },
      candidate: { verifiedSuccess: 7, unsafeApprovals: 1, familyScores: { environment: 2 }, recallAt1: 0.8, mrr: 0.85 },
    });
    expect(result.accepted).toBe(false);
    expect(db.getActivePolicy()?.id).toBe("policy-v1");
  });
});
