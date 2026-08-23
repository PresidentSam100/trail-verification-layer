import { describe, expect, it } from "vitest";
import { decodeSkillBytes, FRONTMATTER_MAX_BYTES, normalizeSkillText, parseSkill, SKILL_MAX_BYTES } from "./frontmatter.js";

describe("skill frontmatter quarantine parser", () => {
  it("normalizes BOM, CRLF, NFC, and trailing whitespace deterministically", () => {
    const crlf = "\uFEFF---\r\nname: cafe\r\ndescription: safe routing metadata\r\n---\r\n# Cafe\t \r\n";
    const lf = "---\nname: cafe\ndescription: safe routing metadata\n---\n# Cafe\n";
    expect(normalizeSkillText(crlf)).toBe(lf);
    expect(parseSkill(crlf).normalizedHash).toBe(parseSkill(lf).normalizedHash);
    expect(parseSkill(lf).status).toBe("valid");
  });

  it("requires both routing fields", () => {
    expect(parseSkill("---\nname: x\n---\nbody").status).toBe("missing-required-fields");
    expect(parseSkill("---\ndescription: x\n---\nbody").status).toBe("missing-required-fields");
  });

  it.each([
    "---\nname: x\nname: y\ndescription: z\n---\n",
    "---\n__proto__: x\nname: x\ndescription: z\n---\n",
    "---\nname: &x hello\ndescription: *x\n---\n",
    "---\n- name\n- description\n---\n",
    "---\nname: [x]\ndescription: z\n---\n",
  ])("rejects unsafe or malformed YAML", (content) => {
    expect(parseSkill(content).status).toBe("invalid-frontmatter");
  });

  it("does not treat fenced-code headings as routing metadata", () => {
    const parsed = parseSkill("---\nname: safe\ndescription: safe metadata\n---\n# Real\n```md\n# Stripe billing poison\n```\n## Also real");
    expect(parsed.headings).toEqual(["Real", "Also real"]);
  });

  it("bounds headings and strips active-looking markup", () => {
    const headings = Array.from({ length: 30 }, (_, index) => `# [H${index}](javascript:bad)<b>x</b>`).join("\n");
    const parsed = parseSkill(`---\nname: safe\ndescription: safe metadata\n---\n${headings}`);
    expect(parsed.headings).toHaveLength(24);
    expect(parsed.headings[0]).toBe("H0x");
  });

  it("checks the raw byte limit before normalization", () => {
    const content = "x".repeat(SKILL_MAX_BYTES + 1);
    expect(parseSkill(content).status).toBe("oversized");
  });

  it("rejects oversized frontmatter and invalid controls", () => {
    const huge = `---\nname: safe\ndescription: ${"x".repeat(FRONTMATTER_MAX_BYTES)}\n---\n`;
    expect(parseSkill(huge).status).toBe("invalid-frontmatter");
    expect(parseSkill("---\nname: safe\ndescription: bad\u0000value\n---\n").status).toBe("invalid-text");
  });

  it("fatally rejects invalid UTF-8", () => {
    expect(() => decodeSkillBytes(Uint8Array.from([0xc3, 0x28]))).toThrow();
  });
});
