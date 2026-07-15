import type {
  Belief,
  EntityRef,
  LifeThread,
  MemoryEvent,
  MemorySpace,
  ProspectiveMemory,
} from "./contracts";
import type { ClaimEvidence } from "./event-ledger";

export type LifeGraphLens = "current" | "history" | "all";
export type LifeGraphNodeKind =
  | EntityRef["kind"]
  | "thread"
  | "memory"
  | "prospective"
  | "semantic";

export type LifeGraphFact = {
  key: string;
  predicate: string;
  value: string;
  status: Belief["status"];
  confidence: Belief["confidence"];
  validFrom: string;
  validTo: string | null;
  evidenceCount: number;
};

export type LifeGraphEvidence = {
  id: string;
  content: string;
  kind: MemoryEvent["kind"];
  recordedAt: string;
  source: string;
  trust: MemoryEvent["source"]["trust"];
  sensitivity: MemoryEvent["sensitivity"];
};

export type LifeGraphThreadDetail = {
  id: string;
  title: string;
  kind: LifeThread["kind"];
  status: LifeThread["status"];
  state: string;
  expectedNext: string | null;
  changedAt: string;
};

export type LifeGraphNode = {
  id: string;
  kind: LifeGraphNodeKind;
  label: string;
  eyebrow: string;
  summary: string;
  status: string;
  confidence: Belief["confidence"] | null;
  importance: number;
  evidenceCount: number;
  detail: {
    facts: LifeGraphFact[];
    threads: LifeGraphThreadDetail[];
    evidence: LifeGraphEvidence[];
    note: string | null;
  };
};

export type LifeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: "belief" | "thread" | "evidence" | "prospective" | "semantic";
  label: string;
  authority: "canonical" | "semantic";
  status: "current" | "historical" | "conflicting" | "suggested";
  confidence: Belief["confidence"] | null;
  evidenceCount: number;
  weight: number;
};

export type SemanticMemorySuggestion = {
  id: string;
  memory: string;
  similarity: number;
  updatedAt: string;
  relation?: "result" | "extends" | "derives" | "updates";
  parentId?: string;
};

export type LifeGraph = {
  version: 1;
  space: MemorySpace;
  lens: LifeGraphLens;
  focus: { id: string; label: string; kind: LifeGraphNodeKind } | null;
  title: string;
  subtitle: string;
  nodes: LifeGraphNode[];
  edges: LifeGraphEdge[];
  suggestions: Array<{ id: string; label: string; kind: LifeGraphNodeKind; reason: string }>;
  summary: {
    canonicalNodes: number;
    semanticNodes: number;
    activeThreads: number;
    evidenceEvents: number;
    totalEntities: number;
  };
  generatedAt: string;
};

type Inputs = {
  userId: string;
  space: MemorySpace;
  name?: string;
  focus?: string | null;
  lens?: LifeGraphLens;
  beliefs: Belief[];
  threads: LifeThread[];
  events: MemoryEvent[];
  claimEvidence: ClaimEvidence[];
  prospective: ProspectiveMemory[];
  semantic?: SemanticMemorySuggestion[];
  now?: string;
  limit?: number;
};

const ACTIVE_THREAD = new Set<LifeThread["status"]>(["emerging", "open", "waiting", "blocked"]);
const CONFIDENCE_RANK: Record<Belief["confidence"], number> = {
  direct: 4,
  strong: 3,
  tentative: 2,
  conflicting: 1,
};

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function eventContent(event: MemoryEvent) {
  const content = event.payload.content.trim();
  return content.length > 360 ? `${content.slice(0, 357)}…` : content;
}

function typedValue(value: Belief["value"]) {
  if (value.type === "entity") return value.value.label;
  if (value.type === "boolean") return value.value ? "yes" : "no";
  return String(value.value);
}

function predicateLabel(predicate: string) {
  return predicate.replaceAll(".", " ").replaceAll("_", " ");
}

function nodeIdForEntity(entity: EntityRef) {
  return `entity:${entity.id}`;
}

function threadNodeId(id: string) {
  return `thread:${id}`;
}

function eventNodeId(id: string) {
  return `event:${id}`;
}

function prospectiveNodeId(id: string) {
  return `prospective:${id}`;
}

