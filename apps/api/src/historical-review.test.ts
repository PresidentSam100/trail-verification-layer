import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("historical review manifest", () => {
  it("contains only privacy-safe hashed provenance", () => {
    const raw = readFileSync(resolve("corpus/reviews/historical-review-manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as { reviews: Array<{ sourcePathHash: string; redactedExcerptHash: string; sourceRange: string; observations: string[] }> };
    expect(manifest.reviews.length).toBeGreaterThanOrEqual(7);
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toMatch(/\/home\//);
    for (const review of manifest.reviews) {
      expect(review.sourcePathHash).toMatch(/^[a-f0-9]{64}$/);
      expect(review.redactedExcerptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(review.sourceRange).toMatch(/^redacted records \d+-\d+$/);
      expect(review.observations.length).toBeGreaterThan(0);
    }
    const trails = JSON.parse(readFileSync(resolve("corpus/public/seed-trails.json"), "utf8")) as Array<{
      provenance: { provider: string; sourceHash: string; sourceRange: string };
    }>;
    const reviewedHashes = new Set(manifest.reviews.map((review) => review.redactedExcerptHash));
    for (const trail of trails.filter((entry) => entry.provenance.provider !== "benchmark")) {
      expect(reviewedHashes.has(trail.provenance.sourceHash)).toBe(true);
      expect(trail.provenance.sourceRange).toMatch(/^redacted records \d+-\d+$/);
    }
  });
});
