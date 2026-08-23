import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixtureSandbox } from "./sandbox.js";

describe("fixture sandbox", () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "sandbox-id-")); });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

  it("blocks path traversal and non-allowlisted files", () => {
    const sandbox = new FixtureSandbox(basename(directory), "baseline");
    expect(() => sandbox.read("../../.env")).toThrow("escapes");
    expect(() => sandbox.read("manifest.json")).toThrow("not allowlisted");
    expect(sandbox.releaseState().environment.workspace).toBe("unresolved-workspace");
  });

  it("verifies the intended production fixture", () => {
    const sandbox = new FixtureSandbox(basename(directory), "guided");
    sandbox.write("service-live/route.txt", "route=healthy\nsurface=production\n");
    expect(sandbox.check("unit").passed).toBe(true);
    expect(sandbox.check("visible-route").passed).toBe(true);
    expect(sandbox.releaseState().environment.workspace).toBe("service-live");
  });
});
