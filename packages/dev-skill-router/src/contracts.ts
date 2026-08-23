export const SCHEMA_VERSION = "1.0" as const;
export const PROGRESS_STATUSES = ["pending", "running", "blocked", "completed"] as const;
export const TASK_KINDS = ["inspect", "design", "implement", "verify"] as const;

export const BOUNDS = {
  markdownBytes: 64 * 1024,
  parents: 8,
  routesPerParent: 16,
  selectedSubskills: 12,
  tasksPerSubskill: 8,
  totalTasks: 64,
  dispatchPackets: 12,
  stringsPerField: 24,
  stringLength: 500,
  packetBytes: 32 * 1024,
  progressEvents: 2048,
  progressEventBytes: 4096,
} as const;

export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export type TaskKind = (typeof TASK_KINDS)[number];

export interface SkillRoute {
  id: string;
  file: string;
}

export interface DiscriminatorOption {
  id: string;
  label: string;
  description: string;
  select: string[];
}

export interface Discriminator {
  id: string;
  whenAny: string[];
  unlessAny: string[];
  prompt: string;
  options: DiscriminatorOption[];
}

export interface BroadIntent {
  id: string;
  whenAll: string[];
  select: string[];
}

export interface SkillDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "skill";
  id: string;
  version: number;
  title: string;
  description: string;
  scope: string[];
  routes: SkillRoute[];
  broadIntents: BroadIntent[];
  discriminators: Discriminator[];
}

export interface MatchContract {
  specific: string[];
  shared: string[];
  negative: string[];
}

export interface TaskTemplate {
  id: string;
  title: string;
  kind: TaskKind;
  description: string;
  dependsOn: string[];
  outputs: string[];
  acceptance: string[];
}

export interface DispatchTemplate {
  role: string;
  allowedPaths: string[];
  constraints: string[];
  deliverables: string[];
  verification: string[];
  maxFiles: number;
  maxTurns: number;
}

export interface SubskillDocument {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "subskill";
  id: string;
  parentId: string;
  version: number;
  title: string;
  summary: string;
  match: MatchContract;
  afterSkills: string[];
  tasks: TaskTemplate[];
  dispatch: DispatchTemplate;
}

export interface SourceRef {
  relativePath: string;
  digest: string;
}

export interface LoadedSubskill {
  document: SubskillDocument;
  source: SourceRef;
}

export interface LoadedSkill {
  document: SkillDocument;
  source: SourceRef;
  children: LoadedSubskill[];
}

export interface LoadedRegistry {
  root: string;
  digest: string;
  skills: LoadedSkill[];
}

export interface RepositorySnapshot {
  algorithm: "sha256";
  digest: string;
  fileCount: number;
  totalBytes: number;
  head: string | null;
  manifests: string[];
  languages: string[];
}

export interface SelectedSubskill {
  id: string;
  parentId: string;
  title: string;
  status: ProgressStatus;
  reasons: string[];
  source: SourceRef;
}

export interface PlanStep {
  id: string;
  subskillId: string;
  title: string;
  kind: TaskKind;
  description: string;
  dependsOn: string[];
  outputs: string[];
  acceptance: string[];
}

export interface Todo {
  id: string;
  subskillId: string;
  title: string;
  status: ProgressStatus;
  dependsOn: string[];
}

export interface DispatchPacket {
  id: string;
  subskillId: string;
  objective: string;
  taskIds: string[];
  dependsOn: string[];
  allowedPaths: string[];
  constraints: string[];
  deliverables: string[];
  verification: string[];
  bounds: { maxFiles: number; maxTurns: number; allowDelegation: false };
  pinnedDigests: { bundleId: string; repositorySnapshot: string; registry: string; skillSource: string };
}

export interface PlanGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

export interface RouteState {
  currentNodes: string[];
  availableNext: string[];
  unlocked: string[];
  completed: string[];
  blocked: Array<{ todoId: string; blockedBy: string[]; reason?: string }>;
}

export interface PlanBundle {
  schemaVersion: typeof SCHEMA_VERSION;
  bundleVersion: 1;
  bundleId: string;
  request: string;
  normalizedRequest: string;
  repositorySnapshot: RepositorySnapshot;
  registryDigest: string;
  parentSkillIds: string[];
  selectedSubskills: SelectedSubskill[];
  graph: PlanGraph;
  plan: PlanStep[];
  todos: Todo[];
  dispatchPackets: DispatchPacket[];
  state: RouteState;
  transitionTrace: TransitionRecord[];
}

