import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextBundleSchema } from "@trail/contracts";
import { TrailDatabase } from "./database.js";
import { verifyContext } from "./verification.js";

describe("context evidence verification", () => {
  let directory: string;
  let db: TrailDatabase;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "trail-verify-"));
    execFileSync("git", ["init", "-q"], { cwd: directory });
    writeFileSync(join(directory, "proof.txt"), "initial\n");
    execFileSync("git", ["add", "proof.txt"], { cwd: directory });
    execFileSync("git", ["-c", "user.name=TRAIL", "-c", "user.email=trail@example.invalid", "commit", "-qm", "fixture"], { cwd: directory });
    db = new TrailDatabase(join(directory, "private.db"));
  });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  const bundle = () => ContextBundleSchema.parse({
    schemaVersion: "1.0", id: "bundle-verification", parentId: null, status: "ready", originalPrompt: "Run the approved check", trigger: "release",
    environment: {}, missingEnvironment: [], directives: [{ id: "d1", text: "Run the approved check", type: "goal", source: { kind: "current_request", sourceQuote: "Run the approved check" } }],
    route: [], evidence: [{ id: "tests", kind: "test", description: "Approved check passes", required: true, expected: "true" }],
    stopConditions: ["Stop on failure"], matchedTrails: [], rejectedTrails: [], compiledPrompt: "proof", recoveryCount: 0, createdAt: new Date().toISOString(),
  });

  it("blocks agent prose when no approved adapter exists", async () => {
    const item = bundle(); db.saveContextBundle(item);
    const result = await verifyContext(db, item, directory, []);
    expect(result.passed).toBe(false);
    expect(result.observations[0]?.observed).toContain("no approved named check");
  });

  it("runs only a human-owned named command and records evidence", async () => {
    writeFileSync(join(directory, ".trailrc.json"), JSON.stringify({ version: 1, checks: [{ name: "safe", command: ["node", "-e", "process.exit(0)"] }] }));
    const item = bundle(); db.saveContextBundle(item);
    const result = await verifyContext(db, item, directory, ["safe"]);
    expect(result.passed).toBe(true);
    expect(result.observations[0]?.verifier).toBe("check:safe");
    expect(db.getEvidenceObservations(item.id)).toHaveLength(1);
  });
});
