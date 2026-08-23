import type {
  ChildMatchEvidence,
  ClarificationQuestion,
  LoadedRegistry,
  LoadedSkill,
  LoadedSubskill,
  ParentMatchEvidence,
} from "./contracts.ts";
import { canonicalJson, compareText, containsTerm, normalizeRequest, sha256, uniqueSorted } from "./canonical.ts";

interface ParentCandidate {
  skill: LoadedSkill;
  evidence: ParentMatchEvidence;
}

export interface ParentSearchResult {
  selected: LoadedSkill | null;
  selectedEvidence: ParentMatchEvidence | null;
  candidates: ParentMatchEvidence[];
  reasonCode?: "no-parent-match" | "ambiguous-parent-match";
}

export interface ChildSelectionResult {
  kind: "selected" | "question" | "none";
  selected: LoadedSubskill[];
  reasons: Map<string, string[]>;
  evidence: ChildMatchEvidence[];
  question?: Omit<ClarificationQuestion, "clarificationId" | "rerunHint">;
}

function matchedTerms(normalizedRequest: string, terms: string[]): string[] {
  return terms.filter((term) => containsTerm(normalizedRequest, term)).sort(compareText);
}

function scoreParent(skill: LoadedSkill, normalizedRequest: string): ParentCandidate {
  const scopeMatches = matchedTerms(normalizedRequest, skill.document.scope);
  const broadMatches = skill.document.broadIntents.filter((intent) => intent.whenAll.every((term) => containsTerm(normalizedRequest, term)));
  const childSpecific = skill.children.flatMap((child) => matchedTerms(normalizedRequest, child.document.match.specific).map((term) => `${child.document.id}:${term}`));
  const childShared = skill.children.flatMap((child) => matchedTerms(normalizedRequest, child.document.match.shared).map((term) => `${child.document.id}:${term}`));
  const score = scopeMatches.length * 8 + broadMatches.length * 20 + childSpecific.length * 5 + childShared.length * 2;
  const reasons = [
    ...scopeMatches.map((term) => `scope:${term}`),
    ...broadMatches.map((intent) => `broad-intent:${intent.id}`),
    ...childSpecific.map((term) => `child-specific:${term}`),
    ...childShared.map((term) => `child-shared:${term}`),
  ].sort(compareText);
  return { skill, evidence: { id: skill.document.id, title: skill.document.title, score, reasons } };
}

export function searchParent(registry: LoadedRegistry, request: string): ParentSearchResult {
  const normalized = normalizeRequest(request);
  const candidates = registry.skills.map((skill) => scoreParent(skill, normalized)).sort((left, right) => right.evidence.score - left.evidence.score || compareText(left.skill.document.id, right.skill.document.id));
  const positive = candidates.filter((candidate) => candidate.evidence.score > 0);
  if (positive.length === 0) return { selected: null, selectedEvidence: null, candidates: candidates.map((candidate) => candidate.evidence), reasonCode: "no-parent-match" };
  const first = positive[0];
  const second = positive[1];
  if (!first) return { selected: null, selectedEvidence: null, candidates: [], reasonCode: "no-parent-match" };
  if (second && first.evidence.score === second.evidence.score) {
    return { selected: null, selectedEvidence: null, candidates: candidates.map((candidate) => candidate.evidence), reasonCode: "ambiguous-parent-match" };
  }
  return { selected: first.skill, selectedEvidence: first.evidence, candidates: candidates.map((candidate) => candidate.evidence) };
}

function optionFingerprint(parentId: string, ids: string[]): string {
  return sha256(canonicalJson({ parentId, selected: uniqueSorted(ids) }));
}

function questionValue(question: Omit<ClarificationQuestion, "clarificationId" | "rerunHint">): number {
  return new Set(question.options.map((option) => option.planFingerprint)).size;
}

