import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IngestionPreview } from "@trail/contracts";
import { redactText } from "./redaction.js";

type TranscriptFormat = IngestionPreview["format"];
type TranscriptLine = { record: number; role: string; text: string };

function safeJson(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function detectFormat(text: string): TranscriptFormat {
  const records = text.split("\n").slice(0, 30).map(safeJson).filter(Boolean) as Array<Record<string, unknown>>;
  if (records.some((record) => record.type === "session_meta" || record.type === "response_item")) return "codex";
  if (records.some((record) => record.type === "assistant" || record.type === "user") && records.some((record) => "message" in record)) return "claude";
  return "unknown";
}

function textFromCodex(record: Record<string, unknown>, recordIndex: number): TranscriptLine[] {
  if (record.type === "event_msg") {
    const payload = record.payload as Record<string, unknown> | undefined;
    const eventType = String(payload?.type ?? "");
    if (eventType === "user_message" || eventType === "agent_message") {
      const text = String(payload?.message ?? payload?.text ?? "");
      return text ? [{ record: recordIndex, role: eventType === "user_message" ? "user" : "assistant", text }] : [];
    }
  }
  if (record.type !== "response_item") return [];
  const payload = record.payload as Record<string, unknown> | undefined;
  if (!payload) return [];
  if (payload.type === "message") {
    const role = String(payload.role ?? "unknown");
    if (role === "developer" || role === "system") return [];
    const content = Array.isArray(payload.content) ? payload.content : [];
    return content.flatMap((item) => {
      const value = item as Record<string, unknown>;
      return value.type === "input_text" || value.type === "output_text" ? [{ record: recordIndex, role, text: String(value.text ?? "") }] : [];
    });
  }
  if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    return [{ record: recordIndex, role: "tool", text: String(payload.output ?? "") }];
  }
  return [];
}

function textFromClaude(record: Record<string, unknown>, recordIndex: number): TranscriptLine[] {
  if (record.type !== "user" && record.type !== "assistant") return [];
  const role = String(record.type);
  const message = record.message as Record<string, unknown> | undefined;
  if (!message) return [];
  if (typeof message.content === "string") return [{ record: recordIndex, role, text: message.content }];
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((item) => {
    const value = item as Record<string, unknown>;
    if (value.type === "text") return [{ record: recordIndex, role, text: String(value.text ?? "") }];
    if (value.type === "tool_result") return [{ record: recordIndex, role: "tool", text: typeof value.content === "string" ? value.content : JSON.stringify(value.content ?? "") }];
    return [];
  });
}

function signalScore(line: TranscriptLine) {
  let score = line.role === "user" ? 1 : 0;
  if (/\b(?:not working|wrong|do not|don.t see|not the|why did|still see|instead|exact)\b/i.test(line.text)) score += 5;
  if (/exit code [1-9]|is_error|error:|failed|blocked/i.test(line.text)) score += 4;
  if (/pull request|merge|remote main|deploy|production|status check|verified|browser|provider|serial|checkout|branch|worktree/i.test(line.text)) score += 3;
  return score;
}

function isInjectedContext(line: TranscriptLine) {
  if (line.role !== "user") return false;
  const start = line.text.trimStart();
  return start.startsWith("<recommended_plugins>")
    || start.startsWith("# AGENTS.md instructions")
    || start.startsWith("<environment_context>")
    || start.startsWith("<app-context>")
    || start.startsWith("<permissions instructions>")
    || start.startsWith("<skills_instructions>");
}

function shortlist(lines: TranscriptLine[]) {
  if (lines.length === 0) return "";
  const selected = new Set<number>();
  const firstUser = lines.findIndex((line) => line.role === "user");
  if (firstUser >= 0) selected.add(firstUser);
  lines
    .map((line, index) => ({ index, score: signalScore(line) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 36)
    .forEach(({ index }) => {
      for (let offset = -1; offset <= 1; offset += 1) if (lines[index + offset]) selected.add(index + offset);
    });
  for (let index = Math.max(0, lines.length - 5); index < lines.length; index += 1) selected.add(index);
  return [...selected]
    .sort((a, b) => a - b)
    .flatMap((index) => {
      const line = lines[index];
      if (!line) return [];
      const limit = line.role === "tool" ? 2_500 : 4_000;
      return [`[record ${line.record} ${line.role}]\n${line.text.slice(0, limit)}`];
    })
    .join("\n")
    .slice(0, 120_000);
}

export function extractTranscriptText(raw: string, format = detectFormat(raw)) {
  const records = raw.split("\n").map(safeJson).filter(Boolean) as Array<Record<string, unknown>>;
  const lines = records.flatMap((record, index) => format === "codex" ? textFromCodex(record, index) : format === "claude" ? textFromClaude(record, index) : []);
  return shortlist(lines.filter((line) => line.text.trim() && !isInjectedContext(line)));
}

export function previewTranscript(sourceName: string, raw: string): IngestionPreview {
  const format = detectFormat(raw);
  const extracted = extractTranscriptText(raw, format);
  const { redacted, detections } = redactText(extracted || raw.slice(0, 120_000));
  const signalPatterns: Array<[string, RegExp]> = [
    ["tool-error", /exit code [1-9]|is_error|error:/i],
    ["user-correction", /\b(?:not working|wrong|(?:i )?(?:do not|don.t) see|not the|why did|still see)\b/i],
    ["environment-change", /\b(?:ubuntu|mac|remote|worktree|branch|cwd|checkout)\b/i],
    ["release-proof", /\b(?:pull request|merge|remote main|deploy|production|status check)\b/i],
    ["runtime-proof", /\b(?:browser|opened successfully|provider|serial|http 2\d\d|verified)\b/i],
  ];
  const candidateSignals = signalPatterns.filter(([, expression]) => expression.test(redacted)).map(([name]) => name);
  return {
    id: randomUUID(),
    format,
    sourceName,
    redactedText: redacted,
    redactionCount: detections.length,
    candidateSignals,
    requiresReview: detections.length > 0 || format === "unknown",
  };
}

export function previewTranscriptFile(path: string) {
  return previewTranscript(path.split("/").at(-1) ?? "transcript.jsonl", readFileSync(path, "utf8"));
}
