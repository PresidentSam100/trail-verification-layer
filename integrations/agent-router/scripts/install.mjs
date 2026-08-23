#!/usr/bin/env node

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "trail-development-router";

export function parseInstallArgs(argv) {
  const requested = new Set();
  let dryRun = false;
  for (const value of argv) {
    if (value === "--codex") requested.add("codex");
    else if (value === "--claude") requested.add("claude");
    else if (value === "--all") {
      requested.add("codex");
      requested.add("claude");
    } else if (value === "--dry-run") dryRun = true;
    else if (value === "--help" || value === "-h") return { help: true };
    else throw new Error(`Unknown option: ${value}`);
  }
  if (requested.size === 0) {
    requested.add("codex");
    requested.add("claude");
  }
  return { help: false, requested: [...requested], dryRun };
}

export function installationTargets({ env = process.env, userHome = homedir() } = {}) {
  const codexRoot = resolve(env.CODEX_HOME || join(userHome, ".codex"));
  const claudeRoot = resolve(env.CLAUDE_CONFIG_DIR || join(userHome, ".claude"));
  return {
    codex: join(codexRoot, "skills", SKILL_NAME),
    claude: join(claudeRoot, "skills", SKILL_NAME),
  };
}

export async function createSkillLink(source, destination, { dryRun = false, platform = process.platform } = {}) {
  const canonicalSource = realpathSync(source);
  if (existsSync(destination) || (() => {
    try { lstatSync(destination); return true; } catch { return false; }
  })()) {
    try {
      if (realpathSync(destination) === canonicalSource) {
        return { destination, status: "already-linked" };
      }
    } catch {
      // Broken links are still refused rather than overwritten.
    }
    throw new Error(`Refusing to replace existing skill path: ${destination}`);
  }
  if (dryRun) return { destination, status: "would-link" };
  await mkdir(dirname(destination), { recursive: true });
  await symlink(canonicalSource, destination, platform === "win32" ? "junction" : "dir");
  return { destination, status: "linked" };
}

export function helpText() {
  return `Link the repository-owned TRAIL router skill into agent skill discovery.

  node scripts/install.mjs [--codex] [--claude] [--all] [--dry-run]

The installer never overwrites an existing skill. With no agent flag it links both Codex and Claude.`;
}

async function main() {
  try {
    const parsed = parseInstallArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${helpText()}\n`);
      return;
    }
    const scriptPath = realpathSync(fileURLToPath(import.meta.url));
    const source = resolve(dirname(scriptPath), "..");
    const targets = installationTargets();
    const results = [];
    for (const agent of parsed.requested) {
      results.push({ agent, ...(await createSkillLink(source, targets[agent], { dryRun: parsed.dryRun })) });
    }
    process.stdout.write(`${JSON.stringify({ ok: true, source, results }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}

