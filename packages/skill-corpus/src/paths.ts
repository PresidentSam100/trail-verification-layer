import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const projectRoot = resolve(import.meta.dirname, "../../..");
export const skillCorpusRoot = resolve(projectRoot, ".trail/skill-corpus");
export const sourceManifestRoot = resolve(projectRoot, "corpus/skill-sources");

export function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return resolvedCandidate;
  throw new Error(`Path escapes the skill corpus root: ${resolvedCandidate}`);
}

function assertDirectoryStat(path: string, stat: Stats): void {
  if (stat.isSymbolicLink()) throw new Error(`Refusing a symlinked corpus path: ${path}`);
  if (!stat.isDirectory()) throw new Error(`Expected a corpus directory: ${path}`);
}

/**
 * Creates one path segment at a time. Existing segments are checked before any
 * child is created, so a junction/symlink cannot redirect mkdir outside root.
 */
export function ensureSafeDirectory(root: string, directory: string): string {
  const lexicalRoot = resolve(root);
  const physicalRoot = realpathSync(root);
  const target = assertInside(lexicalRoot, resolve(directory));
  const rel = relative(lexicalRoot, target);
  let cursor = lexicalRoot;

  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor)) {
      assertDirectoryStat(cursor, lstatSync(cursor));
    } else {
      mkdirSync(cursor);
      assertDirectoryStat(cursor, lstatSync(cursor));
    }
  }

  const physicalTarget = realpathSync(target);
  assertInside(physicalRoot, physicalTarget);
  return target;
}

export function assertSafeDirectory(root: string, directory: string): string {
  const lexicalRoot = resolve(root);
  const physicalRoot = realpathSync(root);
  const target = assertInside(lexicalRoot, resolve(directory));
  const rel = relative(lexicalRoot, target);
  let cursor = lexicalRoot;
  for (const segment of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) throw new Error(`Missing corpus directory: ${cursor}`);
    assertDirectoryStat(cursor, lstatSync(cursor));
  }
  const physicalTarget = realpathSync(target);
  assertInside(physicalRoot, physicalTarget);
  return target;
}

export function ensureCorpusRoot(baseProjectRoot = projectRoot): string {
  const lexicalProjectRoot = resolve(baseProjectRoot);
  realpathSync(lexicalProjectRoot);
  return ensureSafeDirectory(lexicalProjectRoot, resolve(lexicalProjectRoot, ".trail", "skill-corpus"));
}

export function assertRegularFile(path: string, label = "corpus file"): Stats {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Refusing non-regular ${label}: ${path}`);
  if (stat.nlink !== 1) throw new Error(`Refusing hard-linked ${label}: ${path}`);
  return stat;
}

export function assertSafeFileParent(root: string, path: string): string {
  const safe = assertInside(root, path);
  ensureSafeDirectory(root, dirname(safe));
  if (existsSync(safe)) assertRegularFile(safe);
  return safe;
}

export function artifactPath(source: SkillSourcePath, root = ensureCorpusRoot()): string {
  if (basename(source.artifact) !== source.artifact) throw new Error(`Artifact must be a basename: ${source.artifact}`);
  return assertInside(root, resolve(root, "artifacts", source.id, source.revision, source.artifact));
}

export type SkillSourcePath = { id: string; revision: string; artifact: string };
