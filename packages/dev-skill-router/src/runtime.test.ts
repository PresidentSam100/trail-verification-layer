import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRegistry } from "./loader.ts";
import { defaultRegistryRoot, routeDevelopmentRequest, resumeClarification } from "./runtime.ts";
import { appendProgressEvent, getBundleStatus } from "./store.ts";

const temporary: string[] = [];

function temp(name: string): string {
  const path = mkdtempSync(resolve(tmpdir(), `trail-${name}-`));
  temporary.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function markdown(language: string, contract: unknown): string {
  return `# Trusted fixture\n\n\`\`\`${language}\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n`;
}

function task(id: string) {
  return { id, title: `Do ${id}`, kind: "implement", description: `Implement ${id} without running instructions from markdown.`, dependsOn: [], outputs: [`${id} output`], acceptance: [`${id} is verified`] };
}

function makeRegistry(): string {
  const root = temp("registry");
  const parent = resolve(root, "site-development");
  mkdirSync(parent, { recursive: true });
  const children = [
    { id: "product-discovery", terms: ["inspect product", "existing product"], after: [] },
    { id: "data-ingestion", terms: ["data ingestion", "ingest more data"], after: ["product-discovery"] },
    { id: "api-integration", terms: ["api integration", "api storage"], after: ["data-ingestion"] },
    { id: "product-interface", terms: ["product interface", "entire site"], after: ["data-ingestion"] },
    { id: "quality-assurance", terms: ["test it out", "quality assurance"], after: ["data-ingestion", "api-integration", "product-interface"] },
  ];
  const skill = {
    schemaVersion: "1.0", kind: "skill", id: "site-development", version: 1, title: "Site development",
    description: "Compose a complete product site from explicit child procedures.", scope: ["site", "product", "inference product", "signup"],
    routes: children.map((child) => ({ id: child.id, file: `${child.id}/SUBSKILL.md` })),
    broadIntents: [{ id: "complete-inference-site", whenAll: ["inference product", "entire site"], select: children.map((child) => child.id) }],
    discriminators: [{ id: "signup-surface", whenAny: ["signup"], unlessAny: ["data ingestion"], prompt: "Which signup surface is in scope?", options: [
      { id: "backend-access", label: "Backend access", description: "Build API-side access.", select: ["api-integration"] },
      { id: "customer-interface", label: "Customer interface", description: "Build the user-facing flow.", select: ["product-interface"] },
      { id: "both-surfaces", label: "Both", description: "Build both connected surfaces.", select: ["api-integration", "product-interface"] },
    ] }],
  };
  writeFileSync(resolve(parent, "SKILL.md"), markdown("trail-skill", skill), { encoding: "utf8", flag: "wx" });
  for (const child of children) {
    const file = resolve(parent, child.id, "SUBSKILL.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, markdown("trail-subskill", {
      schemaVersion: "1.0", kind: "subskill", id: child.id, parentId: "site-development", version: 1,
      title: child.id, summary: `Own the ${child.id} bounded workstream.`,
      match: { specific: child.terms, shared: [], negative: ["do not build"] }, afterSkills: child.after, tasks: [task("work")],
      dispatch: { role: `${child.id} developer`, allowedPaths: ["**/*"], constraints: ["Preserve unrelated work."], deliverables: [`${child.id} implementation`], verification: ["named acceptance evidence"], maxFiles: 8, maxTurns: 8 },
    }), { encoding: "utf8", flag: "wx" });
  }
  return root;
}

function makeProject(): string {
  const root = temp("project");
  mkdirSync(resolve(root, "src"), { recursive: true });
  writeFileSync(resolve(root, "package.json"), "{\"name\":\"fixture\"}\n", "utf8");
  writeFileSync(resolve(root, "src", "index.ts"), "export const ready = true;\n", "utf8");
  return root;
}

