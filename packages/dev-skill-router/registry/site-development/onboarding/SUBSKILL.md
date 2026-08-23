# Onboarding

Guides a newly authenticated customer to a useful first product outcome.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "onboarding",
  "parentId": "site-development",
  "version": 1,
  "title": "Onboarding",
  "summary": "Create a resumable first-run journey that gathers only necessary setup information and leads a new customer to an observable first success.",
  "match": {
    "specific": ["onboarding flow", "first-run experience", "welcome flow", "setup wizard", "new user setup"],
    "shared": ["getting started", "first success", "activation", "initial setup"],
    "negative": ["returning users only", "marketing tour only"]
  },
  "afterSkills": ["auth"],
  "tasks": [
    {
      "id": "design-first-run-journey",
      "title": "Design the first-run journey",
      "kind": "design",
      "description": "Define the minimum setup steps, branching conditions, saved progress, skip behavior, and measurable first-success destination.",
      "dependsOn": [],
      "outputs": ["First-run journey map", "Onboarding state model", "Activation outcome"],
      "acceptance": ["Every required step has a product reason", "Interrupted progress has defined behavior", "Completion reaches a useful real product state"]
    },
    {
      "id": "implement-onboarding",
      "title": "Implement onboarding",
      "kind": "implement",
      "description": "Build the selected setup steps, persistence, validation, progress cues, and transition into the signed-in product.",
      "dependsOn": ["design-first-run-journey"],
      "outputs": ["Resumable onboarding flow", "Setup validation states", "First-success transition"],
      "acceptance": ["A new customer can complete the journey", "Returning to an interrupted journey preserves valid progress", "Completion does not loop back into setup"]
    },
    {
      "id": "verify-onboarding",
      "title": "Verify onboarding",
      "kind": "verify",
      "description": "Verify fresh, interrupted, invalid, skipped, and completed onboarding journeys against the agreed state model.",
      "dependsOn": ["implement-onboarding"],
      "outputs": ["Onboarding verification evidence", "Resolved first-run defects"],
      "acceptance": ["Fresh and resumed journeys behave consistently", "Validation preserves entered data appropriately", "Completion reaches the intended first success"]
    }
  ],
  "dispatch": {
    "role": "Customer onboarding engineer",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Request only setup data needed by real product behavior", "Make progress resumable where the service permits", "Do not duplicate authentication behavior"],
    "deliverables": ["Resumable onboarding journey", "First-success transition", "Onboarding verification evidence"],
    "verification": ["Fresh, resumed, and completed states are covered", "Onboarding state agrees across service and interface", "Completion reaches a usable product surface"],
    "maxFiles": 16,
    "maxTurns": 10
  }
}
```
