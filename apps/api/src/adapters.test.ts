import { describe, expect, it } from "vitest";
import { detectFormat, previewTranscript } from "./adapters.js";

describe("transcript adapters", () => {
  it("recognizes and extracts Codex response items", () => {
    const raw = [
      JSON.stringify({ type: "session_meta", payload: { id: "one" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "PRIVATE SYSTEM ROUTING" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>injected context</environment_context>" }] } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "I do not see changes in the checkout" }] } }),
    ].join("\n");
    expect(detectFormat(raw)).toBe("codex");
    const preview = previewTranscript("codex.jsonl", raw);
    expect(preview.format).toBe("codex");
    expect(preview.candidateSignals).toContain("user-correction");
    expect(preview.redactedText).not.toContain("PRIVATE SYSTEM ROUTING");
    expect(preview.redactedText).not.toContain("injected context");
    expect(preview.redactedText).toContain("[record 3 user]");
  });

  it("recognizes Claude message records", () => {
    const raw = [
      JSON.stringify({ type: "user", message: { content: "the deployment is not working" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Inspecting the remote branch" }] } }),
    ].join("\n");
    expect(detectFormat(raw)).toBe("claude");
    expect(previewTranscript("claude.jsonl", raw).candidateSignals).toContain("user-correction");
  });

  it("extracts Codex event messages as trajectory evidence", () => {
    const raw = [
      JSON.stringify({ type: "session_meta", payload: { id: "two" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "That is the wrong branch" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Checking the remote branch" } }),
    ].join("\n");
    const preview = previewTranscript("codex-events.jsonl", raw);
    expect(preview.redactedText).toContain("wrong branch");
    expect(preview.candidateSignals).toContain("user-correction");
  });
});
