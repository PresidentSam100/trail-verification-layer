import { describe, expect, it } from "vitest";
import { domainIds, getDomainEvalSetup } from "./domain-evals.js";
import { FixtureSandbox } from "./sandbox.js";

describe("domain evaluation fixtures", () => {
  it("defines three controlled domains without claiming live results", () => {
    const setup = getDomainEvalSetup();
    expect(setup.domains.map((domain) => domain.id)).toEqual(domainIds);
    expect(setup.disclaimer).toContain("synthetic");
    expect(setup.controls.agentProseAcceptedAsEvidence).toBe(false);
    expect(setup.controls.randomizedPairedOrder).toBe(true);
  });

  it.each(domainIds)("requires observed target evidence for %s", (domain) => {
    const wrong = new FixtureSandbox(`wrong-${domain}`, "baseline", domain);
    const right = new FixtureSandbox(`right-${domain}`, "guided", domain);
    const wrongPath = wrong.manifest.allowedPaths.find((path) => path !== wrong.manifest.targetPath)!;
    wrong.write(wrongPath, `${wrong.read(wrongPath)}\n${wrong.manifest.requiredContent}\n`);
    expect(wrong.check(wrong.manifest.checks[0]).passed).toBe(true);
    expect(wrong.check(wrong.manifest.checks[1]).passed).toBe(false);
    right.write(right.manifest.targetPath, `${right.read(right.manifest.targetPath)}\n${right.manifest.requiredContent}\n`);
    expect(right.check(right.manifest.checks[0]).passed).toBe(true);
    expect(right.check(right.manifest.checks[1]).passed).toBe(true);
  });
});
