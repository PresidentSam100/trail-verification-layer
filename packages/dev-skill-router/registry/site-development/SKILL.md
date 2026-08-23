# Site development

Routes requests for completing an existing product's customer-facing site. The contract below is the only executable routing data in this document; surrounding prose is descriptive.

```trail-skill
{
  "schemaVersion": "1.0",
  "kind": "skill",
  "id": "site-development",
  "version": 1,
  "title": "Site development",
  "description": "Plan and coordinate customer-facing product sites, application interfaces, ingestion workflows, service integration, account surfaces, and verification.",
  "scope": [
    "site development",
    "website",
    "site",
    "web application",
    "customer-facing",
    "inference product",
    "product experience",
    "frontend",
    "account",
    "marketing",
    "landing page"
  ],
  "routes": [
    { "id": "product-discovery", "file": "product-discovery/SUBSKILL.md" },
    { "id": "data-ingestion", "file": "data-ingestion/SUBSKILL.md" },
    { "id": "api-integration", "file": "api-integration/SUBSKILL.md" },
    { "id": "product-interface", "file": "product-interface/SUBSKILL.md" },
    { "id": "quality-assurance", "file": "quality-assurance/SUBSKILL.md" },
    { "id": "marketing", "file": "marketing-site/SUBSKILL.md" },
    { "id": "auth", "file": "authentication/SUBSKILL.md" },
    { "id": "onboarding", "file": "onboarding/SUBSKILL.md" },
    { "id": "account", "file": "account-management/SUBSKILL.md" },
    { "id": "billing", "file": "billing/SUBSKILL.md" },
    { "id": "site-deployment", "file": "site-deployment/SUBSKILL.md" }
  ],
  "broadIntents": [
    {
      "id": "inference-entire-site-ingestion-test",
      "whenAll": ["inference product", "entire site", "ingest", "test"],
      "select": ["product-discovery", "data-ingestion", "api-integration", "product-interface", "quality-assurance"]
    },
    {
      "id": "inference-rest-site-data-test",
      "whenAll": ["inference", "rest of", "data", "test"],
      "select": ["product-discovery", "data-ingestion", "api-integration", "product-interface", "quality-assurance"]
    },
    {
      "id": "inference-site-add-data-test",
      "whenAll": ["inference", "site", "add data", "test"],
      "select": ["product-discovery", "data-ingestion", "api-integration", "product-interface", "quality-assurance"]
    }
  ],
  "discriminators": [
    {
      "id": "inference-product-scope",
      "whenAny": ["inference product", "rest of"],
      "unlessAny": [],
      "prompt": "Does the inference API or backend already work, so this should build the customer product around it, or does the inference core itself still need work?",
      "options": [
        {
          "id": "existing-api-full-product",
          "label": "Existing backend, full product",
          "description": "Keep the working inference backend, then build the customer site, formal ingestion and review, connected interface, and end-to-end verification.",
          "select": ["product-discovery", "data-ingestion", "api-integration", "product-interface", "quality-assurance"]
        },
        {
          "id": "inference-core-first",
          "label": "Inference core first",
          "description": "The runtime or model-serving core still needs separate work before the customer-site route is ready.",
          "select": ["product-discovery"]
        }
      ]
    },
    {
      "id": "site-surface",
      "whenAny": ["site", "website"],
      "unlessAny": ["inference product", "marketing site", "landing page", "product interface", "dashboard", "authentication", "sign in", "sign up", "deploy", "publish", "host", "production release"],
      "prompt": "Which surface should this site request produce?",
      "options": [
        {
          "id": "application",
          "label": "Product application",
          "description": "Build the signed-in product interface and connect it to existing behavior.",
          "select": ["product-discovery", "product-interface", "api-integration", "quality-assurance"]
        },
        {
          "id": "public-site",
          "label": "Public website",
          "description": "Build the public marketing and conversion experience.",
          "select": ["product-discovery", "marketing", "quality-assurance"]
        },
        {
          "id": "customer-site",
          "label": "Complete customer site",
          "description": "Build public, access, account, billing, and signed-in product surfaces together.",
          "select": ["product-discovery", "marketing", "auth", "onboarding", "account", "billing", "product-interface", "api-integration", "quality-assurance"]
        }
      ]
    },
    {
      "id": "account-surface",
      "whenAny": ["account"],
      "unlessAny": ["account creation", "account settings", "account management", "sign in", "sign up", "billing", "subscription"],
      "prompt": "Does account work mean access or signed-in account management?",
      "options": [
        {
          "id": "access",
          "label": "Account access",
          "description": "Create sign-up, sign-in, recovery, and session flows.",
          "select": ["product-discovery", "auth", "quality-assurance"]
        },
        {
          "id": "management",
          "label": "Account management",
          "description": "Create profile, organization, and account settings surfaces.",
          "select": ["product-discovery", "account", "quality-assurance"]
        }
      ]
    }
  ]
}
```
