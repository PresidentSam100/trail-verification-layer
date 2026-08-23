import { homedir } from "node:os";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { assertRedacted, redactText } from "./redaction.js";

describe("redactText", () => {
  it("removes secrets and personal identifiers before API use", () => {
    const localUser = basename(homedir());
    const input = `OPENAI_API_KEY=sk-abcdefghijklmnop user@example.com /Users/josh/private +1 (513) 555-1212 https://github.com/person/private owner ${localUser}`;
    const result = redactText(input);
    expect(result.redacted).not.toContain("sk-abcdefghijklmnop");
    expect(result.redacted).not.toContain("user@example.com");
    expect(result.redacted).not.toContain("/Users/josh");
    expect(result.redacted).not.toContain("555-1212");
    expect(result.redacted).not.toContain(localUser);
    expect(result.redacted).toContain("/Users/$USER");
    expect(result.detections.length).toBeGreaterThanOrEqual(4);
    expect(assertRedacted(result.redacted)).toBe(true);
  });
});
