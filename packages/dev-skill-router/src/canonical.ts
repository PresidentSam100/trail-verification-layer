import { createHash } from "node:crypto";

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeRequest(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function containsTerm(normalizedText: string, rawTerm: string): boolean {
  const term = normalizeRequest(rawTerm);
  if (!term) return false;
  return ` ${normalizedText} `.includes(` ${term} `);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new Error(`Cannot canonicalize ${typeof value}`);
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}