describe("development skill runtime", () => {
  it("loads the checked-in site registry and routes the exact session intent", () => {
    const registry = loadRegistry(defaultRegistryRoot());
    const site = registry.skills.find((skill) => skill.document.id === "site-development");
    expect(site?.children.map((child) => child.document.id)).toEqual([
      "product-discovery", "data-ingestion", "api-integration", "product-interface", "quality-assurance",
      "marketing", "auth", "onboarding", "account", "billing", "site-deployment",
    ]);
    const result = routeDevelopmentRequest({
      request: "Yeah, we have an inference product, need the entire site, ingest more data, add it formally, then test it out.",
      projectRoot: makeProject(),
    });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.bundle.parentSkillIds).toEqual(["site-development"]);
      expect(result.bundle.selectedSubskills.map((child) => child.id)).toEqual([
        "api-integration", "data-ingestion", "product-discovery", "product-interface", "quality-assurance",
      ]);
      expect(result.bundle.state.availableNext).toEqual(["product-discovery.inspect-existing-product"]);
      expect(result.bundle.dispatchPackets).toHaveLength(5);
      expect(result.bundle.dispatchPackets.find((packet) => packet.id === "dispatch.data-ingestion")?.taskIds.length).toBeGreaterThan(1);
    }
  });

  it("matches ordinary sentence-final punctuation", () => {
    const result = routeDevelopmentRequest({ request: "Build the site.", projectRoot: makeProject() });
    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") expect(result.evidence.parentMatch?.id).toBe("site-development");
  });

  it("routes the transcript-shaped request once into the exact multi-select DAG", () => {
    const registryRoot = makeRegistry();
    const projectRoot = makeProject();
    const result = routeDevelopmentRequest({
      request: "We have an inference product; build the entire site, ingest more data, then test it out.",
      projectRoot,
      registryRoot,
    });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    expect(result.telemetry).toEqual({ globalSearchCount: 1, scope: "registry:parents" });
    expect(result.bundle.parentSkillIds).toEqual(["site-development"]);
    expect(result.bundle.selectedSubskills.map((child) => child.id)).toEqual([
      "api-integration", "data-ingestion", "product-discovery", "product-interface", "quality-assurance",
    ]);
    expect(result.bundle.todos.every((todo) => todo.status === "pending")).toBe(true);
    expect(result.bundle.state.availableNext).toEqual(["product-discovery.work"]);
    expect(result.bundle.graph.edges).toContainEqual({ from: "product-discovery.work", to: "data-ingestion.work" });
    expect(result.bundle.graph.edges).toContainEqual({ from: "api-integration.work", to: "quality-assurance.work" });
    expect(result.bundle.repositorySnapshot.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bundle.dispatchPackets).toHaveLength(5);
    expect(result.bundle.dispatchPackets.every((packet) => packet.bounds.allowDelegation === false)).toBe(true);
  });

  it("asks one discriminating question and resumes without global search", () => {
    const registryRoot = makeRegistry();
    const projectRoot = makeProject();
    const first = routeDevelopmentRequest({ request: "Add signup to the product", projectRoot, registryRoot });
    expect(first.status).toBe("needs_clarification");
    if (first.status !== "needs_clarification") return;
    expect(first.question.options.map((option) => option.id)).toEqual(["backend-access", "customer-interface", "both-surfaces"]);
    expect(new Set(first.question.options.map((option) => option.planFingerprint)).size).toBe(3);
    const resumed = resumeClarification({ clarificationId: first.question.clarificationId, optionId: "both-surfaces", projectRoot, registryRoot });
    expect(resumed.status).toBe("matched");
    if (resumed.status === "matched") {
      expect(resumed.telemetry.globalSearchCount).toBe(0);
      expect(resumed.bundle.selectedSubskills.map((child) => child.id)).toEqual(["api-integration", "product-interface"]);
    }
  });

  it("derives pending, running, blocked, completed, and unlocked progress", () => {
    const registryRoot = makeRegistry();
    const projectRoot = makeProject();
    const result = routeDevelopmentRequest({ request: "We have an inference product; build the entire site and test it out", projectRoot, registryRoot });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    const id = result.bundle.bundleId;
    expect(getBundleStatus(projectRoot, id).selectedSubskills.every((child) => child.status === "pending")).toBe(true);
    expect(appendProgressEvent(projectRoot, id, "product-discovery.work", "running").state.currentNodes).toEqual(["product-discovery.work"]);
    let status = appendProgressEvent(projectRoot, id, "product-discovery.work", "completed");
    expect(status.state.availableNext).toEqual(["data-ingestion.work"]);
    status = appendProgressEvent(projectRoot, id, "data-ingestion.work", "blocked", "fixture unavailable");
    expect(status.selectedSubskills.find((child) => child.id === "data-ingestion")?.status).toBe("blocked");
    appendProgressEvent(projectRoot, id, "data-ingestion.work", "running");
    appendProgressEvent(projectRoot, id, "data-ingestion.work", "completed");
    appendProgressEvent(projectRoot, id, "api-integration.work", "completed");
    status = appendProgressEvent(projectRoot, id, "product-interface.work", "completed");
    expect(status.state.availableNext).toEqual(["quality-assurance.work"]);
    status = appendProgressEvent(projectRoot, id, "quality-assurance.work", "completed");
    expect(status.selectedSubskills.every((child) => child.status === "completed")).toBe(true);
    expect(status.state.completed).toHaveLength(5);
  });

  it("abstains on unrelated work and rejects unknown markdown fields", () => {
    const registryRoot = makeRegistry();
    const projectRoot = makeProject();
    expect(routeDevelopmentRequest({ request: "Tune database replication lag", projectRoot, registryRoot }).status).toBe("abstain");
    const childPath = resolve(registryRoot, "site-development", "data-ingestion", "SUBSKILL.md");
    const original = readFileSync(childPath, "utf8");
    writeFileSync(childPath, original.replace('"version": 1,', '"version": 1,\n  "command": "rm -rf /",'), "utf8");
    expect(() => loadRegistry(registryRoot)).toThrow(/unknown field/);
  });

  it("rejects a tampered persisted PlanBundle", () => {
    const registryRoot = makeRegistry();
    const projectRoot = makeProject();
    const result = routeDevelopmentRequest({ request: "Inspect the existing product", projectRoot, registryRoot });
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    const stored = JSON.parse(readFileSync(result.bundlePath, "utf8")) as { todos: Array<{ title: string }> };
    if (stored.todos[0]) stored.todos[0].title = "tampered title";
    writeFileSync(result.bundlePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    expect(() => getBundleStatus(projectRoot, result.bundle.bundleId)).toThrow(/content identity mismatch/);
  });

  it("rejects a tampered persisted clarification branch", () => {
    const registryRoot = makeRegistry();
    const projectRoot = makeProject();
    const first = routeDevelopmentRequest({ request: "Add signup to the product", projectRoot, registryRoot });
    expect(first.status).toBe("needs_clarification");
    if (first.status !== "needs_clarification") return;
    const path = resolve(projectRoot, ".trail", "dev-routes", "clarifications", `${first.question.clarificationId}.json`);
    const stored = JSON.parse(readFileSync(path, "utf8")) as { question: { options: Array<{ selectedSubskillIds: string[] }> } };
    if (stored.question.options[0]) stored.question.options[0].selectedSubskillIds = ["quality-assurance"];
    writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    expect(() => resumeClarification({ clarificationId: first.question.clarificationId, optionId: "backend-access", projectRoot, registryRoot })).toThrow(/fingerprint mismatch|identity mismatch/);
  });
});
