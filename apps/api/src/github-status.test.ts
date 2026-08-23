import { describe, expect, it } from "vitest";
import { publishVerificationStatus } from "./github-status.js";

describe("GitHub status boundary", () => {
  it("rejects unresolved repositories and SHAs before invoking gh", () => {
    expect(() => publishVerificationStatus({ repo: "*", sha: "main", state: "success", description: "bad" })).toThrow("owner/name");
    expect(() => publishVerificationStatus({ repo: "owner/repo", sha: "main", state: "success", description: "bad" })).toThrow("Commit SHA");
  });
});
