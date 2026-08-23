import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

export const projectRoot = resolve(import.meta.dirname, "../../..");

if (process.env.NODE_ENV !== "test") {
  try { loadEnvFile(resolve(projectRoot, ".env")); } catch { /* Local configuration is optional. */ }
}

const openAiKey = process.env.OPENAI_API_KEY ?? "";
const openAiBaseUrl = process.env.OPENAI_BASE_URL ?? "";
const modalProxyCredentialComplete = !openAiBaseUrl.includes("modal.direct") || openAiKey.includes(".ws-");
const providerLabel = process.env.TRAIL_PROVIDER_LABEL ?? (openAiBaseUrl.includes("modal.direct") ? "K3" : "OpenAI");

export const config = {
  port: Number(process.env.TRAIL_API_PORT ?? 4317),
  allowedOrigin: process.env.TRAIL_ALLOWED_ORIGIN ?? "http://127.0.0.1:4173",
  databasePath: process.env.TRAIL_DATABASE_PATH ?? resolve(projectRoot, ".trail/trail.db"),
  corpusPath: resolve(projectRoot, "corpus/public"),
  benchmarkPath: resolve(projectRoot, "benchmarks"),
  openAiKey,
  openAiBaseUrl,
  agentModel: process.env.OPENAI_AGENT_MODEL ?? "gpt-5.6-terra",
  extractorModel: process.env.OPENAI_EXTRACTOR_MODEL ?? "gpt-5.6-luna",
  providerLabel,
  reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? "medium") as "low" | "medium" | "high",
  codexSessionsPath: resolve(homedir(), ".codex/sessions"),
  claudeSessionsPath: resolve(homedir(), ".claude/projects"),
};

export function preflight() {
  const missing = !config.openAiKey
    ? ["OPENAI_API_KEY"]
    : !modalProxyCredentialComplete
      ? ["Modal proxy token secret (.ws-… portion)"]
      : [];
  return {
    ready: missing.length === 0,
    liveAi: missing.length === 0,
    agentModel: config.agentModel,
    extractorModel: config.extractorModel,
    providerLabel: config.providerLabel,
    missing,
    deterministicHarness: true,
    sourceRoots: {
      codex: existsSync(config.codexSessionsPath),
      claude: existsSync(config.claudeSessionsPath),
    },
  };
}
