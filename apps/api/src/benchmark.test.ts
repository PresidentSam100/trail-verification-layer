import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrailDatabase } from "./database.js";
import { loadCorpus } from "./corpus.js";
import { runBenchmark } from "./benchmark.js";

describe("hackathon benchmark", () => {
  let directory: string;
  let db: TrailDatabase;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "trail-bench-")); db = new TrailDatabase(join(directory, "test.db")); loadCorpus(db); });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it("runs all 48 condition runs and labels them as deterministic", () => {
    const report = runBenchmark(db);
    expect(report.endToEndRuns).toBe(48);
    expect(report.executor).toBe("deterministic-fixture");
    expect(report.metrics.guidedVerified.numerator).toBeGreaterThan(report.metrics.baselineVerified.numerator);
    expect(report.metrics.unsafeApprovals.guided).toBe(0);
    expect(report.ranking).toHaveLength(24);
  });
});
