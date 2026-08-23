# API integration

Connects the customer interface to existing and newly added service behavior.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "api-integration",
  "parentId": "site-development",
  "version": 1,
  "title": "API integration",
  "summary": "Map service contracts into a typed interface boundary and connect the product experience to real loading, success, empty, and failure states.",
  "match": {
    "specific": ["api integration", "connect the api", "frontend backend integration", "wire the api", "service integration"],
    "shared": ["api client", "real data", "service boundary", "endpoint"],
    "negative": ["static mockup", "no backend", "do not touch backend apis"]
  },
  "afterSkills": ["data-ingestion"],
  "tasks": [
    {
      "id": "map-service-contracts",
      "title": "Map service contracts",
      "kind": "inspect",
      "description": "Inventory the service endpoints, shared types, validation rules, and error envelopes needed by the selected customer journeys.",
      "dependsOn": [],
      "outputs": ["Interface-to-service contract map", "Typed request and response inventory", "Error-state map"],
      "acceptance": ["Every selected interface action maps to a real contract", "Error and empty states are represented", "No invented endpoint is treated as existing"]
    },
    {
      "id": "connect-product-interface",
      "title": "Connect the product interface",
      "kind": "implement",
      "description": "Implement the interface boundary and connect selected user actions to real service behavior with consistent state handling.",
      "dependsOn": ["map-service-contracts"],
      "outputs": ["Typed API boundary", "Connected user actions", "Loading and recovery behavior"],
      "acceptance": ["Requests and responses conform to shared contracts", "Failures remain visible and recoverable", "Mock data is not used as successful production state"]
    },
    {
      "id": "verify-api-boundary",
      "title": "Verify the API boundary",
      "kind": "verify",
      "description": "Verify representative requests and visible outcomes across the interface and service boundary, including invalid and unavailable cases.",
      "dependsOn": ["connect-product-interface"],
      "outputs": ["API integration evidence", "Contract mismatch report", "Resolved integration issues"],
      "acceptance": ["Representative success and failure paths agree across layers", "Contract mismatches are resolved or explicitly blocked", "Existing behavior remains compatible"]
    }
  ],
  "dispatch": {
    "role": "Product API integration engineer",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Use existing contracts where available", "Keep service failures explicit", "Do not invent unavailable product behavior"],
    "deliverables": ["Typed interface boundary", "Connected customer flows", "Integration verification evidence"],
    "verification": ["Shared contract checks pass", "Integration scenarios cover success and failure", "Visible state matches service state"],
    "maxFiles": 18,
    "maxTurns": 10
  }
}
```
