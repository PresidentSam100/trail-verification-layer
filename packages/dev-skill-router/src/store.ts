import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  BOUNDS,
  SCHEMA_VERSION,
  type DerivedBundleStatus,
  type PlanBundle,
  type ProgressEvent,
  type ProgressStatus,
  type RouteState,
  type TransitionRecord,
  validateProgressStatus,
} from "./contracts.ts";
import { canonicalJson, compareText, sha256, uniqueSorted } from "./canonical.ts";
import { computePlanBundleId } from "./bundle.ts";

const BUNDLE_ID = /^plan-[a-f0-9]{24}$/;
const CLARIFICATION_ID = /^clarify-[a-f0-9]{24}$/;

export function routeStoreRoot(projectRoot: string): string {
  return resolve(projectRoot, ".trail", "dev-routes");
}

function assertIdentifier(value: string, kind: "bundle" | "clarification"): string {
  const pattern = kind === "bundle" ? BUNDLE_ID : CLARIFICATION_ID;
  if (!pattern.test(value)) throw new Error(`Invalid ${kind} id ${JSON.stringify(value)}`);
  return value;
}

function atomicWrite(path: string, text: string, replace = false): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const descriptor = openSync(temporary, "wx");
  try {
    writeFileSync(descriptor, text, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  if (!replace && existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    unlinkSync(temporary);
    if (existing !== text) throw new Error(`Immutable artifact collision at ${path}`);
    return;
  }
  renameSync(temporary, path);
}

function minimallyValidateBundle(value: unknown, path: string): PlanBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path}: expected PlanBundle object`);
  const bundle = value as Partial<PlanBundle>;
  if (bundle.schemaVersion !== SCHEMA_VERSION || bundle.bundleVersion !== 1 || typeof bundle.bundleId !== "string" || !BUNDLE_ID.test(bundle.bundleId)) throw new Error(`${path}: invalid PlanBundle identity`);
  if (!Array.isArray(bundle.plan) || !Array.isArray(bundle.todos) || !Array.isArray(bundle.dispatchPackets) || !Array.isArray(bundle.selectedSubskills)) throw new Error(`${path}: incomplete PlanBundle`);
  if (bundle.plan.length !== bundle.todos.length || bundle.plan.length > BOUNDS.totalTasks) throw new Error(`${path}: invalid task count`);
  const todoIds = new Set(bundle.todos.map((todo) => todo.id));
  if (todoIds.size !== bundle.todos.length) throw new Error(`${path}: duplicate todo ids`);
  for (const todo of bundle.todos) for (const dependency of todo.dependsOn) if (!todoIds.has(dependency)) throw new Error(`${path}: unknown todo dependency ${dependency}`);
  const parsed = bundle as PlanBundle;
  const expectedId = computePlanBundleId(parsed);
  if (expectedId !== parsed.bundleId) throw new Error(`${path}: PlanBundle content identity mismatch`);
  if (parsed.dispatchPackets.some((packet) => packet.pinnedDigests.bundleId !== parsed.bundleId)) throw new Error(`${path}: dispatch packet bundle pin mismatch`);
  return parsed;
}

export function writeBundle(projectRoot: string, bundle: PlanBundle): string {
  assertIdentifier(bundle.bundleId, "bundle");
  const root = routeStoreRoot(projectRoot);
  const path = resolve(root, "bundles", `${bundle.bundleId}.json`);
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  atomicWrite(path, text);
  atomicWrite(resolve(root, "active.json"), `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, bundleId: bundle.bundleId }, null, 2)}\n`, true);
  return path;
}

export function readBundle(projectRoot: string, bundleId?: string): { bundle: PlanBundle; path: string } {
  let id = bundleId;
  const root = routeStoreRoot(projectRoot);
  if (!id) {
    const pointerPath = resolve(root, "active.json");
    if (!existsSync(pointerPath)) throw new Error("No active development PlanBundle");
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { schemaVersion?: unknown; bundleId?: unknown };
    if (pointer.schemaVersion !== SCHEMA_VERSION || typeof pointer.bundleId !== "string") throw new Error("Invalid active PlanBundle pointer");
    id = pointer.bundleId;
  }
  assertIdentifier(id, "bundle");
  const path = resolve(root, "bundles", `${id}.json`);
  return { bundle: minimallyValidateBundle(JSON.parse(readFileSync(path, "utf8")) as unknown, path), path };
}

export interface ClarificationSession {
  schemaVersion: "1.0";
  clarificationId: string;
  request: string;
  normalizedRequest: string;
  parentSkillId: string;
  registryDigest: string;
  snapshotDigest: string;
  stableSubskillIds: string[];
  question: { id: string; prompt: string; options: Array<{ id: string; label: string; description: string; selectedSubskillIds: string[]; planFingerprint: string }> };
}

export function computeClarificationId(session: Omit<ClarificationSession, "clarificationId">): string {
  return `clarify-${sha256(canonicalJson(session)).slice(0, 24)}`;
}

export function writeClarification(projectRoot: string, session: ClarificationSession): string {
  assertIdentifier(session.clarificationId, "clarification");
  const { clarificationId: _clarificationId, ...identity } = session;
  if (computeClarificationId(identity) !== session.clarificationId) throw new Error("Clarification content identity mismatch");
  const path = resolve(routeStoreRoot(projectRoot), "clarifications", `${session.clarificationId}.json`);
  atomicWrite(path, `${JSON.stringify(session, null, 2)}\n`);
  return path;
}

export function readClarification(projectRoot: string, clarificationId: string): ClarificationSession {
  assertIdentifier(clarificationId, "clarification");
  const path = resolve(routeStoreRoot(projectRoot), "clarifications", `${clarificationId}.json`);
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<ClarificationSession>;
  if (value.schemaVersion !== SCHEMA_VERSION || value.clarificationId !== clarificationId || typeof value.request !== "string" || typeof value.normalizedRequest !== "string" || typeof value.parentSkillId !== "string" || typeof value.registryDigest !== "string" || typeof value.snapshotDigest !== "string" || !Array.isArray(value.stableSubskillIds) || value.stableSubskillIds.some((id) => typeof id !== "string") || typeof value.question !== "object" || value.question === null || typeof value.question.id !== "string" || typeof value.question.prompt !== "string" || !Array.isArray(value.question.options)) throw new Error(`Invalid clarification session ${clarificationId}`);
  const session = value as ClarificationSession;
  for (const option of session.question.options) {
    if (typeof option.id !== "string" || typeof option.label !== "string" || typeof option.description !== "string" || !Array.isArray(option.selectedSubskillIds) || option.selectedSubskillIds.some((id) => typeof id !== "string") || !/^[a-f0-9]{64}$/.test(option.planFingerprint)) throw new Error(`Invalid clarification option in ${clarificationId}`);
    if (session.stableSubskillIds.some((id) => !option.selectedSubskillIds.includes(id))) throw new Error(`Clarification option drops stable selection in ${clarificationId}`);
    const expectedFingerprint = sha256(canonicalJson({ parentId: session.parentSkillId, selected: uniqueSorted(option.selectedSubskillIds) }));
    if (expectedFingerprint !== option.planFingerprint) throw new Error(`Clarification option fingerprint mismatch in ${clarificationId}`);
  }
  const { clarificationId: _clarificationId, ...identity } = session;
  if (computeClarificationId(identity) !== clarificationId) throw new Error(`Clarification content identity mismatch for ${clarificationId}`);
  return session;
}

function eventPath(projectRoot: string, bundleId: string): string {
  return resolve(routeStoreRoot(projectRoot), "events", `${assertIdentifier(bundleId, "bundle")}.jsonl`);
}

function readEvents(projectRoot: string, bundleId: string): ProgressEvent[] {
  const path = eventPath(projectRoot, bundleId);
  if (!existsSync(path)) return [];
  if (statSync(path).size > BOUNDS.progressEvents * BOUNDS.progressEventBytes) throw new Error(`Progress log exceeds bounded size for ${bundleId}`);
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length > BOUNDS.progressEvents) throw new Error(`Progress log exceeds ${BOUNDS.progressEvents} events`);
  return lines.map((line, index) => {
    const value = JSON.parse(line) as Partial<ProgressEvent>;
    if (value.schemaVersion !== SCHEMA_VERSION || value.bundleId !== bundleId || value.sequence !== index + 1 || typeof value.todoId !== "string" || typeof value.status !== "string") throw new Error(`Invalid progress event ${index + 1}`);
    validateProgressStatus(value.status);
    if (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 500)) throw new Error(`Invalid progress reason ${index + 1}`);
    return value as ProgressEvent;
  });
}

function derived(projectRoot: string, bundleId?: string): DerivedBundleStatus {
  const { bundle, path } = readBundle(projectRoot, bundleId);
  const events = readEvents(projectRoot, bundle.bundleId);
  const statusByTodo = new Map(bundle.todos.map((todo) => [todo.id, todo.status]));
  const reasonByTodo = new Map<string, string>();
  const transitions: TransitionRecord[] = [...bundle.transitionTrace];
  for (const event of events) {
    const previous = statusByTodo.get(event.todoId);
    if (!previous) throw new Error(`Progress event references unknown todo ${event.todoId}`);
    statusByTodo.set(event.todoId, event.status);
    if (event.reason) reasonByTodo.set(event.todoId, event.reason);
    transitions.push({ sequence: transitions.length, from: `${event.todoId}:${previous}`, to: `${event.todoId}:${event.status}`, status: event.status, reason: event.reason ?? "progress event" });
  }
  const todos = bundle.todos.map((todo) => {
    const status = statusByTodo.get(todo.id) ?? "pending";
    const blockedBy = todo.dependsOn.filter((dependency) => statusByTodo.get(dependency) !== "completed");
    const reason = reasonByTodo.get(todo.id);
    return { ...todo, status, blockedBy, ...(reason ? { reason } : {}) };
  });
  const completed = todos.filter((todo) => todo.status === "completed").map((todo) => todo.id).sort(compareText);
  const currentNodes = todos.filter((todo) => todo.status === "running").map((todo) => todo.id).sort(compareText);
  const availableNext = todos.filter((todo) => todo.status === "pending" && todo.blockedBy.length === 0).map((todo) => todo.id).sort(compareText);
  const blocked = todos.filter((todo) => todo.status === "blocked" || todo.blockedBy.length > 0).map((todo) => ({ todoId: todo.id, blockedBy: todo.blockedBy, ...(todo.reason ? { reason: todo.reason } : {}) }));
  const state: RouteState = { currentNodes, availableNext, unlocked: availableNext, completed, blocked };
  const selectedSubskills = bundle.selectedSubskills.map((subskill) => {
    const childTodos = todos.filter((todo) => todo.subskillId === subskill.id);
    let status: ProgressStatus = "pending";
    if (childTodos.length > 0 && childTodos.every((todo) => todo.status === "completed")) status = "completed";
    else if (childTodos.some((todo) => todo.status === "running")) status = "running";
    else if (childTodos.some((todo) => todo.status === "blocked")) status = "blocked";
    return { id: subskill.id, title: subskill.title, status, todoIds: childTodos.map((todo) => todo.id) };
  });
  return { bundleId: bundle.bundleId, bundlePath: path, selectedSubskills, todos, state, transitionTrace: transitions, eventCount: events.length };
}

export function getBundleStatus(projectRoot: string, bundleId?: string): DerivedBundleStatus {
  return derived(projectRoot, bundleId);
}

export function appendProgressEvent(projectRoot: string, bundleId: string, todoId: string, status: ProgressStatus, reason?: string): DerivedBundleStatus {
  validateProgressStatus(status);
  const current = derived(projectRoot, bundleId);
  const todo = current.todos.find((item) => item.id === todoId);
  if (!todo) throw new Error(`Unknown todo ${todoId}`);
  if (todo.status === "completed" && status !== "completed") throw new Error(`Completed todo ${todoId} cannot be reopened`);
  if ((status === "running" || status === "completed") && todo.blockedBy.length > 0) throw new Error(`Todo ${todoId} is blocked by ${todo.blockedBy.join(", ")}`);
  if (reason !== undefined && (reason.trim().length === 0 || reason.length > 500)) throw new Error("Progress reason must be 1..500 characters");
  const sequence = current.eventCount + 1;
  if (sequence > BOUNDS.progressEvents) throw new Error(`Progress log exceeds ${BOUNDS.progressEvents} events`);
  const event: ProgressEvent = { schemaVersion: SCHEMA_VERSION, sequence, bundleId, todoId, status, ...(reason ? { reason: reason.trim() } : {}) };
  const line = `${canonicalJson(event)}\n`;
  if (Buffer.byteLength(line, "utf8") > BOUNDS.progressEventBytes) throw new Error("Progress event exceeds byte bound");
  const path = eventPath(projectRoot, bundleId);
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "a");
  try {
    writeSync(descriptor, line, undefined, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return derived(projectRoot, bundleId);
}
