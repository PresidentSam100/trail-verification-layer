# Quality assurance

Verifies the integrated result after ingestion, API, and interface work converge.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "quality-assurance",
  "parentId": "site-development",
  "version": 1,
  "title": "Quality assurance",
  "summary": "Derive evidence-backed acceptance scenarios and verify the completed customer journeys across contracts, services, interfaces, and real browser behavior.",
  "match": {
    "specific": ["test it", "test the site", "quality assurance", "end-to-end testing", "browser verification", "acceptance testing"],
    "shared": ["verify", "testing", "regression", "acceptance"],
    "negative": ["skip tests", "no testing", "do not test the whole product"]
  },
  "afterSkills": ["data-ingestion", "api-integration", "product-interface", "marketing", "auth", "onboarding", "account", "billing"],
  "tasks": [
    {
      "id": "derive-acceptance-scenarios",
      "title": "Derive acceptance scenarios",
      "kind": "design",
      "description": "Convert the product scope, ingestion rules, API contracts, and interface journeys into observable success, failure, and regression scenarios.",
      "dependsOn": [],
      "outputs": ["Acceptance scenario matrix", "Risk-prioritized regression scope", "Expected observable outcomes"],
      "acceptance": ["Every selected user journey has an observable outcome", "Failure and recovery cases are included", "Scenarios trace back to the agreed scope"]
    },
    {
      "id": "verify-integrated-journeys",
      "title": "Verify integrated journeys",
      "kind": "verify",
      "description": "Exercise the selected workflows across service and browser boundaries and record deterministic evidence for each acceptance scenario.",
      "dependsOn": ["derive-acceptance-scenarios"],
      "outputs": ["Integrated journey results", "Browser behavior evidence", "Regression results"],
      "acceptance": ["The primary product journey completes with real service behavior", "Data-ingestion success and rejection paths are covered", "Failures include reproducible evidence"]
    },
    {
      "id": "record-release-evidence",
      "title": "Record release evidence",
      "kind": "verify",
      "description": "Summarize verified behavior, unresolved blockers, known limitations, and the precise evidence supporting readiness claims.",
      "dependsOn": ["verify-integrated-journeys"],
      "outputs": ["Release evidence summary", "Known limitation list", "Blocker disposition"],
      "acceptance": ["No unverified claim is reported as passing", "Blockers are separated from non-blocking limitations", "Evidence is concise and reproducible"]
    }
  ],
  "dispatch": {
    "role": "Integrated product verifier",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/", "tests/"],
    "constraints": ["Verify observable outcomes rather than implementation assumptions", "Do not silently repair failures outside the selected scope", "Preserve evidence for every readiness claim"],
    "deliverables": ["Acceptance scenario matrix", "Integrated verification evidence", "Release readiness summary"],
    "verification": ["Contract and integration checks pass", "Browser journeys cover the requested flow", "Any remaining blocker has reproducible evidence"],
    "maxFiles": 16,
    "maxTurns": 12
  }
}
```
