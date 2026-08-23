# Data ingestion

Adds a trustworthy path for bringing more data into the existing product.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "data-ingestion",
  "parentId": "site-development",
  "version": 1,
  "title": "Data ingestion",
  "summary": "Design, implement, and verify an end-to-end flow for previewing, validating, adding, and observing new product data.",
  "match": {
    "specific": ["ingest more data", "data ingestion", "upload data", "import data", "add data", "ingestion flow", "data pipeline"],
    "shared": ["new data", "data source", "preview data", "validate data"],
    "negative": ["read-only analytics", "export data only", "do not touch ingestion"]
  },
  "afterSkills": ["product-discovery"],
  "tasks": [
    {
      "id": "design-ingestion-contract",
      "title": "Design the ingestion contract",
      "kind": "design",
      "description": "Define accepted sources, preview behavior, validation and redaction rules, review states, commit semantics, failure responses, and observable outcomes.",
      "dependsOn": [],
      "outputs": ["Ingestion state model", "Input and response contracts", "Validation and failure matrix"],
      "acceptance": ["Preview and commit are distinct states", "Invalid or sensitive input has explicit handling", "Repeated submissions have defined behavior"]
    },
    {
      "id": "implement-ingestion-service",
      "title": "Implement the ingestion service",
      "kind": "implement",
      "description": "Add the service-side ingestion path while preserving existing data invariants and making every accepted or rejected transition observable.",
      "dependsOn": ["design-ingestion-contract"],
      "outputs": ["Service ingestion flow", "Validation and redaction behavior", "Structured ingestion outcomes"],
      "acceptance": ["Only validated data can be committed", "Failures do not create partial accepted records", "Responses expose enough state for the interface"]
    },
    {
      "id": "implement-ingestion-interface",
      "title": "Implement the ingestion interface",
      "kind": "implement",
      "description": "Create a clear user flow for choosing a source, previewing the result, resolving issues, approving the import, and seeing completion.",
      "dependsOn": ["design-ingestion-contract"],
      "outputs": ["Ingestion user flow", "Preview and review states", "Success and recovery states"],
      "acceptance": ["A user can understand what will be added before approval", "Blocking validation is actionable", "The final state confirms what changed"]
    },
    {
      "id": "verify-ingestion-flow",
      "title": "Verify the ingestion flow",
      "kind": "verify",
      "description": "Exercise successful, invalid, sensitive, repeated, and interrupted ingestion cases across the service and interface boundary.",
      "dependsOn": ["implement-ingestion-service", "implement-ingestion-interface"],
      "outputs": ["Ingestion verification evidence", "Failure-case results", "Known limitations"],
      "acceptance": ["The main ingestion journey completes end to end", "Rejected input leaves no unintended accepted data", "Verification covers both service and visible interface state"]
    }
  ],
  "dispatch": {
    "role": "Data ingestion engineer",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Preserve established data invariants", "Keep preview separate from commit", "Do not broaden into unrelated product surfaces"],
    "deliverables": ["Working ingestion service", "Working ingestion interface", "Ingestion verification evidence"],
    "verification": ["Contract validation passes", "Representative ingestion scenarios pass", "User-visible states agree with persisted outcomes"],
    "maxFiles": 20,
    "maxTurns": 12
  }
}
```
