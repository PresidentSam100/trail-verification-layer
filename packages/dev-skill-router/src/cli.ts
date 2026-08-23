#!/usr/bin/env node
import { resolve } from "node:path";
import { appendProgressEvent, getBundleStatus } from "./store.ts";
import { defaultRegistryRoot, resumeClarification, routeDevelopmentRequest } from "./runtime.ts";
import { validateProgressStatus } from "./contracts.ts";

const raw = process.argv.slice(2);

function flag(name: string): string | undefined {
  const index = raw.indexOf(name);
  return index >= 0 ? raw[index + 1] : undefined;
}

function positional(): string[] {
  const values: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (!value) continue;
    if (["--project-root", "--repo", "--registry", "--reason"].includes(value)) {
      index += 1;
      continue;
    }
    if (value === "--json") continue;
    values.push(value);
  }
  return values;
}

function output(value: unknown, human: () => void): void {
  if (raw.includes("--json") || !process.stdout.isTTY) process.stdout.write(`${JSON.stringify(value, null, raw.includes("--json") ? 2 : 0)}\n`);
  else human();
}

function usage(): never {
  throw new Error(usageText());
}

function usageText(): string {
  return "Usage: pnpm dev-route \"request\" [--project-root PATH] [--json] | status [bundle-id] | progress <bundle-id> <todo-id> <status> [--reason TEXT] | clarify <id> <option-id>";
}

const args = positional();
const command = args[0];
const projectRoot = resolve(flag("--project-root") ?? flag("--repo") ?? process.env.TRAIL_TARGET_ROOT ?? process.cwd());
const registryRoot = resolve(flag("--registry") ?? defaultRegistryRoot());

try {
  if (command === "help" || raw.includes("--help") || raw.includes("-h")) {
    console.log(usageText());
  } else if (command === "status") {
    const result = getBundleStatus(projectRoot, args[1]);
    output(result, () => {
      console.log(`PlanBundle ${result.bundleId}`);
      for (const child of result.selectedSubskills) console.log(`  ${child.status.padEnd(9)} ${child.id}`);
      if (result.state.blocked.length > 0) console.log(`Blocked: ${result.state.blocked.map((item) => `${item.todoId} <- ${item.blockedBy.join("+") || item.reason}`).join(", ")}`);
    });
  } else if (command === "progress") {
    const [, bundleId, todoId, rawStatus] = args;
    if (!bundleId || !todoId || !rawStatus) usage();
    const status = validateProgressStatus(rawStatus);
    const result = appendProgressEvent(projectRoot, bundleId, todoId, status, flag("--reason"));
    output(result, () => console.log(`${todoId} -> ${status}; available next: ${result.state.availableNext.join(", ") || "none"}`));
  } else if (command === "clarify") {
    const [, clarificationId, optionId] = args;
    if (!clarificationId || !optionId) usage();
    const result = resumeClarification({ clarificationId, optionId, projectRoot, registryRoot });
    output(result, () => renderDecision(result));
  } else {
    const requestParts = command === "route" ? args.slice(1) : args;
    const request = requestParts.join(" ").trim();
    if (!request) usage();
    const result = routeDevelopmentRequest({ request, projectRoot, registryRoot });
    output(result, () => renderDecision(result));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: "DEV_ROUTE_ERROR", message } })}\n`);
  process.exitCode = 1;
}

function renderDecision(result: ReturnType<typeof routeDevelopmentRequest>): void {
  if (result.status === "matched") {
    console.log(`PlanBundle ${result.bundle.bundleId}`);
    for (const child of result.bundle.selectedSubskills) console.log(`  ${child.id}: ${child.reasons.join(", ")}`);
    console.log(`Written: ${result.bundlePath}`);
    console.log(`Available now: ${result.bundle.state.availableNext.join(", ")}`);
  } else if (result.status === "needs_clarification") {
    console.log(result.question.prompt);
    for (const option of result.question.options) console.log(`  ${option.id}: ${option.label} — ${option.description}`);
    console.log(result.question.rerunHint);
  } else {
    console.log(`Abstained: ${result.reasonCodes.join(", ")}`);
    for (const diagnostic of result.diagnostics) console.log(`  ${diagnostic}`);
  }
}
