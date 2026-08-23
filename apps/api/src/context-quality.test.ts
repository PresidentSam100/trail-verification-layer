import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { config } from "./config.js";
import { TrailDatabase } from "./database.js";
import { compileContext } from "./context.js";

describe("context quality benchmark", () => {
  it("retains every labeled negative constraint as an exact source quote", async () => {
    const cases = JSON.parse(readFileSync(join(config.benchmarkPath, "context-quality.json"), "utf8")) as Array<{ task: string; mustRetain: string }>;
    const db = new TrailDatabase(":memory:");
    try {
      for (const item of cases) {
        const result = await compileContext(db, { task: item.task, environment: { client: "codex", workspace: "quality-fixture" }, trigger: "start", evidenceState: {} });
        const quotes = result.bundle.directives.filter((directive) => directive.type === "negative_constraint").map((directive) => directive.source.sourceQuote);
        expect(quotes).toContain(item.mustRetain);
        expect(item.task).toContain(item.mustRetain);
      }
    } finally { db.close(); }
  });
});
