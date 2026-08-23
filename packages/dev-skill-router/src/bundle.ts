import type {
  DispatchPacket,
  LoadedSkill,
  LoadedSubskill,
  ParentMatchEvidence,
  PlanBundle,
  PlanStep,
  RepositorySnapshot,
  RouteState,
  TransitionRecord,
} from "./contracts.ts";
import { BOUNDS } from "./contracts.ts";
import { assertAcyclic } from "./loader.ts";
import { canonicalJson, compareText, normalizeRequest, sha256, uniqueSorted } from "./canonical.ts";

function taskId(subskillId: string, localTaskId: string): string {
  return `${subskillId}.${localTaskId}`;
}

function topologicalOrder(nodes: string[], edges: Array<{ from: string; to: string }>): string[] {
  assertAcyclic(nodes, edges);
  const incoming = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ready = nodes.filter((node) => incoming.get(node) === 0).sort(compareText);
  const order: string[] = [];
  while (ready.length > 0) {
    const node = ready.shift();
    if (!node) break;
    order.push(node);
    for (const next of (outgoing.get(node) ?? []).sort(compareText)) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1);
      if (incoming.get(next) === 0) {
        ready.push(next);
        ready.sort(compareText);
      }
    }
  }
  return order;
}

function deriveInitialState(steps: PlanStep[]): RouteState {
  const availableNext = steps.filter((step) => step.dependsOn.length === 0).map((step) => step.id).sort(compareText);
  return {
    currentNodes: [],
    availableNext,
    unlocked: availableNext,
    completed: [],
    blocked: steps.filter((step) => step.dependsOn.length > 0).map((step) => ({ todoId: step.id, blockedBy: [...step.dependsOn] })),
  };
}

export function computePlanBundleId(bundle: PlanBundle): string {
  const { bundleId: _bundleId, ...withoutId } = bundle;
  const identityPayload = {
    ...withoutId,
    dispatchPackets: bundle.dispatchPackets.map((packet) => ({
      ...packet,
      pinnedDigests: { ...packet.pinnedDigests, bundleId: "" },
    })),
  };
  return `plan-${sha256(canonicalJson(identityPayload)).slice(0, 24)}`;
}

function packetFor(
  child: LoadedSubskill,
  selectedIds: Set<string>,
  bundleId: string,
  repositorySnapshot: string,
  registryDigest: string,
): DispatchPacket {
  const packet: DispatchPacket = {
    id: `dispatch.${child.document.id}`,
    subskillId: child.document.id,
    objective: child.document.summary,
    taskIds: child.document.tasks.map((task) => taskId(child.document.id, task.id)),
    dependsOn: child.document.afterSkills.filter((id) => selectedIds.has(id)).map((id) => `dispatch.${id}`).sort(compareText),
    allowedPaths: [...child.document.dispatch.allowedPaths].sort(compareText),
    constraints: [...child.document.dispatch.constraints],
    deliverables: [...child.document.dispatch.deliverables],
    verification: [...child.document.dispatch.verification],
    bounds: { maxFiles: child.document.dispatch.maxFiles, maxTurns: child.document.dispatch.maxTurns, allowDelegation: false },
    pinnedDigests: { bundleId, repositorySnapshot, registry: registryDigest, skillSource: child.source.digest },
  };
  if (Buffer.byteLength(canonicalJson(packet), "utf8") > BOUNDS.packetBytes) throw new Error(`Dispatch packet ${packet.id} exceeds ${BOUNDS.packetBytes} bytes`);
  return packet;
}

