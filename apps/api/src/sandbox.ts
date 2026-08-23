import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { config, projectRoot } from "./config.js";

type Manifest = { task: string; intendedWorkspace: string; allowedPaths: string[]; checks: string[] };

export class FixtureSandbox {
  readonly root: string;
  readonly manifest: Manifest;
  private changedFiles = new Set<string>();
  private testPassed = false;
  private visiblePassed = false;

  constructor(runId: string, side: "baseline" | "guided") {
    this.root = resolve(projectRoot, ".trail/runs", runId, side);
    mkdirSync(dirname(this.root), { recursive: true });
    cpSync(join(config.benchmarkPath, "fixtures/hero"), this.root, { recursive: true });
    this.manifest = JSON.parse(readFileSync(join(this.root, "manifest.json"), "utf8")) as Manifest;
  }

  private safePath(path: string) {
    const clean = normalize(path).replace(/^([/\\])+/, "");
    const resolved = resolve(this.root, clean);
    if (relative(this.root, resolved).startsWith("..")) throw new Error("Path escapes the disposable fixture workspace.");
    if (!this.manifest.allowedPaths.includes(clean)) throw new Error(`Path is not allowlisted: ${clean}`);
    return { clean, resolved };
  }

  inspect() {
    return {
      workspaceRoot: "$DISPOSABLE_RUN",
      candidateWorkspaceCount: this.manifest.allowedPaths.length,
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
    if (name === "unit") {
      this.testPassed = changed.some((path) => this.read(path).includes("route=healthy"));
      return { name, passed: this.testPassed, observed: changed };
    }
    this.visiblePassed = this.read("service-live/route.txt").includes("route=healthy") && changed.every((path) => path.startsWith("service-live/"));
    return { name, passed: this.visiblePassed, observed: this.read("service-live/route.txt") };
  }

  releaseState() {
    const changedFiles = [...this.changedFiles];
    const workspace = changedFiles.length === 0
      ? "unresolved-workspace"
      : changedFiles.every((file) => file.startsWith("service-live/"))
        ? "service-live"
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
