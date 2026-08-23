import OpenAI from "openai";
import { TrailSchema, type IngestionPreview, type RetrievalMatch, type RetrievalRequest, type Trail } from "@trail/contracts";
import { config } from "./config.js";
import { redactText, sourceHash } from "./redaction.js";

const trailJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "taskFamily", "intent", "environment", "preconditions", "negativeConstraints", "triggers", "failureSignatures", "steps", "applicability", "invalidators", "outcome", "confidence", "tags"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    taskFamily: { type: "string" },
    intent: { type: "string" },
    environment: {
      type: "object",
      additionalProperties: false,
      properties: {
        os: { type: "string" }, host: { type: "string" }, client: { type: "string" }, workspace: { type: "string" },
        repository: { type: "string" }, branch: { type: "string" }, runtime: { type: "string" }, authSurface: { type: "string" },
      },
    },
    preconditions: { type: "array", items: { type: "string" } },
    negativeConstraints: { type: "array", items: { type: "string" } },
    triggers: { type: "array", items: { type: "string", enum: ["start", "failure", "release"] } },
    failureSignatures: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "action", "tool", "evidence", "onFailure"],
        properties: {
          id: { type: "string" }, action: { type: "string" }, tool: { type: "string", enum: ["inspect", "read", "write", "check", "verify", "escalate"] },
          evidence: {
            type: "array", minItems: 1, items: {
              type: "object", additionalProperties: false, required: ["id", "kind", "description", "required", "expected"],
              properties: {
                id: { type: "string" }, kind: { type: "string", enum: ["environment", "changed_scope", "test", "remote_ancestry", "http", "browser", "provider", "runtime"] },
                description: { type: "string" }, required: { type: "boolean" }, expected: { type: "string" },
              },
            },
          },
          onFailure: { type: "string", enum: ["reroute", "stop", "escalate"] },
        },
      },
    },
    applicability: { type: "array", items: { type: "string" } },
    invalidators: { type: "array", items: { type: "string" } },
    outcome: { type: "string" }, confidence: { type: "number" }, tags: { type: "array", items: { type: "string" } },
  },
} as const;

export class OpenAiUnavailableError extends Error {
  constructor() {
    super("Live AI is unavailable: OPENAI_API_KEY is not configured.");
    this.name = "OpenAiUnavailableError";
  }
}

export async function extractTrail(preview: IngestionPreview): Promise<Trail> {
  if (!config.openAiKey) throw new OpenAiUnavailableError();
  const client = new OpenAI({ apiKey: config.openAiKey, baseURL: config.openAiBaseUrl || undefined });
  const response = await client.responses.create({
    model: config.extractorModel,
    store: false,
    reasoning: { effort: config.reasoningEffort },
    instructions: "Extract one reusable coding-agent route from this already-redacted transcript. Do not recreate private details. Require observable evidence after every action. Return only the requested structured object.",
    input: preview.redactedText.slice(0, 36_000),
    text: { format: { type: "json_schema", name: "trail_contract", strict: true, schema: trailJsonSchema } },
  });
  const parsed = JSON.parse(response.output_text) as Record<string, unknown>;
  const id = `trail-${sourceHash(`${preview.id}:${String(parsed.title ?? "draft")}`).slice(0, 12)}`;
  return TrailSchema.parse({
    ...parsed,
    schemaVersion: "1.0",
    id,
    provenance: { provider: preview.format === "unknown" ? "community" : preview.format, sourceHash: sourceHash(preview.redactedText), sourceRange: "redacted episode", redacted: true },
    reviewStatus: "draft",
  });
}

const rerankJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["orderedIds", "rationales"],
  properties: {
    orderedIds: { type: "array", items: { type: "string" } },
    rationales: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "reason"],
        properties: { id: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
} as const;

export async function rerankTrails(request: RetrievalRequest, matches: RetrievalMatch[]) {
  if (!config.openAiKey) throw new OpenAiUnavailableError();
  if (matches.length < 2) return matches;
  const client = new OpenAI({ apiKey: config.openAiKey, baseURL: config.openAiBaseUrl || undefined });
  const payload = redactText(JSON.stringify({
    query: request,
    candidates: matches.map((match) => ({
      id: match.trail.id,
      title: match.trail.title,
      taskFamily: match.trail.taskFamily,
      intent: match.trail.intent,
      applicability: match.trail.applicability,
      invalidators: match.trail.invalidators,
      failureSignatures: match.trail.failureSignatures,
      deterministicScore: match.score,
      deterministicReasons: match.matchReasons,
    })),
  })).redacted;
  const response = await client.responses.create({
    model: config.extractorModel,
    store: false,
    reasoning: { effort: config.reasoningEffort },
    instructions: "Rerank only the supplied, environment-compatible trail candidates. Prefer exact task intent and failure shape. Never add a candidate. Return every supplied id exactly once and one concise reason per id.",
    input: payload,
    text: { format: { type: "json_schema", name: "trail_rerank", strict: true, schema: rerankJsonSchema } },
  });
  const parsed = JSON.parse(response.output_text) as { orderedIds?: string[]; rationales?: Array<{ id: string; reason: string }> };
  const byId = new Map(matches.map((match) => [match.trail.id, match]));
  const orderedIds = (parsed.orderedIds ?? []).filter((id, index, ids) => byId.has(id) && ids.indexOf(id) === index);
  if (orderedIds.length !== matches.length) throw new Error("OpenAI reranker returned an incomplete or invalid candidate set.");
  const reasons = new Map((parsed.rationales ?? []).map((item) => [item.id, item.reason]));
  return orderedIds.map((id, rank) => {
    const match = byId.get(id)!;
    const reason = reasons.get(id);
    return {
      ...match,
      score: Number((match.score + (matches.length - rank) / 10_000).toFixed(4)),
      matchReasons: reason ? [...match.matchReasons, `OpenAI reranker: ${reason}`] : match.matchReasons,
    };
  });
}
