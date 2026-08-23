import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillPath = resolve(import.meta.dirname, "..", "SKILL.md");

test("skill triggers from ordinary development language", async () => {
  const skill = await readFile(skillPath, "utf8");
  for (const trigger of ["build", "implement", "fix", "debug", "refactor", "test"]) {
    assert.match(skill.split("---", 3)[1], new RegExp(`\\b${trigger}\\b`, "i"));
  }
  assert.match(skill, /user says `build X`/);
  assert.match(skill, /Never ask the user to run a skill search/i);
});

test("skill pins the one-search stateful routing protocol", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /global router exactly once/i);
  assert.match(skill, /explicit `SUBSKILL` transitions/i);
  assert.match(skill, /PlanBundle dependency graph/i);
  assert.match(skill, /append-only `progress`/i);
  assert.match(skill, /clarify <question\.clarificationId> <optionId>/);
  assert.match(skill, /zero new global searches/i);
  assert.match(skill, /telemetry\.globalSearchCount/);
});

test("skill handles every outcome and bounded branch dispatch", async () => {
  const skill = await readFile(skillPath, "utf8");
  for (const status of ["matched", "needs_clarification", "abstain"]) {
    assert.match(skill, new RegExp("### `" + status + "`"));
  }
  assert.match(skill, /at most four children concurrently/i);
  assert.match(skill, /optional\/background research-corpus branch must never delay/i);
});

test("canonical broad request stays a single parent route", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /existing inference product/i);
  assert.match(skill, /build the rest of the entire site, add data ingestion, then test it/i);
  assert.match(skill, /API\/storage ingestion branch and the responsive product-UI branch/i);
  assert.match(skill, /previewed → drafted → approved/);
  assert.match(skill, /tests, build, typecheck, and live\/browser QA/i);
  for (const id of [
    "site-development",
    "product-discovery",
    "data-ingestion",
    "api-integration",
    "product-interface",
    "quality-assurance",
  ]) {
    assert.match(skill, new RegExp(`\\b${id}\\b`));
  }
  assert.match(skill, /Deployment is not implicit/i);
});

test("repo-local Codex and Claude entrypoints make routing automatic", async () => {
  const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..");
  const [agents, claude] = await Promise.all([
    readFile(resolve(repositoryRoot, "AGENTS.md"), "utf8"),
    readFile(resolve(repositoryRoot, "CLAUDE.md"), "utf8"),
  ]);
  for (const entrypoint of [agents, claude]) {
    assert.match(entrypoint, /integrations\/agent-router\/SKILL\.md/);
    assert.match(entrypoint, /build X/);
    assert.match(entrypoint, /exactly once|invoke .* once/i);
    assert.match(entrypoint, /Never ask|Do not ask/i);
  }
});
