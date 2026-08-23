import { createHash } from "node:crypto";
import { isMap, isScalar, parseDocument, visit, type Node } from "yaml";
import type { ParsedSkill } from "./types.js";

export const FRONTMATTER_MAX_BYTES = 64 * 1024;
export const SKILL_MAX_BYTES = 1024 * 1024;
const NAME_MAX = 128;
const DESCRIPTION_MAX = 4096;
const COMPATIBILITY_MAX = 1024;
const MAX_HEADINGS = 24;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype", "<<"]);

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function decodeSkillBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function normalizeSkillText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n");
}

function boundedScalar(node: Node | null | undefined, max: number): string | null | undefined {
  if (!node) return null;
  if (!isScalar(node) || typeof node.value !== "string") return undefined;
  const value = node.value.trim();
  if (!value || value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return undefined;
  return value;
}

function cleanHeading(value: string): string {
  return value
    .replace(/`+/g, "")
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function headingsFrom(body: string): string[] {
  const headings: string[] = [];
  let fence: { marker: "`" | "~"; width: number } | null = null;
  for (const line of body.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, width: fenceMatch[1].length };
      else if (marker === fence.marker && fenceMatch[1].length >= fence.width) fence = null;
      continue;
    }
    if (fence) continue;
    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match?.[1]) continue;
    const clean = cleanHeading(match[1]);
    if (clean) headings.push(clean);
    if (headings.length >= MAX_HEADINGS) break;
  }
  return headings;
}

function invalidResult(status: ParsedSkill["status"], hashInput: string, frontmatterBytes = 0): ParsedSkill {
  return {
    status,
    name: null,
    description: null,
    compatibility: null,
    declaredLicense: null,
    headings: [],
    frontmatterBytes,
    normalizedHash: sha256Text(hashInput),
  };
}

export function parseSkill(content: string): ParsedSkill {
  const rawBytes = Buffer.byteLength(content, "utf8");
  if (rawBytes > SKILL_MAX_BYTES) return invalidResult("oversized", content);

  const normalized = normalizeSkillText(content);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return invalidResult("invalid-text", normalized);
  if (!normalized.startsWith("---\n")) return { ...invalidResult("missing-frontmatter", normalized), headings: headingsFrom(normalized) };

  const close = normalized.indexOf("\n---\n", 4);
  const closeAtEnd = normalized.endsWith("\n---") ? normalized.length - 4 : -1;
  const delimiter = close >= 0 ? close : closeAtEnd;
  if (delimiter < 0) return invalidResult("invalid-frontmatter", normalized);
  const rawFrontmatter = normalized.slice(4, delimiter);
  const frontmatterBytes = Buffer.byteLength(rawFrontmatter, "utf8");
  if (frontmatterBytes > FRONTMATTER_MAX_BYTES) return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);
  const body = normalized.slice(Math.min(delimiter + 5, normalized.length));

  try {
    const document = parseDocument(rawFrontmatter, {
      schema: "failsafe",
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
    if (document.errors.length > 0 || document.warnings.length > 0 || !isMap(document.contents)) {
      return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);
    }

    let unsafeStructure = false;
    visit(document, {
      Alias() {
        unsafeStructure = true;
        return visit.BREAK;
      },
      Node(_key, node) {
        if (node.anchor || node.tag) {
          unsafeStructure = true;
          return visit.BREAK;
        }
      },
    });
    if (unsafeStructure) return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);

    const fields = new Map<string, Node | null>();
    for (const pair of document.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);
      const key = pair.key.value.trim();
      if (!key || UNSAFE_KEYS.has(key)) return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);
      fields.set(key, pair.value as Node | null);
    }

    const name = boundedScalar(fields.get("name"), NAME_MAX);
    const description = boundedScalar(fields.get("description"), DESCRIPTION_MAX);
    const compatibility = boundedScalar(fields.get("compatibility"), COMPATIBILITY_MAX);
    const declaredLicense = boundedScalar(fields.get("license"), 128);
    if (name === undefined || description === undefined || compatibility === undefined || declaredLicense === undefined) {
      return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);
    }
    if (!name || !description) return invalidResult("missing-required-fields", normalized, frontmatterBytes);

    return {
      status: "valid",
      name,
      description,
      compatibility,
      declaredLicense,
      headings: headingsFrom(body),
      frontmatterBytes,
      normalizedHash: sha256Text(normalized),
    };
  } catch {
    return invalidResult("invalid-frontmatter", normalized, frontmatterBytes);
  }
}
