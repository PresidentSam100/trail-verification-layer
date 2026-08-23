import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename } from "node:path";

const rules: Array<{ name: string; expression: RegExp; replacement: string }> = [
  { name: "openai-key", expression: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED_OPENAI_KEY]" },
  { name: "github-token", expression: /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { name: "generic-secret", expression: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?(?!\[REDACTED_)[^\s"']{8,}/gi, replacement: "[REDACTED_SECRET_ASSIGNMENT]" },
  { name: "bearer", expression: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  { name: "email", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" },
  { name: "phone", expression: /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g, replacement: "[REDACTED_PHONE]" },
  { name: "mac-user-path", expression: /\/Users\/(?!\$USER\b)[^/\s"']+/g, replacement: "/Users/$USER" },
  { name: "linux-user-path", expression: /\/home\/(?!\$USER\b)[^/\s"']+/g, replacement: "/home/$USER" },
  { name: "repository-url", expression: /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/g, replacement: "https://github.com/$ORG/$REPO" },
];

export function redactText(input: string) {
  let redacted = input;
  const detections: string[] = [];
  const localUser = basename(homedir());
  if (localUser.length >= 3) {
    const escapedUser = localUser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const userExpression = new RegExp(`\\b${escapedUser}\\b`, "gi");
    const matches = redacted.match(userExpression);
    if (matches?.length) {
      detections.push(...Array(matches.length).fill("local-username"));
      redacted = redacted.replace(userExpression, "[REDACTED_USER]");
    }
  }
  for (const rule of rules) {
    const matches = redacted.match(rule.expression);
    if (matches?.length) {
      detections.push(...Array(matches.length).fill(rule.name));
      redacted = redacted.replace(rule.expression, rule.replacement);
    }
  }
  return { redacted, detections };
}

export function sourceHash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function assertRedacted(input: string) {
  const rerun = redactText(input);
  return rerun.detections.length === 0;
}
