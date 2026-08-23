# Deployment

Publishes an already verified site only when production release is requested explicitly.

```trail-subskill
{
  "schemaVersion": "1.0",
  "kind": "subskill",
  "id": "site-deployment",
  "parentId": "site-development",
  "version": 1,
  "title": "Site deployment",
  "summary": "Prepare and release the verified site to its intended production environment with explicit configuration, readiness, and rollback evidence.",
  "match": {
    "specific": ["deploy the site", "deploy it", "publish the site", "host the site", "production release", "ship to production"],
    "shared": ["deployment", "publish", "hosting", "production"],
    "negative": ["do not deploy", "local only", "build only"]
  },
  "afterSkills": ["quality-assurance"],
  "tasks": [
    {
      "id": "verify-release-readiness",
      "title": "Verify release readiness",
      "kind": "verify",
      "description": "Confirm that required verification evidence, environment inputs, build artifacts, service dependencies, and rollback expectations are ready for the requested release.",
      "dependsOn": [],
      "outputs": ["Release readiness record", "Environment requirement map", "Rollback plan"],
      "acceptance": ["No unresolved blocker is treated as release-ready", "Required configuration is identified without embedding secrets", "Rollback criteria are explicit"]
    },
    {
      "id": "release-site",
      "title": "Release the site",
      "kind": "implement",
      "description": "Publish the verified artifacts to the explicitly intended environment and preserve the resulting release identity and observable outcome.",
      "dependsOn": ["verify-release-readiness"],
      "outputs": ["Production release", "Release identity", "Deployment outcome"],
      "acceptance": ["The intended artifact reaches the intended environment", "A failed or pending release is not reported as successful", "The release can be identified independently"]
    },
    {
      "id": "verify-production-release",
      "title": "Verify the production release",
      "kind": "verify",
      "description": "Verify the deployed site's critical public and product journeys plus service reachability in the production environment.",
      "dependsOn": ["release-site"],
      "outputs": ["Production smoke evidence", "Release health summary", "Rollback disposition"],
      "acceptance": ["Critical production journeys are observable", "Release health is reported from evidence", "Rollback is recommended when release criteria fail"]
    }
  ],
  "dispatch": {
    "role": "Site release engineer",
    "allowedPaths": ["apps/", "packages/", "docs/", "render.yaml", ".openai/"],
    "constraints": ["Release only when deployment is explicit", "Do not store secret values in repository files", "Report pending and failed releases accurately"],
    "deliverables": ["Release readiness evidence", "Identifiable production release", "Production smoke evidence"],
    "verification": ["Readiness evidence precedes release", "Critical production journeys are checked", "Rollback disposition is explicit"],
    "maxFiles": 12,
    "maxTurns": 12
  }
}
```
