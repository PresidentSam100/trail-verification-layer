const FACETS: Record<string, readonly string[]> = {
  "surface:marketing": ["landing", "homepage", "marketing", "pricing", "conversion", "copywriting", "campaign"],
  "surface:identity-access": ["auth", "authentication", "authorization", "login", "signup", "signin", "oauth", "session", "password", "sso", "identity"],
  "surface:onboarding": ["onboarding", "activation", "welcome", "wizard", "first-run", "setup-flow"],
  "surface:account": ["account", "profile", "preferences", "settings", "team", "organization", "workspace"],
  "surface:billing": ["billing", "stripe", "subscription", "invoice", "checkout", "payment", "pricing-plan", "entitlement"],
  "quality:accessibility": ["accessibility", "a11y", "aria", "screen-reader", "wcag"],
  "quality:seo": ["seo", "sitemap", "robots", "metadata", "structured-data", "schema-org"],
  "quality:performance": ["performance", "lighthouse", "web-vitals", "latency", "bundle-size", "caching"],
  "quality:analytics": ["analytics", "telemetry", "tracking", "instrumentation", "event-schema"],
  "quality:security": ["security", "privacy", "csrf", "xss", "vulnerability", "threat-model"],
  "operation:testing": ["test", "testing", "playwright", "vitest", "jest", "cypress", "unit-test", "integration-test", "e2e"],
  "operation:deployment": ["deploy", "deployment", "vercel", "netlify", "cloudflare", "ci", "github-actions", "release"],
  "operation:design": ["design", "figma", "css", "tailwind", "responsive", "component", "design-system"],
  "operation:data": ["database", "sql", "postgres", "sqlite", "migration", "schema", "data-model"],
  "operation:documentation": ["documentation", "docs", "readme", "reference", "tutorial"],
};

const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "and", "are", "because", "before", "being", "between", "build", "can", "could", "does", "each", "file", "files", "for", "from", "have", "how", "into", "its", "make", "more", "not", "only", "other", "our", "should", "skill", "skills", "some", "such", "than", "that", "the", "their", "then", "there", "these", "they", "this", "through", "use", "using", "was", "when", "where", "which", "will", "with", "would", "your",
]);

export function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("en-US");
  const tokens = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_.+#-]{1,47}/gu) ?? [];
  return [...new Set(tokens.map((token) => token.replace(/^[_.#-]+|[_.#-]+$/g, "")).filter((token) => token.length >= 2 && !STOP_WORDS.has(token)))];
}

export function deriveFacets(tokens: Iterable<string>): string[] {
  const tokenSet = new Set(tokens);
  const facets: string[] = [];
  for (const [facet, indicators] of Object.entries(FACETS)) if (indicators.some((indicator) => tokenSet.has(indicator))) facets.push(facet);
  return facets.sort();
}

export function weightedSearchTerms(fields: {
  name: string | null;
  description: string | null;
  compatibility: string | null;
  headings: string[];
  repository: string;
  path: string;
  facets: string[];
}): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (value: string, weight: number) => {
    for (const token of tokenize(value)) weights.set(token, Math.max(weights.get(token) ?? 0, weight));
  };
  if (fields.name) add(fields.name, 9);
  if (fields.description) add(fields.description, 6);
  if (fields.compatibility) add(fields.compatibility, 4);
  for (const heading of fields.headings.slice(0, 12)) add(heading, 3);
  add(fields.repository, 2);
  add(fields.path, 2);
  for (const facet of fields.facets) add(facet.replace(":", " "), 8);
  return new Map([...weights.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 48));
}
