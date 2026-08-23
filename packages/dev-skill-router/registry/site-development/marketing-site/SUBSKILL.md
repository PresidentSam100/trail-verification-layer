# Marketing site

Creates the public product story and conversion path when public-site work is named explicitly.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "marketing",
  "parentId": "site-development",
  "version": 1,
  "title": "Marketing site",
  "summary": "Design and implement a clear public website that explains the product, builds trust, and leads visitors to the appropriate next action.",
  "match": {
    "specific": ["marketing site", "landing page", "pricing page", "public website", "product marketing"],
    "shared": ["homepage", "conversion", "public pages", "product story"],
    "negative": ["signed-in only", "internal tool only"]
  },
  "afterSkills": ["product-discovery"],
  "tasks": [
    {
      "id": "design-public-journey",
      "title": "Design the public journey",
      "kind": "design",
      "description": "Define the audience, claims, information hierarchy, trust evidence, calls to action, and public-page structure from verified product capabilities.",
      "dependsOn": [],
      "outputs": ["Public page map", "Message hierarchy", "Conversion journey"],
      "acceptance": ["Claims are supported by current product behavior", "Each page has a clear audience and next action", "The journey reaches an appropriate access or contact surface"]
    },
    {
      "id": "implement-public-site",
      "title": "Implement the public site",
      "kind": "implement",
      "description": "Build responsive public pages and reusable sections that communicate the verified product story without mixing in signed-in application behavior.",
      "dependsOn": ["design-public-journey"],
      "outputs": ["Responsive public pages", "Reusable marketing sections", "Connected calls to action"],
      "acceptance": ["Public pages remain usable at supported viewport sizes", "Calls to action lead to real destinations", "Unsupported claims are absent"]
    },
    {
      "id": "verify-public-site",
      "title": "Verify the public site",
      "kind": "verify",
      "description": "Review public pages for message accuracy, responsive behavior, navigation, accessibility, and conversion-path completeness.",
      "dependsOn": ["implement-public-site"],
      "outputs": ["Public-site review evidence", "Resolved content and layout defects"],
      "acceptance": ["Primary public navigation has no dead ends", "Critical content is readable and accessible", "Product claims remain evidence-backed"]
    }
  ],
  "dispatch": {
    "role": "Product marketing site engineer",
    "allowedPaths": ["apps/web/", "docs/", "public/"],
    "constraints": ["Use only verified product claims", "Keep signed-in product behavior out of public-only surfaces", "Follow existing brand and interface conventions"],
    "deliverables": ["Public website surfaces", "Connected conversion journey", "Public-site review evidence"],
    "verification": ["Content claims trace to product evidence", "Public navigation and layouts are complete", "Interactive elements are accessible"],
    "maxFiles": 16,
    "maxTurns": 10
  }
}
```
