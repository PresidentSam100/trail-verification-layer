import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrailDatabase } from "./database.js";
import { loadCorpus } from "./corpus.js";
import { ensureActivePolicy } from "./policy.js";
import { retrieveTrails } from "./retrieval.js";

describe("environment-first retrieval", () => {
  let directory: string;
  let db: TrailDatabase;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "trail-test-")); db = new TrailDatabase(join(directory, "test.db")); loadCorpus(db); });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  it("selects the visible checkout trail and explains the match", () => {
    const result = retrieveTrails(db, { intent: "fix production route in the visible checkout", environment: { client: "codex", workspace: "service-live" }, trigger: "start", evidenceState: {}, limit: 3 }, ensureActivePolicy(db));
    expect(result.matches[0]?.trail.id).toBe("trail-visible-checkout");
    expect(result.matches[0]?.matchReasons.some((reason) => reason.includes("workspace matches"))).toBe(true);
  });

  it("rejects a near match when mandatory environment fields disagree", () => {
    const result = retrieveTrails(db, { intent: "fix production route in the visible checkout", environment: { client: "codex", workspace: "service-copy" }, trigger: "start", evidenceState: {}, limit: 3 }, ensureActivePolicy(db));
    expect(result.matches.some((match) => match.trail.id === "trail-visible-checkout")).toBe(false);
    expect(result.rejected.find((match) => match.trail.id === "trail-visible-checkout")?.rejectedReasons.join(" ")).toContain("workspace mismatch");
  });

  it("returns no trail when only the trigger overlaps", () => {
    const result = retrieveTrails(db, {
      intent: "Tune an underwater telescope on an unknown mainframe",
      environment: { os: "plan9", client: "quantum-console", workspace: "abyss" },
      trigger: "start",
      evidenceState: {},
      limit: 3,
    }, ensureActivePolicy(db));
    expect(result.matches).toEqual([]);
    expect(result.rejected[0]?.rejectedReasons.length).toBeGreaterThan(0);
  });
});
