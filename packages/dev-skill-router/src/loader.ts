import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { BOUNDS, type LoadedRegistry, type LoadedSkill, type LoadedSubskill, validateSkillDocument, validateSubskillDocument } from "./contracts.ts";
import { canonicalJson, compareText, sha256 } from "./canonical.ts";
import { parseStrictJson } from "./strict-json.ts";

function normalizeMarkdown(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");
}

function assertInside(root: string, candidate: string): string {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const foldedRoot = process.platform === "win32" ? rootResolved.toLocaleLowerCase("en-US") : rootResolved;
  const foldedCandidate = process.platform === "win32" ? candidateResolved.toLocaleLowerCase("en-US") : candidateResolved;
  if (foldedCandidate !== foldedRoot && !foldedCandidate.startsWith(`${foldedRoot}${sep}`)) throw new Error(`Path escapes registry root: ${candidate}`);
  return candidateResolved;
}

function assertNoSymlink(root: string, candidate: string): void {
  const safe = assertInside(root, candidate);
  const rel = relative(resolve(root), safe);
  let current = resolve(root);
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symlinked registry path is forbidden: ${current}`);
  }
  const realRoot = realpathSync(resolve(root));
  const realCandidate = realpathSync(safe);
  assertInside(realRoot, realCandidate);
}

function extractContract(markdown: string, language: "trail-skill" | "trail-subskill", sourcePath: string): unknown {
  if (Buffer.byteLength(markdown, "utf8") > BOUNDS.markdownBytes) throw new Error(`${sourcePath}: markdown exceeds ${BOUNDS.markdownBytes} bytes`);
  const normalized = normalizeMarkdown(markdown);
  const expression = new RegExp("^```" + language + "[ \\t]*\\n([\\s\\S]*?)^```[ \\t]*$", "gm");
  const matches = [...normalized.matchAll(expression)];
  if (matches.length !== 1 || matches[0]?.[1] === undefined) throw new Error(`${sourcePath}: expected exactly one fenced ${language} contract`);
  return parseStrictJson(matches[0][1]);
}

function sourceRef(registryRoot: string, sourcePath: string): { relativePath: string; digest: string } {
  const content = normalizeMarkdown(readFileSync(sourcePath, "utf8"));
  return {
    relativePath: relative(registryRoot, sourcePath).split(sep).join("/"),
    digest: sha256(content),
  };
}

function loadParent(registryRoot: string, parentDirectory: string): LoadedSkill {
  const skillPath = assertInside(registryRoot, resolve(parentDirectory, "SKILL.md"));
  assertNoSymlink(registryRoot, skillPath);
  const document = validateSkillDocument(extractContract(readFileSync(skillPath, "utf8"), "trail-skill", skillPath), skillPath);
  if (basename(parentDirectory) !== document.id) throw new Error(`${skillPath}: directory must equal skill id ${document.id}`);
  const children: LoadedSubskill[] = document.routes.map((route) => {
    const childPath = assertInside(registryRoot, resolve(parentDirectory, route.file));
    assertNoSymlink(registryRoot, childPath);
    if (!statSync(childPath).isFile()) throw new Error(`${childPath}: expected file`);
    const child = validateSubskillDocument(extractContract(readFileSync(childPath, "utf8"), "trail-subskill", childPath), childPath);
    if (child.id !== route.id) throw new Error(`${childPath}: route id ${route.id} does not match child id ${child.id}`);
    if (child.parentId !== document.id) throw new Error(`${childPath}: parentId ${child.parentId} does not match ${document.id}`);
    return { document: child, source: sourceRef(registryRoot, childPath) };
  });

  const childIds = new Set(children.map((child) => child.document.id));
  for (const child of children) {
    for (const dependency of child.document.afterSkills) {
      if (!childIds.has(dependency)) throw new Error(`${child.document.id}: unknown afterSkills dependency ${dependency}`);
      if (dependency === child.document.id) throw new Error(`${child.document.id}: self dependency`);
    }
  }
  for (const broad of document.broadIntents) for (const id of broad.select) if (!childIds.has(id)) throw new Error(`${document.id}.${broad.id}: unknown selected child ${id}`);
  for (const discriminator of document.discriminators) {
    for (const option of discriminator.options) for (const id of option.select) if (!childIds.has(id)) throw new Error(`${document.id}.${discriminator.id}.${option.id}: unknown selected child ${id}`);
  }
  assertAcyclic(children.map((child) => child.document.id), children.flatMap((child) => child.document.afterSkills.map((dependency) => ({ from: dependency, to: child.document.id }))));
  return { document, source: sourceRef(registryRoot, skillPath), children };
}

export function assertAcyclic(nodes: string[], edges: Array<{ from: string; to: string }>): void {
  const incoming = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) throw new Error(`Unknown DAG endpoint ${edge.from} -> ${edge.to}`);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ready = nodes.filter((node) => incoming.get(node) === 0).sort(compareText);
  let visited = 0;
  while (ready.length > 0) {
    const node = ready.shift();
    if (!node) break;
    visited += 1;
    for (const next of (outgoing.get(node) ?? []).sort(compareText)) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1);
      if (incoming.get(next) === 0) {
        ready.push(next);
        ready.sort(compareText);
      }
    }
  }
  if (visited !== nodes.length) throw new Error("Dependency graph contains a cycle");
}

export function loadRegistry(registryRoot: string): LoadedRegistry {
  const root = resolve(registryRoot);
  assertNoSymlink(root, root);
  const parentDirectories = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name))
    .filter((directory) => {
      try {
        return statSync(resolve(directory, "SKILL.md")).isFile();
      } catch {
        return false;
      }
    })
    .sort(compareText);
  if (parentDirectories.length < 1 || parentDirectories.length > BOUNDS.parents) throw new Error(`Registry must contain 1..${BOUNDS.parents} parent skills`);
  const skills = parentDirectories.map((directory) => loadParent(root, directory));
  const allIds = skills.flatMap((skill) => [skill.document.id, ...skill.children.map((child) => child.document.id)]);
  const folded = allIds.map((id) => id.toLocaleLowerCase("en-US"));
  if (new Set(folded).size !== folded.length) throw new Error("Registry ids must be globally unique, including case-folded forms");
  const digest = sha256(canonicalJson(skills.map((skill) => ({
    id: skill.document.id,
    version: skill.document.version,
    source: skill.source,
    children: skill.children.map((child) => ({ id: child.document.id, version: child.document.version, source: child.source })),
  }))));
  return { root, digest, skills };
}
