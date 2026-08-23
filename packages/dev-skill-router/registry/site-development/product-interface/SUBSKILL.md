# Product interface

Builds the cohesive signed-in experience around existing product capabilities.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "product-interface",
  "parentId": "site-development",
  "version": 1,
  "title": "Product interface",
  "summary": "Turn the product scope into a coherent, responsive signed-in interface with clear hierarchy, complete states, and accessible interactions.",
  "match": {
    "specific": ["product interface", "product ui", "application interface", "dashboard experience", "customer-facing product"],
    "shared": ["signed-in experience", "dashboard", "responsive interface", "frontend experience"],
    "negative": ["marketing only", "api only", "do not touch the product application"]
  },
  "afterSkills": ["data-ingestion"],
  "tasks": [
    {
      "id": "design-information-architecture",
      "title": "Design the information architecture",
      "kind": "design",
      "description": "Arrange the selected product capabilities into understandable navigation, pages, state transitions, and responsive layouts consistent with existing conventions.",
      "dependsOn": [],
      "outputs": ["Navigation and page map", "Component and state inventory", "Responsive behavior plan"],
      "acceptance": ["Every selected capability has a discoverable home", "Primary journeys require no dead-end navigation", "Loading, empty, error, and success states are planned"]
    },
    {
      "id": "implement-product-experience",
      "title": "Implement the product experience",
      "kind": "implement",
      "description": "Build the selected signed-in surfaces, reusable components, responsive layouts, and explicit interaction states using the repository's established patterns.",
      "dependsOn": ["design-information-architecture"],
      "outputs": ["Signed-in product surfaces", "Reusable interface components", "Responsive interaction states"],
      "acceptance": ["Core journeys are usable at supported viewport sizes", "Components follow established visual and code conventions", "All asynchronous states are visible"]
    },
    {
      "id": "verify-interface-quality",
      "title": "Verify interface quality",
      "kind": "verify",
      "description": "Inspect the implemented experience for hierarchy, responsiveness, accessibility, state completeness, and consistency with the agreed customer journey.",
      "dependsOn": ["implement-product-experience"],
      "outputs": ["Interface quality evidence", "Accessibility findings", "Resolved usability defects"],
      "acceptance": ["Primary journeys are keyboard-usable", "Supported layouts do not obscure critical actions", "Visible states remain consistent with the design map"]
    }
  ],
  "dispatch": {
    "role": "Product interface engineer",
    "allowedPaths": ["apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Follow existing interface conventions", "Represent all asynchronous states", "Do not add unrelated marketing or account scope"],
    "deliverables": ["Coherent signed-in interface", "Responsive and accessible states", "Interface quality evidence"],
    "verification": ["Primary journeys are inspectable end to end", "Responsive layouts remain usable", "Accessibility checks cover interactive elements"],
    "maxFiles": 20,
    "maxTurns": 12
  }
}
```
