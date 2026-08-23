export type SkillSourceManifest = {
  schemaVersion: "1.0";
  id: string;
  kind: "huggingface-parquet";
  dataset: string;
  revision: string;
  artifact: string;
  url: string;
  sha256: string;
  bytes: number;
  rows: number;
  compilationLicense: "CC-BY-4.0";
  itemLicensePolicy: "inherit-upstream-unresolved";
  trustTier: "quarantine-research";
  allowedDownloadHosts: string[];
};

export type SkillDatasetRow = {
  file_row_number: bigint | number;
  content_hash: string;
  computed_hash: string;
  content_bytes: bigint | number;
  repo: string;
  path: string;
  stars: bigint | number;
  source: string;
  html_url: string;
  content_blob: Uint8Array | null;
  lines: bigint | number;
  words: bigint | number;
};

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskFinding = {
  ruleId: string;
  category: string;
  severity: RiskSeverity;
  line: number | null;
  evidenceHash: string;
};

export type ParsedSkill = {
  status: "valid" | "missing-frontmatter" | "missing-required-fields" | "invalid-frontmatter" | "oversized" | "invalid-text";
  name: string | null;
  description: string | null;
  compatibility: string | null;
  declaredLicense: string | null;
  headings: string[];
  frontmatterBytes: number;
  normalizedHash: string;
};

export type IndexedSkillSummary = {
  id: string;
  repository: string;
  path: string;
  sourceUrl: string;
  stars: number;
  parseStatus: ParsedSkill["status"];
  licenseStatus: "unknown";
  trustStatus: "quarantined";
  promotable: false;
  heuristicRiskSeverity: RiskSeverity | "none";
  heuristicRiskCount: number;
  facets: string[];
  matchedTerms: string[];
  score: number;
};

export type CorpusStats = {
  schemaVersion: "1.0";
  sourceId: string;
  sourceRevision: string;
  sourceSha256: string;
  compilationLicense: "CC-BY-4.0";
  itemLicensePolicy: "inherit-upstream-unresolved";
  expectedRows: number;
  rowsSeen: number;
  occurrencesIndexed: number;
  uniqueSkills: number;
  duplicateOccurrences: number;
  rowsRejected: number;
  hashMismatches: number;
  parseStatus: Record<ParsedSkill["status"], number>;
  heuristicRisk: Record<RiskSeverity | "none", number>;
  quarantined: number;
  unknownLicense: number;
  tokenPostings: number;
  uniqueTokens: number;
  sourceContentBytes: number;
  catalogBytes: number;
  catalogSha256: string;
  canonicalDigest: string;
  builtAt: string;
};

export type GenerationManifest = {
  schemaVersion: "1.0";
  generation: string;
  source: {
    id: string;
    dataset: string;
    revision: string;
    sha256: string;
    bytes: number;
    rows: number;
    compilationLicense: "CC-BY-4.0";
    itemLicensePolicy: "inherit-upstream-unresolved";
  };
  implementation: {
    indexSchemaVersion: number;
    parserVersion: string;
    riskRulesetVersion: string;
    rankerVersion: string;
  };
  catalog: { file: "catalog.sqlite"; bytes: number; sha256: string; canonicalDigest: string };
  stats: { file: "stats.json"; bytes: number; sha256: string };
  safety: { trustStatus: "quarantined"; promotable: false; rawBodiesStoredInIndex: false; rawBodiesReturnedByApi: false };
  builtAt: string;
};

export type ActiveGeneration = {
  schemaVersion: "1.0";
  generation: string;
  manifestSha256: string;
  activatedAt: string;
};