export interface TransitionRecord {
  sequence: number;
  from: string;
  to: string;
  status: ProgressStatus;
  reason: string;
}

export interface ParentMatchEvidence {
  id: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface ChildMatchEvidence {
  id: string;
  score: number;
  reasons: string[];
  selected: boolean;
  rejectedReason?: string;
}

export interface DecisionEvidence {
  request: string;
  normalizedRequest: string;
  parentMatch: ParentMatchEvidence | null;
  childMatches: ChildMatchEvidence[];
}

export interface SearchTelemetry {
  globalSearchCount: 0 | 1;
  scope: string;
}

export interface ClarificationQuestion {
  clarificationId: string;
  id: string;
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    selectedSubskillIds: string[];
    planFingerprint: string;
  }>;
  rerunHint: string;
}

export type RouteDecision =
  | { status: "matched"; bundlePath: string; bundle: PlanBundle; evidence: DecisionEvidence; telemetry: SearchTelemetry; transitionTrace: TransitionRecord[] }
  | { status: "needs_clarification"; question: ClarificationQuestion; stableSubskillIds: string[]; evidence: DecisionEvidence; telemetry: SearchTelemetry; transitionTrace: TransitionRecord[] }
  | { status: "abstain"; reasonCodes: string[]; diagnostics: string[]; evidence: DecisionEvidence; telemetry: SearchTelemetry; transitionTrace: TransitionRecord[] };

export interface DerivedBundleStatus {
  bundleId: string;
  bundlePath: string;
  selectedSubskills: Array<{ id: string; title: string; status: ProgressStatus; todoIds: string[] }>;
  todos: Array<Todo & { blockedBy: string[]; reason?: string }>;
  state: RouteState;
  transitionTrace: TransitionRecord[];
  eventCount: number;
}

export interface ProgressEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  sequence: number;
  bundleId: string;
  todoId: string;
  status: ProgressStatus;
  reason?: string;
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function objectAt(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "expected object");
  const result = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(result)) if (!allowed.has(key)) fail(`${path}.${key}`, "unknown field");
  for (const key of required) if (!(key in result)) fail(`${path}.${key}`, "required field missing");
  return result;
}

function stringAt(value: unknown, path: string, maximum: number = BOUNDS.stringLength): string {
  if (typeof value !== "string") fail(path, "expected string");
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) fail(path, "invalid string");
  return normalized;
}

function idAt(value: unknown, path: string): string {
  const id = stringAt(value, path, 80);
  if (!ID.test(id)) fail(path, "expected lowercase kebab-case id");
  return id;
}

function integerAt(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(path, `expected integer ${minimum}..${maximum}`);
  return value as number;
}

function stringsAt(value: unknown, path: string, options: { min?: number; max?: number; ids?: boolean } = {}): string[] {
  if (!Array.isArray(value)) fail(path, "expected array");
  const minimum = options.min ?? 0;
  const maximum = options.max ?? BOUNDS.stringsPerField;
  if (value.length < minimum || value.length > maximum) fail(path, `expected ${minimum}..${maximum} entries`);
  const result = value.map((item, index) => options.ids ? idAt(item, `${path}[${index}]`) : stringAt(item, `${path}[${index}]`));
  const folded = result.map((item) => item.toLocaleLowerCase("en-US"));
  if (new Set(folded).size !== result.length) fail(path, "duplicate entries");
  return result;
}

function relativePathAt(value: unknown, path: string, expectedBasename?: string): string {
  const result = stringAt(value, path, 240);
  if (result.includes("\\") || result.startsWith("/") || /^[A-Za-z]:/.test(result)) fail(path, "expected portable relative path");
  const parts = result.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) fail(path, "path traversal is forbidden");
  if (expectedBasename && parts.at(-1) !== expectedBasename) fail(path, `must end in ${expectedBasename}`);
  return result;
}

function literalAt<T extends string>(value: unknown, path: string, expected: T): T {
  if (value !== expected) fail(path, `expected ${JSON.stringify(expected)}`);
  return expected;
}

