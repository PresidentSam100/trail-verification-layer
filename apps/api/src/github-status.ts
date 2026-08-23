import { execFileSync } from "node:child_process";
import type { ContextBundle, EvidenceObservation } from "@trail/contracts";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const shaPattern = /^[a-f0-9]{7,40}$/i;

export function assertSuccessEligible(bundle: ContextBundle | null, observations: EvidenceObservation[]) {
  if (!bundle) throw new Error("A verified immutable bundle is required to publish success.");
  if (bundle.status !== "ready") throw new Error(`Bundle ${bundle.id} is ${bundle.status}, not ready for release.`);

  const required = bundle.evidence.filter((gate) => gate.required);
  if (required.length === 0) throw new Error(`Bundle ${bundle.id} has no required evidence gates.`);

  const missing: string[] = [];
  for (const gate of required) {
    const byVerifier = new Map<string, EvidenceObservation>();
    for (const item of observations
      .filter((entry) => entry.bundleId === bundle.id && entry.evidenceId === gate.id)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))) {
      byVerifier.set(item.verifier, item);
    }
    if (byVerifier.size === 0 || [...byVerifier.values()].some((item) => !item.passed)) missing.push(gate.id);
  }
  if (missing.length) throw new Error(`Bundle ${bundle.id} is not fully verified; missing or failed evidence: ${missing.join(", ")}.`);
}

export function publishVerificationStatus(input: { repo: string; sha: string; state: "pending" | "success" | "failure"; description: string; targetUrl?: string }) {
  if (!repoPattern.test(input.repo)) throw new Error("Repository must be owner/name.");
  if (!shaPattern.test(input.sha)) throw new Error("Commit SHA must be 7-40 hexadecimal characters.");
  const args = ["api", `repos/${input.repo}/statuses/${input.sha}`, "--method", "POST", "-f", `state=${input.state}`, "-f", "context=trail/verification", "-f", `description=${input.description.slice(0, 140)}`];
  if (input.targetUrl) args.push("-f", `target_url=${input.targetUrl}`);
  const output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output) as { state: string; context: string; target_url: string | null };
}
