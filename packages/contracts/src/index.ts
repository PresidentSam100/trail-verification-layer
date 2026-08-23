import { z } from "zod";

export const TriggerSchema = z.enum(["start", "failure", "release"]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const EnvironmentSchema = z.object({
  os: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  client: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  runtime: z.string().min(1).optional(),
  authSurface: z.string().min(1).optional(),
});
export type TrailEnvironment = z.infer<typeof EnvironmentSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "environment",
    "changed_scope",
    "test",
    "remote_ancestry",
    "http",
    "browser",
    "provider",
    "runtime",
  ]),
  description: z.string().min(1),
  required: z.boolean().default(true),
  expected: z.string().min(1),
});
export type EvidenceContract = z.infer<typeof EvidenceSchema>;

export const TrailStepSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  tool: z.enum(["inspect", "read", "write", "check", "verify", "escalate"]),
  evidence: z.array(EvidenceSchema).min(1),
  onFailure: z.enum(["reroute", "stop", "escalate"]),
});
export type TrailStep = z.infer<typeof TrailStepSchema>;

export const TrailSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  taskFamily: z.string().min(1),
  intent: z.string().min(1),
  provenance: z.object({
    provider: z.enum(["codex", "claude", "community", "benchmark"]),
    sourceHash: z.string().min(8),
    sourceRange: z.string().min(1),
    redacted: z.literal(true),
  }),
  environment: EnvironmentSchema,
  preconditions: z.array(z.string()),
  negativeConstraints: z.array(z.string()),
  triggers: z.array(TriggerSchema).min(1),
  failureSignatures: z.array(z.string()),
  steps: z.array(TrailStepSchema).min(1),
  applicability: z.array(z.string()),
  invalidators: z.array(z.string()),
  outcome: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reviewStatus: z.enum(["draft", "approved", "rejected"]),
  reviewedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
});
export type Trail = z.infer<typeof TrailSchema>;

export const RetrievalRequestSchema = z.object({
  intent: z.string().min(3),
  environment: EnvironmentSchema.default({}),
  trigger: TriggerSchema,
  evidenceState: z.record(z.string(), z.boolean()).default({}),
  limit: z.number().int().min(1).max(10).default(3),
});
export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export const RetrievalMatchSchema = z.object({
  trail: TrailSchema,
  score: z.number(),
  matchReasons: z.array(z.string()),
  rejectedReasons: z.array(z.string()),
});
export type RetrievalMatch = z.infer<typeof RetrievalMatchSchema>;

export const RunEventSchema = z.object({
  runId: z.string(),
  sequence: z.number().int().nonnegative(),
  side: z.enum(["baseline", "guided", "system"]),
  type: z.enum([
    "run_started",
    "observation",
    "retrieval",
    "action",
    "gate_blocked",
    "gate_passed",
    "reroute",
    "run_finished",
    "error",
  ]),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string().datetime(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunMetricsSchema = z.object({
  verified: z.boolean(),
  unsafeReleaseApproved: z.boolean(),
  toolCalls: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const PolicyWeightsSchema = z.object({
  environment: z.number().min(0).max(1),
  lexical: z.number().min(0).max(1),
  failure: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
});

export const PolicySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  parentId: z.string().nullable(),
  status: z.enum(["candidate", "active", "rejected"]),
  weights: PolicyWeightsSchema,
  reason: z.string(),
  createdAt: z.string().datetime(),
});
export type RetrievalPolicy = z.infer<typeof PolicySchema>;

export const IngestionPreviewSchema = z.object({
  id: z.string(),
  format: z.enum(["codex", "claude", "unknown"]),
  sourceName: z.string(),
  redactedText: z.string(),
  redactionCount: z.number().int().nonnegative(),
  candidateSignals: z.array(z.string()),
  requiresReview: z.boolean(),
});
export type IngestionPreview = z.infer<typeof IngestionPreviewSchema>;