function validateRoute(value: unknown, path: string): SkillRoute {
  const object = objectAt(value, path, ["id", "file"]);
  return { id: idAt(object.id, `${path}.id`), file: relativePathAt(object.file, `${path}.file`, "SUBSKILL.md") };
}

function validateBroadIntent(value: unknown, path: string): BroadIntent {
  const object = objectAt(value, path, ["id", "whenAll", "select"]);
  return {
    id: idAt(object.id, `${path}.id`),
    whenAll: stringsAt(object.whenAll, `${path}.whenAll`, { min: 1, max: 8 }),
    select: stringsAt(object.select, `${path}.select`, { min: 1, max: BOUNDS.selectedSubskills, ids: true }),
  };
}

function validateDiscriminatorOption(value: unknown, path: string): DiscriminatorOption {
  const object = objectAt(value, path, ["id", "label", "description", "select"]);
  return {
    id: idAt(object.id, `${path}.id`),
    label: stringAt(object.label, `${path}.label`, 80),
    description: stringAt(object.description, `${path}.description`, 240),
    select: stringsAt(object.select, `${path}.select`, { min: 1, max: BOUNDS.selectedSubskills, ids: true }),
  };
}

function validateDiscriminator(value: unknown, path: string): Discriminator {
  const object = objectAt(value, path, ["id", "whenAny", "unlessAny", "prompt", "options"]);
  if (!Array.isArray(object.options) || object.options.length < 2 || object.options.length > 4) fail(`${path}.options`, "expected 2..4 options");
  const options = object.options.map((item, index) => validateDiscriminatorOption(item, `${path}.options[${index}]`));
  if (new Set(options.map((option) => option.id)).size !== options.length) fail(`${path}.options`, "duplicate option ids");
  return {
    id: idAt(object.id, `${path}.id`),
    whenAny: stringsAt(object.whenAny, `${path}.whenAny`, { min: 1, max: 12 }),
    unlessAny: stringsAt(object.unlessAny, `${path}.unlessAny`, { max: 12 }),
    prompt: stringAt(object.prompt, `${path}.prompt`, 240),
    options,
  };
}

export function validateSkillDocument(value: unknown, path = "skill"): SkillDocument {
  const object = objectAt(value, path, ["schemaVersion", "kind", "id", "version", "title", "description", "scope", "routes", "broadIntents", "discriminators"]);
  if (!Array.isArray(object.routes) || object.routes.length < 1 || object.routes.length > BOUNDS.routesPerParent) fail(`${path}.routes`, `expected 1..${BOUNDS.routesPerParent} routes`);
  if (!Array.isArray(object.broadIntents) || object.broadIntents.length > 8) fail(`${path}.broadIntents`, "expected at most 8 broad intents");
  if (!Array.isArray(object.discriminators) || object.discriminators.length > 8) fail(`${path}.discriminators`, "expected at most 8 discriminators");
  const routes = object.routes.map((item, index) => validateRoute(item, `${path}.routes[${index}]`));
  if (new Set(routes.map((route) => route.id)).size !== routes.length) fail(`${path}.routes`, "duplicate route ids");
  return {
    schemaVersion: literalAt(object.schemaVersion, `${path}.schemaVersion`, SCHEMA_VERSION),
    kind: literalAt(object.kind, `${path}.kind`, "skill"),
    id: idAt(object.id, `${path}.id`),
    version: integerAt(object.version, `${path}.version`, 1, 1_000_000),
    title: stringAt(object.title, `${path}.title`, 120),
    description: stringAt(object.description, `${path}.description`, 500),
    scope: stringsAt(object.scope, `${path}.scope`, { min: 1, max: 24 }),
    routes,
    broadIntents: object.broadIntents.map((item, index) => validateBroadIntent(item, `${path}.broadIntents[${index}]`)),
    discriminators: object.discriminators.map((item, index) => validateDiscriminator(item, `${path}.discriminators[${index}]`)),
  };
}

function validateMatch(value: unknown, path: string): MatchContract {
  const object = objectAt(value, path, ["specific", "shared", "negative"]);
  return {
    specific: stringsAt(object.specific, `${path}.specific`, { min: 1, max: 24 }),
    shared: stringsAt(object.shared, `${path}.shared`, { max: 16 }),
    negative: stringsAt(object.negative, `${path}.negative`, { max: 16 }),
  };
}

