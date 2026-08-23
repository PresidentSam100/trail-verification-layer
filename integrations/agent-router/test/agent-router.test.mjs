import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  buildRouterInvocation,
  findRouterRoot,
  parseInvocation,
  parseRouterStdout,
  validateRouterResponse,
} from "../scripts/agent-router.mjs";
import { createSkillLink, installationTargets, parseInstallArgs } from "../scripts/install.mjs";

test("route maps one complete request to the machine CLI", () => {
  const parsed = parseInvocation(
    ["route", "--request", "build the whole site, ingest data, then test", "--project-root", "."],
    process.cwd(),
  );
  assert.equal(parsed.action, "route");
  assert.deepEqual(parsed.routerArgs, [
    "build the whole site, ingest data, then test",
    "--project-root",
    resolve("."),
    "--json",
  ]);
});

test("clarification resumes the pinned decision rather than routing again", () => {
  const parsed = parseInvocation(["clarify", "clarify-1", "api-and-ui"]);
  assert.deepEqual(parsed.routerArgs.slice(0, 3), ["clarify", "clarify-1", "api-and-ui"]);
  assert.equal(parsed.routerArgs.includes("route"), false);
});

test("progress accepts only append-only lifecycle states", () => {
  const parsed = parseInvocation(["progress", "bundle-1", "todo-2", "blocked", "--reason", "provider unavailable"]);
  assert.deepEqual(parsed.routerArgs.slice(0, 6), [
    "progress",
    "bundle-1",
    "todo-2",
    "blocked",
    "--reason",
    "provider unavailable",
  ]);
  assert.throws(() => parseInvocation(["progress", "bundle-1", "todo-2", "deleted"]), /Usage/);
});

test("the wrapper uses the compiled router through Node without a shell", () => {
  const compiledSuffix = join("packages", "dev-skill-router", "dist", "cli.js");
  assert.deepEqual(buildRouterInvocation("/router", ["status", "--json"], "/node", (path) => path.endsWith(compiledSuffix)), {
    command: "/node",
    args: [join("/router", "packages", "dev-skill-router", "dist", "cli.js"), "status", "--json"],
  });
});

test("a clean checkout runs the tracked TypeScript source when dist is absent", () => {
  const sourceSuffix = join("packages", "dev-skill-router", "src", "cli.ts");
  const invocation = buildRouterInvocation("/router", ["request", "--json"], "/node", (path) => path.endsWith(sourceSuffix));
  assert.equal(invocation.command, "/node");
  assert.deepEqual(invocation.args, [
    "--no-warnings",
    "--experimental-strip-types",
    join("/router", "packages", "dev-skill-router", "src", "cli.ts"),
    "request",
    "--json",
  ]);
});

test("route envelopes require all three explicit outcomes", () => {
  const matched = {
    status: "matched",
    bundlePath: ".trail/dev-routes/bundle.json",
    bundle: { schemaVersion: "1.0", bundleId: "bundle-1" },
  };
  assert.equal(validateRouterResponse("route", matched), matched);
  assert.equal(validateRouterResponse("route", {
    status: "needs_clarification",
    question: {
      clarificationId: "clarify-1",
      prompt: "Which surface?",
      options: [],
    },
  }).status, "needs_clarification");
  assert.equal(validateRouterResponse("route", { status: "abstain", reasonCodes: ["NO_PARENT"] }).status, "abstain");
  assert.throws(() => validateRouterResponse("route", { status: "guess" }), /unknown status/);
});

test("stdout parsing rejects log noise around JSON", () => {
  assert.deepEqual(parseRouterStdout('{"status":"abstain","reasonCodes":[]}\n'), {
    status: "abstain",
    reasonCodes: [],
  });
  assert.throws(() => parseRouterStdout('searching...\n{"status":"abstain"}'), SyntaxError);
});

test("router root discovery works through an installed skill link", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "trail-agent-router-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const routerRoot = join(temporary, "router");
  const source = join(routerRoot, "integrations", "agent-router");
  const script = join(source, "scripts", "agent-router.mjs");
  await mkdir(join(source, "scripts"), { recursive: true });
  await writeFile(join(routerRoot, "package.json"), JSON.stringify({ scripts: { "dev-route": "example" } }));
  await writeFile(script, "// fixture");
  const installed = join(temporary, "home", ".codex", "skills", "trail-development-router");
  await mkdir(join(temporary, "home", ".codex", "skills"), { recursive: true });
  await symlink(source, installed, process.platform === "win32" ? "junction" : "dir");
  assert.equal(await findRouterRoot({ scriptPath: join(installed, "scripts", "agent-router.mjs") }), routerRoot);
});

test("router discovery never executes an unrelated target-repository script", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "trail-agent-isolation-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const routerRoot = join(temporary, "router");
  const targetRoot = join(temporary, "target");
  const script = join(routerRoot, "integrations", "agent-router", "scripts", "agent-router.mjs");
  await mkdir(join(routerRoot, "integrations", "agent-router", "scripts"), { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  await writeFile(join(routerRoot, "package.json"), JSON.stringify({ scripts: { "dev-route": "trusted" } }));
  await writeFile(join(targetRoot, "package.json"), JSON.stringify({ scripts: { "dev-route": "unrelated" } }));
  await writeFile(script, "// fixture");
  assert.equal(await findRouterRoot({ cwd: targetRoot, scriptPath: script }), routerRoot);
});

test("installer defaults to both agents and never replaces an existing path", async (context) => {
  assert.deepEqual(parseInstallArgs([]).requested.sort(), ["claude", "codex"]);
  const temporary = await mkdtemp(join(tmpdir(), "trail-agent-install-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const source = join(temporary, "source");
  const destination = join(temporary, "skills", "trail-development-router");
  await mkdir(source, { recursive: true });
  assert.equal((await createSkillLink(source, destination)).status, "linked");
  assert.equal((await createSkillLink(source, destination)).status, "already-linked");
  const targets = installationTargets({
    env: { CODEX_HOME: join(temporary, "codex"), CLAUDE_CONFIG_DIR: join(temporary, "claude") },
    userHome: temporary,
  });
  assert.equal(targets.codex, join(temporary, "codex", "skills", "trail-development-router"));
  assert.equal(targets.claude, join(temporary, "claude", "skills", "trail-development-router"));
});