export function selectChildren(parent: LoadedSkill, request: string, forcedSelection?: string[]): ChildSelectionResult {
  const normalized = normalizeRequest(request);
  const reasons = new Map<string, string[]>();
  const matches = parent.children.map((child) => {
    const negative = matchedTerms(normalized, child.document.match.negative);
    const specific = negative.length === 0 ? matchedTerms(normalized, child.document.match.specific) : [];
    const shared = negative.length === 0 ? matchedTerms(normalized, child.document.match.shared) : [];
    const childReasons = [
      ...specific.map((term) => `specific:${term}`),
      ...shared.map((term) => `shared:${term}`),
      ...negative.map((term) => `negative:${term}`),
    ].sort(compareText);
    reasons.set(child.document.id, childReasons);
    return { child, negative, specific, shared, score: specific.length * 6 + shared.length * 2 };
  });

  const broad = parent.document.broadIntents
    .filter((intent) => intent.whenAll.every((term) => containsTerm(normalized, term)))
    .sort((left, right) => compareText(left.id, right.id));
  const broadIds = uniqueSorted(broad.flatMap((intent) => intent.select));
  for (const id of broadIds) reasons.set(id, uniqueSorted([...(reasons.get(id) ?? []), ...broad.map((intent) => `broad-intent:${intent.id}`)]));

  const explicitIds = matches.filter((match) => match.specific.length > 0).map((match) => match.child.document.id);
  const stableIds = uniqueSorted([...broadIds, ...explicitIds]);
  const activeDiscriminators = broadIds.length > 0 ? [] : parent.document.discriminators
    .filter((item) => item.whenAny.some((term) => containsTerm(normalized, term)) && !item.unlessAny.some((term) => containsTerm(normalized, term)))
    .map((item) => {
      const options = item.options.map((option) => {
        const selectedSubskillIds = uniqueSorted([...stableIds, ...option.select]);
        return {
          id: option.id,
          label: option.label,
          description: option.description,
          selectedSubskillIds,
          planFingerprint: optionFingerprint(parent.document.id, selectedSubskillIds),
        };
      });
      return { id: item.id, prompt: item.prompt, options };
    })
    .filter((item) => new Set(item.options.map((option) => option.planFingerprint)).size >= 2)
    .sort((left, right) => questionValue(right) - questionValue(left) || compareText(left.id, right.id));

  let selectedIds: string[];
  if (forcedSelection) {
    selectedIds = uniqueSorted([...stableIds, ...forcedSelection]);
    for (const id of forcedSelection) reasons.set(id, uniqueSorted([...(reasons.get(id) ?? []), "clarification-answer"]));
  } else if (activeDiscriminators[0]) {
    const selected = activeDiscriminators[0];
    const evidence = matches.map((match) => ({
      id: match.child.document.id,
      score: match.score,
      reasons: reasons.get(match.child.document.id) ?? [],
      selected: stableIds.includes(match.child.document.id),
      ...((match.negative.length > 0) ? { rejectedReason: "negative-signal" } : {}),
    })).sort((left, right) => compareText(left.id, right.id));
    return { kind: "question", selected: parent.children.filter((child) => stableIds.includes(child.document.id)), reasons, evidence, question: selected };
  } else {
    const sharedIds = matches.filter((match) => match.specific.length === 0 && match.shared.length > 0).map((match) => match.child.document.id);
    selectedIds = uniqueSorted([...stableIds, ...sharedIds]);
  }

  const selected = parent.children.filter((child) => selectedIds.includes(child.document.id)).sort((left, right) => compareText(left.document.id, right.document.id));
  const evidence = matches.map((match) => ({
    id: match.child.document.id,
    score: match.score,
    reasons: reasons.get(match.child.document.id) ?? [],
    selected: selectedIds.includes(match.child.document.id),
    ...((match.negative.length > 0) ? { rejectedReason: "negative-signal" } : (match.score === 0 && !selectedIds.includes(match.child.document.id)) ? { rejectedReason: "no-signal" } : {}),
  })).sort((left, right) => compareText(left.id, right.id));
  return { kind: selected.length > 0 ? "selected" : "none", selected, reasons, evidence };
}