function validateTask(value: unknown, path: string): TaskTemplate {
  const object = objectAt(value, path, ["id", "title", "kind", "description", "dependsOn", "outputs", "acceptance"]);
  if (!TASK_KINDS.includes(object.kind as TaskKind)) fail(`${path}.kind`, "unknown task kind");
  return {
    id: idAt(object.id, `${path}.id`),
    title: stringAt(object.title, `${path}.title`, 120),
    kind: object.kind as TaskKind,
    description: stringAt(object.description, `${path}.description`, 500),
    dependsOn: stringsAt(object.dependsOn, `${path}.dependsOn`, { max: 12, ids: true }),
    outputs: stringsAt(object.outputs, `${path}.outputs`, { min: 1, max: 12 }),
    acceptance: stringsAt(object.acceptance, `${path}.acceptance`, { min: 1, max: 12 }),
  };
}

function validateAllowedPath(value: string, path: string): string {
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\") || value.split("/").includes("..")) fail(path, "unsafe allowed path");
  return value;
}

function validateDispatch(value: unknown, path: string): DispatchTemplate {
  const object = objectAt(value, path, ["role", "allowedPaths", "constraints", "deliverables", "verification", "maxFiles", "maxTurns"]);
  const allowedPaths = stringsAt(object.allowedPaths, `${path}.allowedPaths`, { min: 1, max: 24 });
  allowedPaths.forEach((item, index) => validateAllowedPath(item, `${path}.allowedPaths[${index}]`));
  return {
    role: stringAt(object.role, `${path}.role`, 100),
    allowedPaths,
    constraints: stringsAt(object.constraints, `${path}.constraints`, { min: 1, max: 16 }),
    deliverables: stringsAt(object.deliverables, `${path}.deliverables`, { min: 1, max: 16 }),
    verification: stringsAt(object.verification, `${path}.verification`, { min: 1, max: 16 }),
    maxFiles: integerAt(object.maxFiles, `${path}.maxFiles`, 1, 32),
    maxTurns: integerAt(object.maxTurns, `${path}.maxTurns`, 1, 20),
  };
}

export function validateSubskillDocument(value: unknown, path = "subskill"): SubskillDocument {
  const object = objectAt(value, path, ["schemaVersion", "kind", "id", "parentId", "version", "title", "summary", "match", "afterSkills", "tasks", "dispatch"]);
  if (!Array.isArray(object.tasks) || object.tasks.length < 1 || object.tasks.length > BOUNDS.tasksPerSubskill) fail(`${path}.tasks`, `expected 1..${BOUNDS.tasksPerSubskill} tasks`);
  const tasks = object.tasks.map((item, index) => validateTask(item, `${path}.tasks[${index}]`));
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) fail(`${path}.tasks`, "duplicate task ids");
  const taskIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!taskIds.has(dependency)) fail(`${path}.tasks.${task.id}.dependsOn`, `unknown task ${dependency}`);
      if (dependency === task.id) fail(`${path}.tasks.${task.id}.dependsOn`, "self dependency");
    }
  }
  return {
    schemaVersion: literalAt(object.schemaVersion, `${path}.schemaVersion`, SCHEMA_VERSION),
    kind: literalAt(object.kind, `${path}.kind`, "subskill"),
    id: idAt(object.id, `${path}.id`),
    parentId: idAt(object.parentId, `${path}.parentId`),
    version: integerAt(object.version, `${path}.version`, 1, 1_000_000),
    title: stringAt(object.title, `${path}.title`, 120),
    summary: stringAt(object.summary, `${path}.summary`, 500),
    match: validateMatch(object.match, `${path}.match`),
    afterSkills: stringsAt(object.afterSkills, `${path}.afterSkills`, { max: 12, ids: true }),
    tasks,
    dispatch: validateDispatch(object.dispatch, `${path}.dispatch`),
  };
}

export function validateProgressStatus(value: string): ProgressStatus {
  if (!PROGRESS_STATUSES.includes(value as ProgressStatus)) throw new Error(`Unknown progress status ${JSON.stringify(value)}`);
  return value as ProgressStatus;
}
