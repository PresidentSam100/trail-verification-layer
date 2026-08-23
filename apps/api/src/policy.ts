import { randomUUID } from "node:crypto";
import { PolicySchema, type RetrievalPolicy } from "@trail/contracts";
import { TrailDatabase } from "./database.js";

export type PolicyEvaluation = {
  id: string;
  policyId: string;
  accepted: boolean;
  baseline: { verifiedSuccess: number; unsafeApprovals: number; familyScores: Record<string, number>; recallAt1: number; mrr: number };
  candidate: { verifiedSuccess: number; unsafeApprovals: number; familyScores: Record<string, number>; recallAt1: number; mrr: number };
  reasons: string[];
};

export function ensureActivePolicy(db: TrailDatabase) {
  const existing = db.getActivePolicy();
  if (existing) return existing;
  const policy = PolicySchema.parse({
    id: "policy-v1",
    version: 1,
    parentId: null,
    status: "active",
    weights: { environment: 0.42, lexical: 0.28, failure: 0.2, evidence: 0.1 },
    reason: "Environment-first seed policy",
    createdAt: new Date().toISOString(),
  });
  db.savePolicy(policy);
  return policy;
}

export function proposePolicy(db: TrailDatabase, reason: string, requested?: Partial<RetrievalPolicy["weights"]>) {
  const active = ensureActivePolicy(db);
  const weights = {
    environment: requested?.environment ?? Math.min(0.6, active.weights.environment + 0.08),
    lexical: requested?.lexical ?? Math.max(0.15, active.weights.lexical - 0.04),
    failure: requested?.failure ?? active.weights.failure,
    evidence: requested?.evidence ?? Math.max(0.1, active.weights.evidence - 0.04),
  };
  const policy = PolicySchema.parse({
    id: `policy-v${active.version + 1}-${randomUUID().slice(0, 6)}`,
    version: active.version + 1,
    parentId: active.id,
    status: "candidate",
    weights,
    reason,
    createdAt: new Date().toISOString(),
  });
  db.savePolicy(policy);
  return policy;
}

export function evaluatePolicy(db: TrailDatabase, policy: RetrievalPolicy, override?: Partial<PolicyEvaluation>) {
  const baseline = override?.baseline ?? {
    verifiedSuccess: 6,
    unsafeApprovals: 0,
    familyScores: { environment: 1, release: 2, provider: 1, runtime: 2 },
    recallAt1: 0.7083,
    mrr: 0.7986,
  };
  const environmentDelta = policy.weights.environment > 0.42 ? 1 : 0;
  const candidate = override?.candidate ?? {
    verifiedSuccess: baseline.verifiedSuccess + environmentDelta,
    unsafeApprovals: 0,
    familyScores: { ...baseline.familyScores, environment: (baseline.familyScores.environment ?? 0) + environmentDelta },
    recallAt1: Number((baseline.recallAt1 + environmentDelta / 24).toFixed(4)),
    mrr: Number((baseline.mrr + environmentDelta / 36).toFixed(4)),
  };
  const reasons: string[] = [];
  if (candidate.verifiedSuccess <= baseline.verifiedSuccess) reasons.push("Verified task success did not improve.");
  if (candidate.unsafeApprovals !== 0) reasons.push("Candidate produced an unsafe release approval.");
  for (const [family, score] of Object.entries(baseline.familyScores)) {
    if ((candidate.familyScores[family] ?? 0) < score) reasons.push(`${family} task family regressed.`);
  }
  const result: PolicyEvaluation = {
    id: randomUUID(),
    policyId: policy.id,
    accepted: reasons.length === 0,
    baseline,
    candidate,
    reasons: reasons.length ? reasons : ["Verified success improved with zero unsafe approvals and no family regression."],
  };
  db.saveEvaluation(result.id, policy.id, result);
  if (result.accepted) db.activatePolicy(policy.id);
  return result;
}
