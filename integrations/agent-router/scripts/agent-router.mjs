#!/usr/bin/env node

import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROUTE_STATUSES = new Set(["matched", "needs_clarification", "abstain"]);
const TODO_STATUSES = new Set(["pending", "running", "blocked", "completed"]);
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

function takeOption(tokens, name) {
  const index = tokens.indexOf(name);
  if (index === -1) return undefined;
  const value = tokens[index + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`${name} requires a value`);
  if (tokens.indexOf(name, index + 1) !== -1) throw new UsageError(`${name} may only be supplied once`);
  tokens.splice(index, 2);
  return value;
}

function rejectUnknownOptions(tokens) {
  const option = tokens.find((token) => token.startsWith("--"));
  if (option) throw new UsageError(`Unknown option: ${option}`);
}

export function parseInvocation(argv, cwd = process.cwd()) {
  const tokens = [...argv];
  const action = tokens.shift();
  if (!action || action === "help" || action === "--help" || action === "-h") {
    return { action: "help" };
  }

  const projectRoot = resolve(takeOption(tokens, "--project-root") ?? cwd);

  if (action === "route") {
    const request = takeOption(tokens, "--request");
    rejectUnknownOptions(tokens);
    if (!request || tokens.length !== 0) {
      throw new UsageError("Usage: agent-router route --request <development request> [--project-root <path>]");
    }
    return { action, projectRoot, routerArgs: [request, "--project-root", projectRoot, "--json"] };
  }

  if (action === "clarify") {
    rejectUnknownOptions(tokens);
    if (tokens.length !== 2) {
      throw new UsageError("Usage: agent-router clarify <clarificationId> <optionId> [--project-root <path>]");
    }
    return {
      action,
      projectRoot,
      routerArgs: ["clarify", tokens[0], tokens[1], "--project-root", projectRoot, "--json"],
    };
  }

  if (action === "progress") {
    const reason = takeOption(tokens, "--reason");
    rejectUnknownOptions(tokens);
    if (tokens.length !== 3 || !TODO_STATUSES.has(tokens[2])) {
      throw new UsageError(
        "Usage: agent-router progress <bundleId> <todoId> <pending|running|blocked|completed> [--reason <text>] [--project-root <path>]",
      );
    }
    const routerArgs = ["progress", ...tokens];
    if (reason) routerArgs.push("--reason", reason);
    routerArgs.push("--project-root", projectRoot, "--json");
    return { action, projectRoot, routerArgs };
  }

  if (action === "status") {
    rejectUnknownOptions(tokens);
    if (tokens.length > 1) {
      throw new UsageError("Usage: agent-router status [bundleId] [--project-root <path>]");
    }
    return {
      action,
      projectRoot,
      routerArgs: ["status", ...tokens, "--project-root", projectRoot, "--json"],
    };
  }

  throw new UsageError(`Unknown action: ${action}`);
}

