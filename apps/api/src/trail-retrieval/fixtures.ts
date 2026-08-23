import type { Trail } from "@trail/contracts";

const evidence = (id: string, description: string, expected: string) => ({
  id,
  kind: "environment" as const,
  description,
  required: true,
  expected,
});

export const WRONG_CHECKOUT_TRAIL = {
  schemaVersion: "1.0",
  id: "trail-wrong-checkout",
  title: "Verify the intended checkout before editing",
  summary: "Keep route changes and their proof in the checkout the user expects.",
  taskFamily: "checkout route change",
  intent: "Update the production route in the correct checkout, prove it works, and prepare the pull request.",
  provenance: { provider: "benchmark", sourceHash: "wrong-checkout-fixture", sourceRange: "in-memory fixture", redacted: true },
  environment: { client: "codex", workspace: "service-live" },
  preconditions: ["The intended workspace can be identified"],
  negativeConstraints: ["Do not edit a copied or hidden checkout"],
  triggers: ["start", "failure"],
  failureSignatures: ["changes are not visible", "wrong checkout", "hidden worktree"],
  steps: [{
    id: "verify-checkout",
    action: "Confirm the visible checkout and branch before editing.",
    tool: "inspect",
    evidence: [evidence("checkout", "The active checkout is service-live.", "service-live")],
    onFailure: "stop",
  }],
  applicability: ["task:any(route|checkout|worktree|branch|pull request|pr)"],
  invalidators: ["environment.workspace:service-copy"],
  outcome: "The requested change and proof are produced in the intended checkout.",
  confidence: 0.96,
  reviewStatus: "approved",
  tags: ["checkout", "worktree", "production route", "pull request"],
} as const satisfies Trail;

export const BUILD_VERSUS_DEPLOYMENT_TRAIL = {
  schemaVersion: "1.0",
  id: "trail-build-versus-deployment",
  title: "Separate build health from deployment health",
  summary: "A passing build does not prove the production deployment or route.",
  taskFamily: "production route release",
  intent: "Update a production route, distinguish build from deployment proof, and prepare the release or pull request.",
  provenance: { provider: "benchmark", sourceHash: "build-deployment-fixture", sourceRange: "in-memory fixture", redacted: true },
  environment: { runtime: "node" },
  preconditions: ["The production route is known"],
  negativeConstraints: ["Do not report a passing build as deployment proof"],
  triggers: ["failure", "release"],
  failureSignatures: ["build passed but site unchanged", "deployment not visible", "production route failed"],
  steps: [{
    id: "verify-two-surfaces",
    action: "Verify build output and the deployed production route separately.",
    tool: "verify",
    evidence: [evidence("production-route", "The deployed route responds successfully.", "2xx")],
    onFailure: "stop",
  }],
  applicability: ["task:any(production|route|build|deploy|deployment|release)"],
  invalidators: ["task:phrase(deployment already verified)"],
  outcome: "Build and deployment claims each have authoritative proof.",
  confidence: 0.95,
  reviewStatus: "approved",
  tags: ["build", "deployment", "production route", "release", "pull request"],
} as const satisfies Trail;

export const AUTHENTICATION_PROVIDER_STATE_TRAIL = {
  schemaVersion: "1.0",
  id: "trail-authentication-provider-state",
  title: "Verify authentication at the provider surface",
  summary: "Local credentials do not prove that the provider session is usable.",
  taskFamily: "authentication provider state",
  intent: "Diagnose login, token, credential, and provider-session failures truthfully.",
  provenance: { provider: "benchmark", sourceHash: "auth-provider-fixture", sourceRange: "in-memory fixture", redacted: true },
  environment: { authSurface: "github" },
  preconditions: ["The authoritative provider can report session state"],
  negativeConstraints: ["Never infer authentication from the presence of a token"],
  triggers: ["start", "failure"],
  failureSignatures: ["credentials rejected", "session unauthenticated", "provider denied access"],
  steps: [{
    id: "verify-provider-session",
    action: "Ask the provider to perform a bounded authenticated operation.",
    tool: "verify",
    evidence: [evidence("provider-session", "The provider accepted an authenticated operation.", "true")],
    onFailure: "escalate",
  }],
  applicability: ["task:any(authentication|auth|login|provider|credential|token)"],
  invalidators: ["task:phrase(authenticated provider action already succeeds)"],
  outcome: "The reported authentication state matches the provider's observed state.",
  confidence: 0.94,
  reviewStatus: "approved",
  tags: ["authentication", "provider", "github", "credentials"],
} as const satisfies Trail;

export const TRAIL_RETRIEVAL_FIXTURES: readonly Trail[] = Object.freeze([
  WRONG_CHECKOUT_TRAIL,
  BUILD_VERSUS_DEPLOYMENT_TRAIL,
  AUTHENTICATION_PROVIDER_STATE_TRAIL,
]);
