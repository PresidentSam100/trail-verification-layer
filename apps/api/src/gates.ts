import type { EvidenceContract } from "@trail/contracts";

export type GateState = {
  environment?: Record<string, string>;
  changedFiles?: string[];
  testPassed?: boolean;
  remoteAncestor?: boolean;
  httpStatus?: number;
  browserVisible?: boolean;
  providerReady?: boolean;
  runtimeObserved?: boolean;
};

export type GateResult = { passed: boolean; evidenceId: string; observed: string; expected: string };

export function evaluateEvidence(evidence: EvidenceContract, state: GateState): GateResult {
  let passed = false;
  let observed = "missing";
  switch (evidence.kind) {
    case "environment": {
      observed = JSON.stringify(state.environment ?? {});
      passed = Object.values(state.environment ?? {}).some((value) => value.toLowerCase().includes(evidence.expected.toLowerCase()));
      break;
    }
    case "changed_scope": {
      observed = (state.changedFiles ?? []).join(", ") || "no changed files";
      const allowed = evidence.expected.split(",").map((value) => value.trim()).filter(Boolean);
      passed = Boolean(state.changedFiles?.length) && (state.changedFiles ?? []).every((file) => allowed.some((prefix) => file.startsWith(prefix)));
      break;
    }
    case "test":
      observed = String(Boolean(state.testPassed));
      passed = state.testPassed === true;
      break;
    case "remote_ancestry":
      observed = String(Boolean(state.remoteAncestor));
      passed = state.remoteAncestor === true;
      break;
    case "http":
      observed = String(state.httpStatus ?? "missing");
      passed = Boolean(state.httpStatus && state.httpStatus >= 200 && state.httpStatus < 300);
      break;
    case "browser":
      observed = String(Boolean(state.browserVisible));
      passed = state.browserVisible === true;
      break;
    case "provider":
      observed = String(Boolean(state.providerReady));
      passed = state.providerReady === true;
      break;
    case "runtime":
      observed = String(Boolean(state.runtimeObserved));
      passed = state.runtimeObserved === true;
      break;
  }
  return { passed, evidenceId: evidence.id, observed, expected: evidence.expected };
}

export function evaluateReleaseGate(evidence: EvidenceContract[], state: GateState) {
  const results = evidence.filter((item) => item.required).map((item) => evaluateEvidence(item, state));
  return { passed: results.every((result) => result.passed), results };
}
