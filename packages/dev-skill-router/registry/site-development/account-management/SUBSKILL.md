# Account management

Builds signed-in settings and account lifecycle surfaces when explicitly requested.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "account",
  "parentId": "site-development",
  "version": 1,
  "title": "Account management",
  "summary": "Implement clear signed-in profile, organization, preference, and account lifecycle surfaces backed by existing service capabilities.",
  "match": {
    "specific": ["account settings", "profile settings", "team management", "organization settings", "account management"],
    "shared": ["preferences", "profile", "members", "account lifecycle"],
    "negative": ["authentication only", "sign in only"]
  },
  "afterSkills": ["auth"],
  "tasks": [
    {
      "id": "map-account-capabilities",
      "title": "Map account capabilities",
      "kind": "inspect",
      "description": "Identify supported profile, organization, preference, membership, and lifecycle actions plus their authorization and failure states.",
      "dependsOn": [],
      "outputs": ["Account capability map", "Authorization matrix", "Account state inventory"],
      "acceptance": ["Every exposed action is supported by a real contract", "Authorization boundaries are explicit", "Irreversible and unavailable actions are identified"]
    },
    {
      "id": "implement-account-surfaces",
      "title": "Implement account surfaces",
      "kind": "implement",
      "description": "Build the selected account settings and lifecycle surfaces with clear validation, confirmation, authorization, and recovery behavior.",
      "dependsOn": ["map-account-capabilities"],
      "outputs": ["Account settings surfaces", "Authorized account actions", "Confirmation and recovery states"],
      "acceptance": ["Settings reflect persisted values", "Unauthorized actions remain unavailable", "Consequential actions require an explicit confirmation state"]
    },
    {
      "id": "verify-account-management",
      "title": "Verify account management",
      "kind": "verify",
      "description": "Verify readable, editable, unauthorized, invalid, and consequential account states across the interface and service boundary.",
      "dependsOn": ["implement-account-surfaces"],
      "outputs": ["Account management verification evidence", "Resolved settings defects"],
      "acceptance": ["Saved changes remain visible after refresh", "Authorization failures do not mutate account state", "Confirmation paths match the requested action"]
    }
  ],
  "dispatch": {
    "role": "Account experience engineer",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Expose only supported account capabilities", "Respect existing authorization boundaries", "Do not duplicate billing or authentication surfaces"],
    "deliverables": ["Account management surfaces", "Authorized lifecycle behavior", "Account verification evidence"],
    "verification": ["Persisted settings round-trip correctly", "Unauthorized paths remain non-mutating", "Consequential actions have clear confirmation states"],
    "maxFiles": 18,
    "maxTurns": 10
  }
}
```
