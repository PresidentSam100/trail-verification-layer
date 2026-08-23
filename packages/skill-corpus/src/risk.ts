import { createHash } from "node:crypto";
import type { RiskFinding, RiskSeverity } from "./types.js";

type Rule = {
  id: string;
  category: string;
  severity: RiskSeverity;
  pattern: RegExp;
};

export const RISK_RULESET_VERSION = "2026-08-23.1";
export const RISK_SCAN_MAX_CHARS = 1024 * 1024;

const RULES: Rule[] = [
  { id: "instruction.override", category: "instruction-hierarchy", severity: "critical", pattern: /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:previous|prior|system|developer|instruction|rule)s?\b/is },
  { id: "instruction.fake-role", category: "instruction-hierarchy", severity: "high", pattern: /<(?:system|developer|assistant|tool_call)>|\bBEGIN\s+(?:SYSTEM|DEVELOPER)\s+(?:PROMPT|MESSAGE)\b/i },
  { id: "instruction.repo-policy", category: "instruction-hierarchy", severity: "high", pattern: /\b(?:modify|replace|remove|ignore)\b.{0,80}\b(?:AGENTS\.md|CLAUDE\.md|SKILL\.md|system prompt)\b/is },
  { id: "credential.access", category: "credential-access", severity: "critical", pattern: /(?:\.ssh[\\/]|id_rsa|id_ed25519|\.aws[\\/](?:credentials|config)|\.env\b|keychain|credential manager|browser (?:cookie|session)|API[_ -]?KEY|PRIVATE[_ -]?KEY)/i },
  { id: "network.exfiltration", category: "exfiltration", severity: "critical", pattern: /\b(?:upload|exfiltrat|send|post|forward)\b.{0,100}\b(?:secret|token|credential|environment variable|private key|cookie|session)\b/is },
  { id: "execute.download", category: "download-execute", severity: "critical", pattern: /(?:curl|wget|Invoke-WebRequest|iwr)\b[^\n|;&]{0,240}(?:\||;|&&)\s*(?:sh|bash|zsh|pwsh|powershell|cmd|iex)\b/i },
  { id: "execute.dynamic", category: "dynamic-execution", severity: "high", pattern: /\b(?:eval|exec|Invoke-Expression)\s*\(|\b(?:npx|pnpx|bunx)\s+(?:-y\s+)?(?:https?:|git\+|github:)/i },
  { id: "filesystem.destructive", category: "destructive-action", severity: "critical", pattern: /\b(?:rm\s+-rf|Remove-Item\b[^\n]{0,100}-Recurse|rmdir\s+\/s|format\s+[A-Z]:|diskpart\b|DROP\s+(?:DATABASE|SCHEMA))\b/i },
  { id: "git.destructive", category: "destructive-action", severity: "high", pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+[^\n]*--force)\b/i },
  { id: "privilege.escalation", category: "privilege-escalation", severity: "high", pattern: /\b(?:sudo|runas|Set-ExecutionPolicy|chmod\s+777|SeDebugPrivilege)\b/i },
  { id: "persistence.install", category: "persistence", severity: "high", pattern: /\b(?:crontab|schtasks|launchctl|systemctl\s+enable|reg\s+add\b[^\n]*\\Run|startup folder)\b/i },
  { id: "remote.instructions", category: "remote-instructions", severity: "high", pattern: /\b(?:fetch|download|read|follow|load)\b.{0,80}\b(?:remote|latest|online|URL)\b.{0,80}\b(?:instruction|prompt|skill|policy)\b/is },
  { id: "external.irreversible", category: "external-side-effect", severity: "medium", pattern: /\b(?:deploy|publish|merge|send (?:an )?(?:email|message)|create (?:an )?account|charge|purchase|pay|transfer money)\b/i },
  { id: "encoded.payload", category: "obfuscation", severity: "medium", pattern: /(?:base64\s+(?:-d|--decode)|FromBase64String|[A-Za-z0-9+/]{300,}={0,2})/i },
  { id: "unsafe.uri", category: "unsafe-reference", severity: "high", pattern: /(?:javascript:|data:text\/html|file:\/\/|https?:\/\/(?:127\.0\.0\.1|localhost|169\.254\.169\.254)|\\\\[^\s]+\\)/i },
  { id: "html.active", category: "active-content", severity: "medium", pattern: /<script\b|\bon(?:load|error|click|focus)\s*=/i },
];

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) if (content.charCodeAt(offset) === 10) line += 1;
  return line;
}

export function scanRisk(content: string): RiskFinding[] {
  const findings: RiskFinding[] = [];
  const truncated = content.length > RISK_SCAN_MAX_CHARS;
  const scanInput = content
    .slice(0, RISK_SCAN_MAX_CHARS)
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, "");
  if (truncated) {
    findings.push({
      ruleId: "content.scan-truncated",
      category: "unbounded-content",
      severity: "critical",
      line: null,
      evidenceHash: createHash("sha256").update("content.scan-truncated\0").update(String(content.length)).digest("hex"),
    });
  }
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(scanInput);
    if (!match) continue;
    const evidenceHash = createHash("sha256").update(rule.id).update("\0").update(match[0]).digest("hex");
    findings.push({ ruleId: rule.id, category: rule.category, severity: rule.severity, line: lineAt(scanInput, match.index), evidenceHash });
  }
  return findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.ruleId.localeCompare(b.ruleId));
}

export function oversizedContentFinding(contentBytes: number): RiskFinding {
  return {
    ruleId: "content.oversized-unscanned",
    category: "unbounded-content",
    severity: "critical",
    line: null,
    evidenceHash: createHash("sha256").update("content.oversized-unscanned\0").update(String(contentBytes)).digest("hex"),
  };
}

export function severityRank(severity: RiskSeverity | "none"): number {
  return { none: 0, low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

export function maximumSeverity(findings: RiskFinding[]): RiskSeverity | "none" {
  return findings.reduce<RiskSeverity | "none">((max, finding) => severityRank(finding.severity) > severityRank(max) ? finding.severity : max, "none");
}
