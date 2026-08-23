# Authentication

Adds account access only when access flows are requested explicitly.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "auth",
  "parentId": "site-development",
  "version": 1,
  "title": "Authentication",
  "summary": "Implement complete account creation, sign-in, session, recovery, and sign-out experiences using the product's established identity boundary.",
  "match": {
    "specific": ["authentication", "sign in", "sign up", "login flow", "password reset", "account creation"],
    "shared": ["session", "identity", "access flow", "logged out"],
    "negative": ["account settings only", "anonymous only"]
  },
  "afterSkills": ["product-discovery"],
  "tasks": [
    {
      "id": "map-access-states",
      "title": "Map account access states",
      "kind": "design",
      "description": "Define supported identity actions, validation, session transitions, recovery cases, redirects, and failure states from the existing identity boundary.",
      "dependsOn": [],
      "outputs": ["Access-state map", "Identity contract map", "Recovery and failure matrix"],
      "acceptance": ["Supported and unsupported identity actions are distinct", "Session transitions have explicit outcomes", "Recovery and invalid-input states are covered"]
    },
    {
      "id": "implement-access-flows",
      "title": "Implement account access flows",
      "kind": "implement",
      "description": "Build the selected access surfaces and connect them to real identity behavior with clear validation, waiting, error, and completion states.",
      "dependsOn": ["map-access-states"],
      "outputs": ["Account creation and access surfaces", "Session-aware navigation", "Recovery states"],
      "acceptance": ["Successful access reaches the intended product destination", "Invalid or failed access remains actionable", "Session state is reflected consistently"]
    },
    {
      "id": "verify-access-flows",
      "title": "Verify account access flows",
      "kind": "verify",
      "description": "Verify successful, invalid, expired, signed-out, and recovery journeys at the identity and interface boundaries.",
      "dependsOn": ["implement-access-flows"],
      "outputs": ["Authentication verification evidence", "Resolved access defects"],
      "acceptance": ["Core access and sign-out journeys complete", "Failure cases do not expose signed-in surfaces", "Recovery behavior matches the supported identity contract"]
    }
  ],
  "dispatch": {
    "role": "Authentication flow engineer",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Use the established identity provider and session model", "Do not fabricate unsupported recovery behavior", "Keep secrets and credentials out of repository content"],
    "deliverables": ["Complete account access surfaces", "Session-aware behavior", "Authentication verification evidence"],
    "verification": ["Access success and failure states are covered", "Session boundaries remain consistent", "No credential material appears in changed files"],
    "maxFiles": 18,
    "maxTurns": 12
  }
}
```
