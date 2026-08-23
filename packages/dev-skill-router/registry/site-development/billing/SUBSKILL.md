# Billing

Adds pricing, subscription, checkout, invoice, and billing-management surfaces only when billing is named.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "billing",
  "parentId": "site-development",
  "version": 1,
  "title": "Billing",
  "summary": "Implement customer-visible plan, checkout, subscription, invoice, and billing-state experiences against the product's established billing boundary.",
  "match": {
    "specific": ["billing", "subscription", "checkout", "invoice", "payment plan", "pricing plans"],
    "shared": ["plan management", "paid tier", "upgrade", "cancel plan"],
    "negative": ["free product only", "marketing pricing only"]
  },
  "afterSkills": ["auth", "account"],
  "tasks": [
    {
      "id": "map-billing-lifecycle",
      "title": "Map the billing lifecycle",
      "kind": "inspect",
      "description": "Identify supported plans, checkout transitions, subscription states, invoice data, permissions, failure cases, and externally managed steps.",
      "dependsOn": [],
      "outputs": ["Billing lifecycle map", "Plan and subscription state inventory", "Billing boundary constraints"],
      "acceptance": ["All displayed billing states come from supported behavior", "Externally managed steps are explicit", "Failure and pending states are represented"]
    },
    {
      "id": "implement-billing-experience",
      "title": "Implement the billing experience",
      "kind": "implement",
      "description": "Build the selected plan, checkout, subscription, invoice, and management surfaces with accurate confirmation and pending states.",
      "dependsOn": ["map-billing-lifecycle"],
      "outputs": ["Plan and billing surfaces", "Connected subscription actions", "Confirmation and pending states"],
      "acceptance": ["Displayed plan and subscription state matches the billing source", "Actions distinguish submitted, pending, completed, and failed outcomes", "Repeated interaction cannot misrepresent duplicate success"]
    },
    {
      "id": "verify-billing-experience",
      "title": "Verify the billing experience",
      "kind": "verify",
      "description": "Verify representative new, active, pending, failed, changed, and canceled billing states without claiming unsupported settlement outcomes.",
      "dependsOn": ["implement-billing-experience"],
      "outputs": ["Billing verification evidence", "Resolved subscription-state defects"],
      "acceptance": ["Visible state agrees with the billing source", "Pending and failed outcomes are not reported as complete", "Plan changes preserve a coherent account state"]
    }
  ],
  "dispatch": {
    "role": "Billing experience engineer",
    "allowedPaths": ["apps/api/", "apps/web/", "packages/contracts/", "docs/"],
    "constraints": ["Use only the established billing boundary", "Never infer settlement from a submitted request", "Keep payment secrets out of product and repository output"],
    "deliverables": ["Connected billing surfaces", "Accurate subscription state handling", "Billing verification evidence"],
    "verification": ["Billing states agree across interface and service", "Pending and failure scenarios are covered", "No secret payment data appears in changed files"],
    "maxFiles": 18,
    "maxTurns": 12
  }
}
```