export function buildPlanBundle(input: {
  request: string;
  parent: LoadedSkill;
  parentEvidence: ParentMatchEvidence;
  selected: LoadedSubskill[];
  reasons: Map<string, string[]>;
  repositorySnapshot: RepositorySnapshot;
  registryDigest: string;
}): PlanBundle {
  if (input.selected.length < 1 || input.selected.length > BOUNDS.selectedSubskills) throw new Error(`Expected 1..${BOUNDS.selectedSubskills} selected subskills`);
  const selectedIds = new Set(input.selected.map((child) => child.document.id));
  const rawSteps = input.selected.flatMap((child) => child.document.tasks.map((task) => ({
    id: taskId(child.document.id, task.id),
    subskillId: child.document.id,
    title: task.title,
    kind: task.kind,
    description: task.description,
    dependsOn: task.dependsOn.map((dependency) => taskId(child.document.id, dependency)),
    outputs: [...task.outputs],
    acceptance: [...task.acceptance],
  } satisfies PlanStep)));
  if (rawSteps.length > BOUNDS.totalTasks) throw new Error(`Plan exceeds ${BOUNDS.totalTasks} tasks`);

  const bySkill = new Map(input.selected.map((child) => [child.document.id, child]));
  const terminalTasks = new Map<string, string[]>();
  for (const child of input.selected) {
    const dependedOn = new Set(child.document.tasks.flatMap((task) => task.dependsOn));
    terminalTasks.set(child.document.id, child.document.tasks.filter((task) => !dependedOn.has(task.id)).map((task) => taskId(child.document.id, task.id)));
  }
  for (const step of rawSteps) {
    const child = bySkill.get(step.subskillId);
    if (!child) continue;
    const localTask = child.document.tasks.find((task) => taskId(child.document.id, task.id) === step.id);
    if (!localTask || localTask.dependsOn.length > 0) continue;
    const crossDependencies = child.document.afterSkills
      .filter((dependency) => selectedIds.has(dependency))
      .flatMap((dependency) => terminalTasks.get(dependency) ?? []);
    step.dependsOn = uniqueSorted([...step.dependsOn, ...crossDependencies]);
  }
  const edges = rawSteps.flatMap((step) => step.dependsOn.map((dependency) => ({ from: dependency, to: step.id })))
    .sort((left, right) => compareText(left.from, right.from) || compareText(left.to, right.to));
  const nodes = rawSteps.map((step) => step.id).sort(compareText);
  const order = topologicalOrder(nodes, edges);
  const stepMap = new Map(rawSteps.map((step) => [step.id, step]));
  const plan = order.map((id) => stepMap.get(id)).filter((step): step is PlanStep => step !== undefined);
  const transitionTrace: TransitionRecord[] = [
    { sequence: 0, from: "global-search", to: input.parent.document.id, status: "completed", reason: input.parentEvidence.reasons.join(", ") || "selected parent" },
    ...input.selected.map((child, index) => ({ sequence: index + 1, from: input.parent.document.id, to: child.document.id, status: "pending" as const, reason: (input.reasons.get(child.document.id) ?? []).join(", ") || "selected child" })),
  ];
  const bundleSeed: Omit<PlanBundle, "bundleId" | "dispatchPackets" | "state"> = {
    schemaVersion: "1.0",
    bundleVersion: 1,
    request: input.request.trim(),
    normalizedRequest: normalizeRequest(input.request),
    repositorySnapshot: input.repositorySnapshot,
    registryDigest: input.registryDigest,
    parentSkillIds: [input.parent.document.id],
    selectedSubskills: input.selected.map((child) => ({ id: child.document.id, parentId: child.document.parentId, title: child.document.title, status: "pending" as const, reasons: input.reasons.get(child.document.id) ?? [], source: child.source })),
    graph: { nodes, edges },
    plan,
    todos: plan.map((step) => ({ id: step.id, subskillId: step.subskillId, title: step.title, status: "pending" as const, dependsOn: [...step.dependsOn] })),
    transitionTrace,
  };
  const placeholderId = `plan-${"0".repeat(24)}`;
  if (input.selected.length > BOUNDS.dispatchPackets) throw new Error(`Plan requires ${input.selected.length} dispatch packets; maximum is ${BOUNDS.dispatchPackets}`);
  const dispatchPackets = input.selected.map((child) => packetFor(child, selectedIds, placeholderId, input.repositorySnapshot.digest, input.registryDigest));
  const state = deriveInitialState(plan);
  const draft: PlanBundle = { ...bundleSeed, bundleId: placeholderId, dispatchPackets, state };
  const bundleId = computePlanBundleId(draft);
  return {
    ...draft,
    bundleId,
    dispatchPackets: draft.dispatchPackets.map((packet) => ({ ...packet, pinnedDigests: { ...packet.pinnedDigests, bundleId } })),
  };
}