function parentDirectories(start) {
  const directories = [];
  let current = resolve(start);
  for (;;) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

async function hasDevRouteScript(directory) {
  const packagePath = join(directory, "package.json");
  if (!existsSync(packagePath)) return false;
  try {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    return typeof packageJson?.scripts?.["dev-route"] === "string";
  } catch {
    return false;
  }
}

export async function findRouterRoot({ scriptPath = fileURLToPath(import.meta.url) } = {}) {
  const sourceDirectory = dirname(realpathSync(scriptPath));
  const candidates = parentDirectories(sourceDirectory);
  const seen = new Set();
  for (const candidate of candidates) {
    const canonical = realpathSync(candidate);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    if (await hasDevRouteScript(canonical)) return canonical;
  }
  throw new Error(
    "Could not find the TRAIL repository (expected package.json with a dev-route script). " +
      "Install this skill by linking its source directory, or run it from the TRAIL checkout.",
  );
}

function validateProjectRoot(projectRoot) {
  if (!isAbsolute(projectRoot) || !existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new UsageError(`Project root is not a directory: ${projectRoot}`);
  }
}

export function validateRouterResponse(action, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Router returned a non-object JSON response");
  }

  if (action === "route" || action === "clarify") {
    if (!ROUTE_STATUSES.has(value.status)) throw new Error(`Router returned an unknown status: ${String(value.status)}`);
    if (value.status === "matched") {
      if (typeof value.bundlePath !== "string" || !value.bundle || typeof value.bundle !== "object") {
        throw new Error("Matched response is missing bundlePath or bundle");
      }
      if (value.bundle.schemaVersion !== "1.0" || typeof value.bundle.bundleId !== "string") {
        throw new Error("Matched response has an unsupported PlanBundle");
      }
    } else if (value.status === "needs_clarification") {
      const structured = value.question && typeof value.question === "object" && !Array.isArray(value.question)
        ? value.question
        : null;
      const clarificationId = structured?.clarificationId ?? value.clarificationId;
      const prompt = structured?.prompt ?? value.question;
      if (typeof clarificationId !== "string" || typeof prompt !== "string") {
        throw new Error("Clarification response is missing a clarification id or prompt");
      }
    } else if (!Array.isArray(value.reasonCodes)) {
      throw new Error("Abstain response is missing reasonCodes");
    }
  }
  return value;
}

export function resolveRouterEntrypoint(routerRoot, pathExists = existsSync) {
  const compiled = join(routerRoot, "packages", "dev-skill-router", "dist", "cli.js");
  if (pathExists(compiled)) return { path: compiled, mode: "compiled" };
  const source = join(routerRoot, "packages", "dev-skill-router", "src", "cli.ts");
  if (pathExists(source)) return { path: source, mode: "source" };
  throw new Error(`TRAIL router entrypoint is missing under ${routerRoot}`);
}

export function buildRouterInvocation(routerRoot, routerArgs, nodeExecutable = process.execPath, pathExists = existsSync) {
  const entrypoint = resolveRouterEntrypoint(routerRoot, pathExists);
  return {
    command: nodeExecutable,
    args: entrypoint.mode === "compiled"
      ? [entrypoint.path, ...routerArgs]
      : ["--no-warnings", "--experimental-strip-types", entrypoint.path, ...routerArgs],
  };
}

export function parseRouterStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Router produced no JSON output");
  return JSON.parse(trimmed);
}

export async function run(argv, {
  cwd = process.cwd(),
  scriptPath = fileURLToPath(import.meta.url),
  spawn = spawnSync,
} = {}) {
  const invocation = parseInvocation(argv, cwd);
  if (invocation.action === "help") return { help: true, exitCode: 0 };
  validateProjectRoot(invocation.projectRoot);
  const routerRoot = await findRouterRoot({ scriptPath });
  const command = buildRouterInvocation(routerRoot, invocation.routerArgs);
  const result = spawn(command.command, command.args, {
    cwd: routerRoot,
    encoding: "utf8",
    env: { ...process.env, TRAIL_TARGET_ROOT: invocation.projectRoot },
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    return { exitCode: result.status ?? 1, stdout, stderr };
  }
  const parsed = validateRouterResponse(invocation.action, parseRouterStdout(stdout));
  return { exitCode: 0, stdout: `${JSON.stringify(parsed)}\n`, stderr };
}

export function helpText() {
  return `TRAIL agent router bridge

  agent-router route --request <development request> [--project-root <path>]
  agent-router clarify <clarificationId> <optionId> [--project-root <path>]
  agent-router progress <bundleId> <todoId> <pending|running|blocked|completed> [--reason <text>] [--project-root <path>]
  agent-router status [bundleId] [--project-root <path>]

This bridge is for coding-agent integration. End users state what they want built; they do not run it themselves.`;
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result.help) {
      process.stdout.write(`${helpText()}\n`);
      return;
    }
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
  } catch (error) {
    const usage = error instanceof UsageError;
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: usage ? "AGENT_ROUTER_USAGE" : "AGENT_ROUTER_BRIDGE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    })}\n`);
    process.exitCode = usage ? 2 : 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
