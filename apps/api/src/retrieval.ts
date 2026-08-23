import type { RetrievalMatch, RetrievalPolicy, RetrievalRequest, Trail, TrailEnvironment } from "@trail/contracts";
import { TrailDatabase } from "./database.js";

const defaultWeights = { environment: 0.42, lexical: 0.28, failure: 0.2, evidence: 0.1 };

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\$user/g, "user") ?? "";
}

function environmentResult(required: TrailEnvironment, actual: TrailEnvironment) {
  const fields = Object.keys(required) as Array<keyof TrailEnvironment>;
  const specified = fields.filter((field) => required[field]);
  const rejectedReasons: string[] = [];
  const matchReasons: string[] = [];
  for (const field of specified) {
    const expected = normalize(required[field]);
    const observed = normalize(actual[field]);
    if (!observed) {
      rejectedReasons.push(`missing required environment field: ${field}`);
    } else if (observed !== expected && !observed.includes(expected) && !expected.includes(observed)) {
      rejectedReasons.push(`${field} mismatch: requires ${required[field]}`);
    } else {
      matchReasons.push(`${field} matches ${actual[field]}`);
    }
  }
  return { specified: specified.length, matchReasons, rejectedReasons };
}

function lexicalOverlap(query: string, trail: Trail) {
  const words = new Set(query.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []);
  const target = [trail.title, trail.summary, trail.intent, trail.taskFamily, ...trail.failureSignatures, ...trail.tags]
    .join(" ")
    .toLowerCase()
    .match(/[a-z0-9_-]{3,}/g) ?? [];
  if (words.size === 0) return 0;
  return target.filter((word) => words.has(word)).length / Math.max(words.size, 1);
}

export function retrieveTrails(db: TrailDatabase, request: RetrievalRequest, policy?: RetrievalPolicy | null): { matches: RetrievalMatch[]; rejected: RetrievalMatch[] } {
  const weights = policy?.weights ?? defaultWeights;
  const lexicalIds = new Map(db.searchTrailIds(request.intent, 50).map((entry, index) => [entry.id, 1 - index / 50]));
  const candidates = db.getTrails("approved");
  const scored = candidates.map((trail): RetrievalMatch => {
    const environment = environmentResult(trail.environment, request.environment);
    const triggerMatch = trail.triggers.includes(request.trigger);
    const overlap = Math.min(1, lexicalOverlap(request.intent, trail) + (lexicalIds.get(trail.id) ?? 0) * 0.35);
    const failureMatch = request.trigger === "failure" && trail.failureSignatures.some((signature) => request.intent.toLowerCase().includes(signature.toLowerCase())) ? 1 : triggerMatch ? 0.55 : 0;
    const evidenceCoverage = trail.steps.flatMap((step) => step.evidence).filter((evidence) => request.evidenceState[evidence.id]).length;
    const totalEvidence = trail.steps.flatMap((step) => step.evidence).length;
    const evidenceScore = totalEvidence ? evidenceCoverage / totalEvidence : 0;
    // A trail with no mandatory environment fields is broadly compatible, but
    // compatibility alone must never outweigh absent intent/failure evidence.
    const environmentScore = environment.specified ? environment.matchReasons.length / environment.specified : 0.2;
    const score = environmentScore * weights.environment + overlap * weights.lexical + failureMatch * weights.failure + evidenceScore * weights.evidence;
    const rejectedReasons = [...environment.rejectedReasons];
    if (!triggerMatch) rejectedReasons.push(`not registered for ${request.trigger} trigger`);
    if (overlap <= 0.12 && environment.matchReasons.length === 0 && evidenceCoverage === 0) {
      rejectedReasons.push("no meaningful intent, environment, or evidence overlap");
    }
    const matchReasons = [...environment.matchReasons];
    if (overlap > 0.2) matchReasons.push("intent and failure language overlap");
    if (triggerMatch) matchReasons.push(`${request.trigger} trigger supported`);
    return { trail, score: Number(score.toFixed(4)), matchReasons, rejectedReasons };
  });
  const eligible = scored.filter((match) => match.rejectedReasons.length === 0 && match.score >= 0.34).sort((a, b) => b.score - a.score);
  const rejected = scored
    .filter((match) => !eligible.includes(match))
    .map((match) => match.score < 0.34 && match.rejectedReasons.length === 0
      ? { ...match, rejectedReasons: ["below applicability threshold"] }
      : match)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { matches: eligible.slice(0, request.limit), rejected };
}