function evidenceForBelief(
  belief: Belief,
  claimToEvent: Map<string, string>,
  eventById: Map<string, MemoryEvent>,
) {
  return [...belief.support, ...belief.opposition]
    .map((claimId) => claimToEvent.get(claimId))
    .filter((id): id is string => Boolean(id))
    .map((id) => eventById.get(id))
    .filter((event): event is MemoryEvent => Boolean(event));
}

function toEvidence(event: MemoryEvent): LifeGraphEvidence {
  return {
    id: event.id,
    content: eventContent(event),
    kind: event.kind,
    recordedAt: event.recordedAt,
    source: event.source.label,
    trust: event.source.trust,
    sensitivity: event.sensitivity,
  };
}

function toThreadDetail(thread: LifeThread): LifeGraphThreadDetail {
  return {
    id: thread.id,
    title: thread.title,
    kind: thread.kind,
    status: thread.status,
    state: thread.currentState.text,
    expectedNext: thread.expectedNext?.event ?? null,
    changedAt: thread.lastMeaningfulChangeAt,
  };
}

function lensAllows(lens: LifeGraphLens, belief: Belief) {
  if (lens === "all") return true;
  if (lens === "history") return belief.status !== "current";
  return belief.status === "current" || belief.status === "conflicting";
}

function uniqueBy<T>(items: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function buildLifeGraph(input: Inputs): LifeGraph {
  const lens = input.lens ?? "current";
  const now = input.now ?? new Date().toISOString();
  const limit = Math.max(20, Math.min(64, input.limit ?? 48));
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const claimToEvent = new Map(
    input.claimEvidence.map((evidence) => [evidence.claim.id, evidence.claim.eventId]),
  );

  const entities = new Map<string, EntityRef>();
  const beliefsByEntity = new Map<string, Belief[]>();
  const threadsByEntity = new Map<string, LifeThread[]>();
  const evidenceIdsByEntity = new Map<string, Set<string>>();

  const rememberEntity = (entity: EntityRef) => {
    if (entity.kind === "user" || entity.id === `user:${input.userId}` || entity.id === "user:local") {
      entities.set(entity.id, { ...entity, kind: "user", label: input.name ?? "You" });
      return;
    }
    const existing = entities.get(entity.id);
    if (!existing || existing.label.length < entity.label.length) entities.set(entity.id, entity);
  };
  const addEvidence = (entityId: string, eventId: string) => {
    const ids = evidenceIdsByEntity.get(entityId) ?? new Set<string>();
    ids.add(eventId);
    evidenceIdsByEntity.set(entityId, ids);
  };

  for (const belief of input.beliefs) {
    rememberEntity(belief.subject);
    if (belief.value.type === "entity") rememberEntity(belief.value.value);
    const list = beliefsByEntity.get(belief.subject.id) ?? [];
    list.push(belief);
    beliefsByEntity.set(belief.subject.id, list);
    for (const event of evidenceForBelief(belief, claimToEvent, eventById)) {
      addEvidence(belief.subject.id, event.id);
      if (belief.value.type === "entity") addEvidence(belief.value.value.id, event.id);
    }
  }
  for (const thread of input.threads) {
    for (const participant of thread.participants) {
      rememberEntity(participant);
      const list = threadsByEntity.get(participant.id) ?? [];
      list.push(thread);
      threadsByEntity.set(participant.id, list);
      for (const eventId of thread.evidenceEventIds) addEvidence(participant.id, eventId);
    }
  }

  const candidates: Array<{
    id: string;
    label: string;
    kind: LifeGraphNodeKind;
    entity?: EntityRef;
    thread?: LifeThread;
  }> = [
    ...[...entities.values()].map((entity) => ({
      id: nodeIdForEntity(entity),
      label: entity.label,
      kind: entity.kind,
      entity,
    })),
    ...input.threads.map((thread) => ({
      id: threadNodeId(thread.id),
      label: thread.title,
      kind: "thread" as const,
      thread,
    })),
  ];
  const focusQuery = normalized(input.focus ?? "");
  const scoreCandidate = (candidate: (typeof candidates)[number]) => {
    if (!focusQuery) return 0;
    const id = normalized(candidate.id);
    const label = normalized(candidate.label);
    if (id === focusQuery) return 100;
    if (label === focusQuery) return 95;
    if (label.startsWith(focusQuery)) return 80;
    if (label.includes(focusQuery)) return 65;
    const tokens = focusQuery.split(" ");
    return tokens.every((token) => label.includes(token)) ? 50 + tokens.length : 0;
  };
  const resolved = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.label.localeCompare(b.candidate.label))[0]
    ?.candidate;

  const nodes = new Map<string, LifeGraphNode>();
  const edges = new Map<string, LifeGraphEdge>();
  const selectedEntityIds = new Set<string>();
  const selectedThreadIds = new Set<string>();
  const selectedEventIds = new Set<string>();

  const factsForEntity = (entityId: string) =>
    (beliefsByEntity.get(entityId) ?? [])
      .filter((belief) => lensAllows(lens, belief))
      .sort(
        (a, b) =>
          (a.status === "current" ? -1 : 1) - (b.status === "current" ? -1 : 1) ||
          CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
          a.predicate.localeCompare(b.predicate),
      )
      .slice(0, 12)
      .map((belief) => ({
        key: belief.key,
        predicate: predicateLabel(belief.predicate),
        value: typedValue(belief.value),
        status: belief.status,
        confidence: belief.confidence,
        validFrom: belief.validTime.start,
        validTo: belief.validTime.end,
        evidenceCount: belief.support.length + belief.opposition.length,
      }));

  const addEntity = (entity: EntityRef, importance = 1) => {
    selectedEntityIds.add(entity.id);
    const beliefs = beliefsByEntity.get(entity.id) ?? [];
    const relatedThreads = (threadsByEntity.get(entity.id) ?? []).filter((thread) =>
      lens === "history" ? !ACTIVE_THREAD.has(thread.status) : true,
    );
    const evidence = [...(evidenceIdsByEntity.get(entity.id) ?? [])]
      .map((id) => eventById.get(id))
      .filter((event): event is MemoryEvent => Boolean(event))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const confidence = beliefs
      .slice()
      .sort((a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence])[0]
      ?.confidence ?? null;
    const activeCount = relatedThreads.filter((thread) => ACTIVE_THREAD.has(thread.status)).length;
    const currentCount = beliefs.filter((belief) => belief.status === "current").length;
    const conflictCount = beliefs.filter((belief) => belief.status === "conflicting").length;
    const summary = activeCount
      ? `${activeCount} active ${activeCount === 1 ? "thread" : "threads"} · ${currentCount} current facts`
      : `${currentCount} current facts · ${evidence.length} evidence events`;
    nodes.set(nodeIdForEntity(entity), {
      id: nodeIdForEntity(entity),
      kind: entity.kind,
      label: entity.kind === "user" && input.name ? input.name : entity.label,
      eyebrow: entity.kind,
      summary,
      status: conflictCount ? "conflicting" : activeCount ? "active" : "remembered",
      confidence,
      importance: Math.max(1, importance),
      evidenceCount: evidence.length,
      detail: {
        facts: factsForEntity(entity.id),
        threads: relatedThreads.slice(0, 10).map(toThreadDetail),
        evidence: evidence.slice(0, 8).map(toEvidence),
        note: null,
      },
    });
  };

  const addThread = (thread: LifeThread, importance = 1) => {
    selectedThreadIds.add(thread.id);
    const evidence = thread.evidenceEventIds
      .map((id) => eventById.get(id))
      .filter((event): event is MemoryEvent => Boolean(event))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    nodes.set(threadNodeId(thread.id), {
      id: threadNodeId(thread.id),
      kind: "thread",
      label: thread.title,
      eyebrow: `${thread.kind} thread`,
      summary: thread.currentState.text,
      status: thread.status,
      confidence: thread.confidence,
      importance: Math.max(1, importance),
      evidenceCount: evidence.length,
      detail: {
        facts: [],
        threads: [toThreadDetail(thread)],
        evidence: evidence.slice(0, 8).map(toEvidence),
        note: thread.expectedNext ? `Expected next: ${thread.expectedNext.event}` : null,
      },
    });
  };

  const addEvent = (event: MemoryEvent, importance = 1) => {
    selectedEventIds.add(event.id);
    nodes.set(eventNodeId(event.id), {
      id: eventNodeId(event.id),
      kind: "memory",
      label: eventContent(event),
      eyebrow: `${event.kind} · ${event.source.trust.replaceAll("_", " ")}`,
      summary: `Recorded ${event.recordedAt}`,
      status: event.revisionOf ? "revision" : "evidence",
      confidence: null,
      importance: Math.max(1, importance),
      evidenceCount: 1,
      detail: { facts: [], threads: [], evidence: [toEvidence(event)], note: null },
    });
  };

  const self = entities.get(`user:${input.userId}`) ?? entities.get("user:local") ?? {
    id: `user:${input.userId}`,
    kind: "user" as const,
    label: input.name ?? "You",
  };
  rememberEntity(self);

  if (resolved?.entity) {
    const focusEntity = resolved.entity;
    addEntity(focusEntity, 10);
    const relatedThreads = (threadsByEntity.get(focusEntity.id) ?? [])
      .slice()
      .sort(
        (a, b) =>
          Number(ACTIVE_THREAD.has(b.status)) - Number(ACTIVE_THREAD.has(a.status)) ||
          b.lastMeaningfulChangeAt.localeCompare(a.lastMeaningfulChangeAt),
      )
      .slice(0, 10);
    for (const thread of relatedThreads) {
      addThread(thread, ACTIVE_THREAD.has(thread.status) ? 6 : 2);
      for (const participant of thread.participants.slice(0, 8)) addEntity(participant, 3);
    }

    for (const belief of input.beliefs) {
      if (!lensAllows(lens, belief) || belief.value.type !== "entity") continue;
      if (belief.subject.id === focusEntity.id || belief.value.value.id === focusEntity.id) {
        addEntity(belief.subject, 4);
        addEntity(belief.value.value, 4);
      }
    }
    const focusEvents = [...(evidenceIdsByEntity.get(focusEntity.id) ?? [])]
      .map((id) => eventById.get(id))
      .filter((event): event is MemoryEvent => Boolean(event))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, 8);
    for (const event of focusEvents) addEvent(event, 2);
  } else if (resolved?.thread) {
    addThread(resolved.thread, 10);
    for (const participant of resolved.thread.participants) addEntity(participant, 5);
    for (const id of resolved.thread.evidenceEventIds.slice(-8).reverse()) {
      const event = eventById.get(id);
      if (event) addEvent(event, 2);
    }
  } else {
    addEntity(self, 12);
    const ranked = [...entities.values()]
      .filter((entity) => entity.id !== self.id)
      .map((entity) => {
        const beliefs = beliefsByEntity.get(entity.id) ?? [];
        const relatedThreads = threadsByEntity.get(entity.id) ?? [];
        const evidenceCount = evidenceIdsByEntity.get(entity.id)?.size ?? 0;
        const importance =
          beliefs.filter((belief) => belief.status === "current").length * 1.4 +
          beliefs.filter((belief) => belief.status === "conflicting").length * 2.5 +
          relatedThreads.filter((thread) => ACTIVE_THREAD.has(thread.status)).length * 5 +
          Math.min(5, evidenceCount * 0.35);
        return { entity, importance };
      })
      .filter(({ importance }) => importance > 0)
      .sort((a, b) => b.importance - a.importance || a.entity.label.localeCompare(b.entity.label))
      .slice(0, 18);
    for (const { entity, importance } of ranked) addEntity(entity, importance);
    const overviewThreads = input.threads
      .filter((thread) => ACTIVE_THREAD.has(thread.status))
      .filter((thread) => thread.participants.some((participant) => selectedEntityIds.has(participant.id)))
      .slice(0, 8);
    for (const thread of overviewThreads) addThread(thread, 5);
  }

  for (const belief of input.beliefs) {
    if (!lensAllows(lens, belief) || belief.value.type !== "entity") continue;
    if (!selectedEntityIds.has(belief.subject.id) || !selectedEntityIds.has(belief.value.value.id)) continue;
    const source = nodeIdForEntity(belief.subject);
    const target = nodeIdForEntity(belief.value.value);
    const id = `belief:${belief.key}`;
    edges.set(id, {
      id,
      source,
      target,
      kind: "belief",
      label: predicateLabel(belief.predicate),
      authority: "canonical",
      status:
        belief.status === "historical" || belief.status === "unknown"
          ? "historical"
          : belief.status,
      confidence: belief.confidence,
      evidenceCount: belief.support.length + belief.opposition.length,
      weight: 3,
    });
  }

  for (const thread of input.threads) {
    if (!selectedThreadIds.has(thread.id)) continue;
    for (const participant of thread.participants) {
      if (!selectedEntityIds.has(participant.id)) continue;
      const id = `thread:${thread.id}:${participant.id}`;
      edges.set(id, {
        id,
        source: nodeIdForEntity(participant),
        target: threadNodeId(thread.id),
        kind: "thread",
        label: thread.status,
        authority: "canonical",
        status: ACTIVE_THREAD.has(thread.status) ? "current" : "historical",
        confidence: thread.confidence,
        evidenceCount: thread.evidenceEventIds.length,
        weight: ACTIVE_THREAD.has(thread.status) ? 4 : 2,
      });
    }
  }

  for (const eventId of selectedEventIds) {
    const evidence = input.claimEvidence.filter((item) => item.claim.eventId === eventId);
    const linkedEntities = uniqueBy(
      evidence.flatMap((item) => [
        item.claim.subject,
        ...(item.claim.object.type === "entity" ? [item.claim.object.value] : []),
      ]),
      (entity) => entity.id,
    ).filter((entity) => selectedEntityIds.has(entity.id));
    for (const entity of linkedEntities) {
      const id = `evidence:${eventId}:${entity.id}`;
      edges.set(id, {
        id,
        source: eventNodeId(eventId),
        target: nodeIdForEntity(entity),
        kind: "evidence",
        label: "evidence for",
        authority: "canonical",
        status: "current",
        confidence: null,
        evidenceCount: 1,
        weight: 2,
      });
    }
    for (const thread of input.threads.filter(
      (item) => selectedThreadIds.has(item.id) && item.evidenceEventIds.includes(eventId),
    )) {
      const id = `thread-evidence:${eventId}:${thread.id}`;
      edges.set(id, {
        id,
        source: eventNodeId(eventId),
        target: threadNodeId(thread.id),
        kind: "evidence",
        label: "moves",
        authority: "canonical",
        status: "current",
        confidence: null,
        evidenceCount: 1,
        weight: 2,
      });
    }
  }

  for (const trigger of input.prospective.filter((item) => item.status === "open").slice(0, 8)) {
    const topic = normalized(trigger.topic);
    const matched = [...entities.values()]
      .filter((entity) => selectedEntityIds.has(entity.id))
      .sort((a, b) => {
        const an = normalized(a.label);
        const bn = normalized(b.label);
        return Number(bn === topic || bn.includes(topic)) - Number(an === topic || an.includes(topic));
      })[0];
    if (!matched || !(normalized(matched.label).includes(topic) || topic.includes(normalized(matched.label)))) {
      continue;
    }
    const id = prospectiveNodeId(trigger.id);
    const evidence = trigger.evidenceEventIds
      .map((eventId) => eventById.get(eventId))
      .filter((event): event is MemoryEvent => Boolean(event));
    nodes.set(id, {
      id,
      kind: "prospective",
      label: trigger.action,
      eyebrow: `next time ${trigger.topic} comes up`,
      summary: trigger.snoozedUntil ? `Quiet until ${trigger.snoozedUntil}` : "Ready to notice",
      status: trigger.snoozedUntil ? "snoozed" : "open",
      confidence: "direct",
      importance: 5,
      evidenceCount: evidence.length,
      detail: {
        facts: [],
        threads: [],
        evidence: evidence.map(toEvidence),
        note: "This is prospective memory: it waits for context, not a calendar date.",
      },
    });
    edges.set(`prospective:${trigger.id}:${matched.id}`, {
      id: `prospective:${trigger.id}:${matched.id}`,
      source: nodeIdForEntity(matched),
      target: id,
      kind: "prospective",
      label: "next time",
      authority: "canonical",
      status: "current",
      confidence: "direct",
      evidenceCount: evidence.length,
      weight: 4,
    });
  }

  const semantic = (input.semantic ?? []).slice(0, 8);
  for (const suggestion of semantic) {
    const id = `semantic:${suggestion.id}`;
    nodes.set(id, {
      id,
      kind: "semantic",
      label: suggestion.memory,
      eyebrow: "Supermemory neighbor",
      summary: `${Math.round(suggestion.similarity * 100)}% semantic match`,
      status: "suggested",
      confidence: null,
      importance: 1 + suggestion.similarity * 3,
      evidenceCount: 0,
      detail: {
        facts: [],
        threads: [],
        evidence: [],
        note:
          "Discovered by Supermemory's semantic graph. Useful for navigation, but not treated as canonical truth until grounded in Recall's evidence ledger.",
      },
    });
    const parent = suggestion.parentId ? `semantic:${suggestion.parentId}` : resolved?.id;
    if (parent && nodes.has(parent)) {
      const edgeId = `semantic-edge:${suggestion.id}:${parent}`;
      edges.set(edgeId, {
        id: edgeId,
        source: parent,
        target: id,
        kind: "semantic",
        label: suggestion.relation === "result" || !suggestion.relation ? "semantically near" : suggestion.relation,
        authority: "semantic",
        status: "suggested",
        confidence: null,
        evidenceCount: 0,
        weight: 1,
      });
    }
  }

  if (!resolved && !focusQuery) {
    for (const entityId of selectedEntityIds) {
      if (entityId === self.id) continue;
      const count = evidenceIdsByEntity.get(entityId)?.size ?? 0;
      const id = `history:${self.id}:${entityId}`;
      edges.set(id, {
        id,
        source: nodeIdForEntity(self),
        target: nodeIdForEntity(entities.get(entityId)!),
        kind: "evidence",
        label: count ? `${count} shared memories` : "in your world",
        authority: "canonical",
        status: "current",
        confidence: null,
        evidenceCount: count,
        weight: Math.min(3, 1 + count / 5),
      });
    }
  }

  const orderedNodes = [...nodes.values()]
    .sort((a, b) => b.importance - a.importance || a.label.localeCompare(b.label))
    .slice(0, limit);
  const kept = new Set(orderedNodes.map((node) => node.id));
  const orderedEdges = [...edges.values()]
    .filter((edge) => kept.has(edge.source) && kept.has(edge.target))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  const suggestions = candidates
    .filter((candidate) => candidate.id !== resolved?.id)
    .map((candidate) => {
      const entity = candidate.entity;
      const active = entity
        ? (threadsByEntity.get(entity.id) ?? []).filter((thread) => ACTIVE_THREAD.has(thread.status)).length
        : candidate.thread && ACTIVE_THREAD.has(candidate.thread.status)
          ? 1
          : 0;
      const evidence = entity ? evidenceIdsByEntity.get(entity.id)?.size ?? 0 : candidate.thread?.evidenceEventIds.length ?? 0;
      return { ...candidate, score: active * 10 + evidence };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 6)
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      kind: candidate.kind,
      reason: candidate.entity
        ? `${threadsByEntity.get(candidate.entity.id)?.filter((thread) => ACTIVE_THREAD.has(thread.status)).length ?? 0} active · ${evidenceIdsByEntity.get(candidate.entity.id)?.size ?? 0} memories`
        : `${candidate.thread?.status ?? "thread"} · ${candidate.thread?.evidenceEventIds.length ?? 0} memories`,
    }));

  const focus = resolved
    ? { id: resolved.id, label: resolved.label, kind: resolved.kind }
    : null;
  const title = focus
    ? focus.label
    : focusQuery
      ? `Around “${input.focus?.trim()}”`
      : "Your living memory";
  const subtitle = focus
    ? focus.kind === "thread"
      ? "What is happening, who is involved, and what comes next."
      : "Current truth, unfinished threads, evidence, and nearby memories."
    : focusQuery
      ? "No exact canonical match; showing semantic neighbors without promoting them to truth."
      : "The people, places, projects, routines, and open stories shaping right now.";

  return {
    version: 1,
    space: input.space,
    lens,
    focus,
    title,
    subtitle,
    nodes: orderedNodes,
    edges: orderedEdges,
    suggestions,
    summary: {
      canonicalNodes: orderedNodes.filter((node) => node.kind !== "semantic").length,
      semanticNodes: orderedNodes.filter((node) => node.kind === "semantic").length,
      activeThreads: input.threads.filter((thread) => ACTIVE_THREAD.has(thread.status)).length,
      evidenceEvents: input.events.length,
      totalEntities: entities.size,
    },
    generatedAt: now,
  };
}
