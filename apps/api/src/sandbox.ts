import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { config, projectRoot } from "./config.js";

export type FixtureManifest = {
  id: string;
  domain: "robotics" | "saas" | "ai-ml" | "hero";
  task: string;
  intendedWorkspace: string;
  allowedPaths: string[];
  checks: [string, string];
  targetPath: string;
  requiredContent: string;
  reviewedTrailId: string;
  humanContext: {
    do: string[];
    doNot: string[];
    route: string[];
    evidence: string[];
  };
};

export class FixtureSandbox {
  readonly root: string;
  readonly manifest: FixtureManifest;
  private changedFiles = new Set<string>();
  private testPassed = false;
  private visiblePassed = false;

  constructor(runId: string, side: "baseline" | "guided", fixtureId = "hero") {
    this.root = resolve(projectRoot, ".trail/runs", runId, side);
    mkdirSync(dirname(this.root), { recursive: true });
    cpSync(join(config.benchmarkPath, "fixtures", fixtureId), this.root, { recursive: true });
    this.manifest = JSON.parse(readFileSync(join(this.root, "manifest.json"), "utf8")) as FixtureManifest;
  }

  private safePath(path: string) {
    const clean = normalize(path).replace(/^([/\\])+/, "").replaceAll("\\", "/");
    const resolved = resolve(this.root, clean);
    if (relative(this.root, resolved).startsWith("..")) throw new Error("Path escapes the disposable fixture workspace.");
    if (!this.manifest.allowedPaths.includes(clean)) throw new Error(`Path is not allowlisted: ${clean}`);
    return { clean, resolved };
  }

  inspect() {
    return {
      workspaceRoot: "$DISPOSABLE_RUN",
      domain: this.manifest.domain,
      candidateFiles: this.manifest.allowedPaths,
      checks: this.manifest.checks,
      changedFiles: [...this.changedFiles],
    };
  }

  read(path: string) {
    return readFileSync(this.safePath(path).resolved, "utf8");
  }

  write(path: string, content: string) {
    const target = this.safePath(path);
    writeFileSync(target.resolved, content, "utf8");
    this.changedFiles.add(target.clean);
    return { path: target.clean, bytes: Buffer.byteLength(content) };
  }

  check(name: string) {
    if (!this.manifest.checks.includes(name)) throw new Error(`Check is not allowlisted: ${name}`);
    const changed = [...this.changedFiles];
    if (name === this.manifest.checks[0]) {
      this.testPassed = changed.some((path) => this.read(path).includes(this.manifest.requiredContent));
      return { name, passed: this.testPassed, observed: changed };
    }
    this.visiblePassed = this.read(this.manifest.targetPath).includes(this.manifest.requiredContent)
      && changed.length > 0
      && changed.every((path) => path === this.manifest.targetPath);
    return { name, passed: this.visiblePassed, observed: this.read(this.manifest.targetPath) };
  }

  releaseState() {
    const changedFiles = [...this.changedFiles];
    const workspace = changedFiles.length === 0
      ? "unresolved-workspace"
      : changedFiles.every((file) => file === this.manifest.targetPath)
        ? this.manifest.intendedWorkspace
        : "wrong-workspace";
    return {
      changedFiles,
      testPassed: this.testPassed,
      remoteAncestor: changedFiles.length > 0,
      browserVisible: this.visiblePassed,
      environment: { workspace },
    };
  }
}
