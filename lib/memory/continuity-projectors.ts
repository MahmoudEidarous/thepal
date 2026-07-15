import { createHash } from "node:crypto";
import type {
  Belief,
  ConfidenceBand,
  EntityRef,
  LifeThread,
  MemoryEvent,
  MemorySpace,
  Sensitivity,
  TrustTier,
  TypedValue,
} from "./contracts";
import type { ClaimEvidence, MemoryEventLedger } from "./event-ledger";
import { canProjectClaimEvidence } from "./belief-projector";

export const CONTINUITY_PROJECTOR_VERSION = "continuity-v1" as const;

export type Dossier = {
  type: "dossier";
  entity: EntityRef;
  currentBeliefs: Belief[];
  historicalBeliefs: Belief[];
  activeThreads: LifeThread[];
  closedThreads: LifeThread[];
  commitments: LifeThread["commitments"];
  lastMentionedAt: string | null;
  evidenceEventIds: string[];
  agentText: string;
  projectorVersion: typeof CONTINUITY_PROJECTOR_VERSION;
};

export type Constellation = {
  type: "constellation";
  period: "week" | "month";
  range: { start: string; end: string };
  toldEvents: Array<{ id: string; at: string; text: string }>;
  storyEvents: Array<{
    eventId: string;
    at: string;
    subject: EntityRef;
    predicate: string;
    value: string;
  }>;
  people: Array<{ entity: EntityRef; mentions: number }>;
  decisions: Array<{ eventId: string; text: string }>;
  emotionalEpisodes: Array<{ eventId: string; at: string; state: string }>;
  changes: Array<{ beliefKey: string; text: string; status: Belief["status"] }>;
  unfinishedThreads: LifeThread[];
  resolvedThreads: LifeThread[];
  evidenceEventIds: string[];
  agentText: string;
  projectorVersion: typeof CONTINUITY_PROJECTOR_VERSION;
};

export type EmotionalArc = {
  type: "emotional-arc";
  episodes: Array<{
    eventId: string;
    subject: EntityRef;
    state: string;
    toldAt: string;
    validTime: ClaimEvidence["claim"]["validTime"];
    confidence: ConfidenceBand;
  }>;
  currentEpisode: EmotionalArc["episodes"][number] | null;
  direction: "changed" | "similar" | "insufficient-evidence";
  evidenceEventIds: string[];
  agentText: string;
  projectorVersion: typeof CONTINUITY_PROJECTOR_VERSION;
};

export type RoutineView = {
  type: "routines";
  routines: Array<{
    entity: EntityRef;
    pattern: string;
    confidence: ConfidenceBand;
    status: "emerging" | "open" | "dormant" | "resolved";
    observations: number;
    lastObservedAt: string | null;
    evidenceEventIds: string[];
  }>;
  associations: Array<{
    id: string;
    subject: EntityRef;
    outcomeKind: "emotion" | "decision" | "status";
    outcomeValue: string;
    status: "emerging" | "active" | "stale";
    confidence: number;
    observations: number;
    evidenceEventIds: string[];
    lastObservedAt: string;
  }>;
  evidenceEventIds: string[];
  agentText: string;
  projectorVersion: typeof CONTINUITY_PROJECTOR_VERSION;
};

export type ReturningMemory = {
  text: string;
  when: string;
  storyDate: string;
  trust: TrustTier | null;
  sensitivity: Sensitivity;
  evidenceEventIds: string[];
};

export type AnniversaryView = {
  type: "anniversaries";
  today: string;
  memories: ReturningMemory[];
  evidenceEventIds: string[];
  agentText: string;
  projectorVersion: typeof CONTINUITY_PROJECTOR_VERSION;
};

export type ContinuityContextView = {
  id: string;
  kind: Dossier["type"] | Constellation["type"] | EmotionalArc["type"] | RoutineView["type"];
  text: string;
  whyIncluded: string;
  evidenceEventIds: string[];
  confidence: ConfidenceBand;
};

function valueText(value: TypedValue) {
  return value.type === "entity" ? value.value.label : String(value.value);
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function terms(value: string) {
  return new Set(normalize(value).split(" ").filter((term) => term.length > 1));
}

function matches(query: string, value: string) {
  const left = normalize(query);
  const right = normalize(value);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const a = terms(left);
  const b = terms(right);
  return [...a].filter((term) => b.has(term)).length / Math.max(1, Math.min(a.size, b.size)) >= 0.7;
}

function stableId(prefix: string, value: string) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function confidenceFor(evidence: ClaimEvidence): ConfidenceBand {
  if (evidence.claim.modality !== "asserted" || evidence.trust === "recall_observation") {
    return "tentative";
  }
  if (evidence.trust === "external_content") return "tentative";
  return "direct";
}

function entityCandidates(claims: ClaimEvidence[], threads: LifeThread[]): EntityRef[] {
  const values: EntityRef[] = [];
  for (const evidence of claims) {
    values.push(evidence.claim.subject);
    if (evidence.claim.object.type === "entity") values.push(evidence.claim.object.value);
  }
  for (const thread of threads) values.push(...thread.participants);
  const unique = new Map(values.map((entity) => [entity.id, entity]));
  return [...unique.values()];
}

function evidenceEvents(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
) {
  const events = ledger.listActiveEvents(userId, space);
  return { events, byId: new Map(events.map((event) => [event.id, event])) };
}

export function buildDossier(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  about: string,
): Dossier | null {
  const claims = ledger.listClaimEvidence(userId, space).filter(canProjectClaimEvidence);
  const beliefs = ledger.listBeliefs({ userId, space, limit: 5_000 });
  const threads = ledger.listThreads({ userId, space, limit: 5_000 });
  const candidates = entityCandidates(claims, threads);
  const entity =
    candidates
      .map((candidate) => ({
        candidate,
        score:
          normalize(candidate.label) === normalize(about)
            ? 3
            : matches(about, candidate.label)
              ? 2
              : 0,
      }))
      .sort((left, right) => right.score - left.score || left.candidate.label.localeCompare(right.candidate.label))[0];
  if (!entity || entity.score === 0) return null;
  const relevantBeliefs = beliefs.filter(
    (belief) =>
      belief.subject.id === entity.candidate.id ||
      (belief.value.type === "entity" && belief.value.value.id === entity.candidate.id),
  );
  const relevantThreads = threads.filter(
    (thread) =>
      matches(entity.candidate.label, `${thread.title} ${thread.anchorKey}`) ||
      thread.participants.some((participant) => participant.id === entity.candidate.id),
  );
  const relevantClaims = claims.filter(
    ({ claim }) =>
      claim.subject.id === entity.candidate.id ||
      (claim.object.type === "entity" && claim.object.value.id === entity.candidate.id),
  );
  const eventIds = [
    ...relevantClaims.map((entry) => entry.claim.eventId),
    ...relevantThreads.flatMap((thread) => thread.evidenceEventIds),
  ];
  const { byId } = evidenceEvents(ledger, userId, space);
  const evidenceEventIds = [...new Set(eventIds)].filter((id) => byId.has(id));
  const lastMentionedAt = evidenceEventIds
    .map((id) => byId.get(id)?.recordedAt ?? "")
    .sort()
    .at(-1) || null;
  const activeThreads = relevantThreads.filter((thread) => !["resolved", "dormant"].includes(thread.status));
  const closedThreads = relevantThreads.filter((thread) => ["resolved", "dormant"].includes(thread.status));
  // Thread reconciliation can conservatively join aliases such as “Meridian” and
  // “Project Meridian review” even when their raw belief subjects differ. When a
  // thread has selected a newer belief for the same predicate, that applicable
  // state wins in the dossier without deleting or rewriting the older evidence.
  const beliefByKey = new Map(beliefs.map((belief) => [belief.key, belief]));
  const threadShadowedBeliefKeys = new Set<string>();
  for (const thread of activeThreads) {
    const currentKeys = new Set(thread.currentState.beliefKeys);
    const currentPredicates = new Set(
      thread.currentState.beliefKeys
        .map((key) => beliefByKey.get(key)?.predicate)
        .filter((predicate): predicate is string => Boolean(predicate)),
    );
    for (const key of thread.beliefKeys) {
      const belief = beliefByKey.get(key);
      if (belief && !currentKeys.has(key) && currentPredicates.has(belief.predicate)) {
        threadShadowedBeliefKeys.add(key);
      }
    }
  }
  const currentBeliefs = relevantBeliefs.filter(
    (belief) => belief.status === "current" && !threadShadowedBeliefKeys.has(belief.key),
  );
  const historicalBeliefs = relevantBeliefs
    .filter((belief) => belief.status !== "current" || threadShadowedBeliefKeys.has(belief.key))
    .map((belief) =>
      threadShadowedBeliefKeys.has(belief.key) && belief.status === "current"
        ? { ...belief, status: "historical" as const }
        : belief,
    );
  const commitments = activeThreads.flatMap((thread) => thread.commitments.filter((item) => item.status === "open"));
  const facts = currentBeliefs
    .slice(0, 6)
    .map((belief) => `${belief.predicate.replace(/[._]/g, " ")}: ${valueText(belief.value)}`);
  const agentText = [
    `${entity.candidate.label} has ${currentBeliefs.length} current belief${currentBeliefs.length === 1 ? "" : "s"} and ${activeThreads.length} active life thread${activeThreads.length === 1 ? "" : "s"}.`,
    facts.length ? `Current: ${facts.join("; ")}.` : "There is no stable current claim to assert yet.",
    commitments.length ? `${commitments.length} open commitment${commitments.length === 1 ? "" : "s"} still involve this.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    type: "dossier",
    entity: entity.candidate,
    currentBeliefs,
    historicalBeliefs,
    activeThreads,
    closedThreads,
    commitments,
    lastMentionedAt,
    evidenceEventIds,
    agentText,
    projectorVersion: CONTINUITY_PROJECTOR_VERSION,
  };
}

function periodRange(period: "week" | "month", at: string) {
  const end = new Date(at);
  const start = new Date(end);
  if (period === "week") {
    start.setUTCDate(start.getUTCDate() - 6);
  } else {
    start.setUTCMonth(start.getUTCMonth() - 1);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function inRange(value: string, range: { start: string; end: string }) {
  const parsed = Date.parse(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return Number.isFinite(parsed) && parsed >= Date.parse(range.start) && parsed <= Date.parse(range.end);
}

// Calendar subtraction must not roll an impossible day into the next month.
// July 31 therefore has no one-month return in June instead of becoming July 1.
function monthsBack(today: string, months: number) {
  const [year, month, day] = today.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 - months, day));
  return value.getUTCDate() === day ? value.toISOString().slice(0, 10) : null;
}

export function buildAnniversaryView(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  today = new Date().toISOString().slice(0, 10),
): AnniversaryView {
  const safeToday = /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? today
    : new Date().toISOString().slice(0, 10);
  const thisYear = Number(safeToday.slice(0, 4));
  const monthAndDay = safeToday.slice(5);
  const monthAgo = monthsBack(safeToday, 1);
  const sixMonthsAgo = monthsBack(safeToday, 6);
  const events = new Map(
    ledger.listActiveEvents(userId, space).map((event) => [event.id, event]),
  );
  const byEvent = new Map<
    string,
    { memory: ReturningMemory; order: number; recordedAt: string }
  >();

  for (const evidence of ledger
    .listClaimEvidence(userId, space)
    .filter(canProjectClaimEvidence)) {
    const start = evidence.claim.validTime?.start ?? "";
    const storyDate = start.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(storyDate) || storyDate >= safeToday) continue;
    const event = events.get(evidence.claim.eventId);
    if (!event || event.payload.requested.kind === "commitment") continue;
    const text = event.payload.content.replace(/\s+/g, " ").trim();
    if (!text || /^(Done|Cancelled|Canceled):/i.test(text)) continue;

    let when: string | null = null;
    let order = 0;
    if (storyDate.slice(5) === monthAndDay) {
      const years = thisYear - Number(storyDate.slice(0, 4));
      if (years >= 1) {
        when = years === 1 ? "a year ago today" : `${years} years ago today`;
        order = -years;
      }
    } else if (sixMonthsAgo === storyDate) {
      when = "six months ago today";
      order = 1;
    } else if (monthAgo === storyDate) {
      when = "a month ago today";
      order = 2;
    }
    if (!when) continue;

    const candidate = {
      memory: {
        text: text.slice(0, 500),
        when,
        storyDate,
        trust: evidence.trust,
        sensitivity: event.sensitivity,
        evidenceEventIds: [event.id],
      },
      order,
      recordedAt: event.recordedAt,
    };
    const current = byEvent.get(event.id);
    if (
      !current ||
      candidate.order < current.order ||
      (candidate.order === current.order && candidate.memory.storyDate < current.memory.storyDate)
    ) {
      byEvent.set(event.id, candidate);
    }
  }

  const memories = [...byEvent.values()]
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.memory.storyDate.localeCompare(right.memory.storyDate) ||
        left.recordedAt.localeCompare(right.recordedAt),
    )
    .slice(0, 12)
    .map((item) => item.memory);
  const evidenceEventIds = memories.flatMap((memory) => memory.evidenceEventIds);
  const agentText = memories.length
    ? `${memories.length} grounded memor${memories.length === 1 ? "y returns" : "ies return"} on ${safeToday}. ${memories
        .slice(0, 3)
        .map((memory) => `${memory.when}: ${memory.text}`)
        .join(" | ")}`
    : `No grounded memory has an exact calendar return on ${safeToday}.`;
  return {
    type: "anniversaries",
    today: safeToday,
    memories,
    evidenceEventIds,
    agentText,
    projectorVersion: CONTINUITY_PROJECTOR_VERSION,
  };
}

export function buildConstellation(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  period: "week" | "month",
  at = new Date().toISOString(),
): Constellation {
  const range = periodRange(period, at);
  const events = ledger.listActiveEvents(userId, space);
  const claims = ledger.listClaimEvidence(userId, space).filter(canProjectClaimEvidence);
  const beliefs = ledger.listBeliefs({ userId, space, limit: 5_000 });
  const threads = ledger.listThreads({ userId, space, limit: 5_000 });
  const told = events.filter((event) => inRange(event.recordedAt, range));
  const story = claims.filter(
    ({ claim }) => !!claim.validTime?.start && inRange(claim.validTime.start, range),
  );
  const toldEvents = told.map((event) => ({ id: event.id, at: event.recordedAt, text: event.payload.content }));
  const storyEvents = story.map(({ claim }) => ({
    eventId: claim.eventId,
    at: claim.validTime!.start,
    subject: claim.subject,
    predicate: claim.predicate,
    value: valueText(claim.object),
  }));
  const peopleMap = new Map<string, { entity: EntityRef; mentions: number }>();
  for (const { claim } of claims.filter((entry) => told.some((event) => event.id === entry.claim.eventId))) {
    const entities = [
      ...(claim.subject.kind === "person" ? [claim.subject] : []),
      ...(claim.object.type === "entity" && claim.object.value.kind === "person" ? [claim.object.value] : []),
    ];
    for (const entity of entities) {
      const existing = peopleMap.get(entity.id);
      peopleMap.set(entity.id, { entity, mentions: (existing?.mentions ?? 0) + 1 });
    }
  }
  const decisions = claims
    .filter(({ claim }) => claim.predicate === "decision" && told.some((event) => event.id === claim.eventId))
    .map(({ claim }) => ({ eventId: claim.eventId, text: `${claim.subject.label}: ${valueText(claim.object)}` }));
  const emotionalEpisodes = claims
    .filter(({ claim }) => claim.predicate === "emotion.state" && (inRange(claim.validTime?.start ?? "", range) || told.some((event) => event.id === claim.eventId)))
    .map(({ claim, recordedAt }) => ({ eventId: claim.eventId, at: claim.validTime?.start ?? recordedAt, state: valueText(claim.object) }));
  const changes = beliefs
    .filter((belief) => inRange(belief.systemTime.start, range) && (belief.status !== "current" || belief.opposition.length > 0))
    .map((belief) => ({
      beliefKey: belief.key,
      text: `${belief.subject.label} · ${belief.predicate.replace(/[._]/g, " ")} · ${valueText(belief.value)}`,
      status: belief.status,
    }));
  const unfinishedThreads = threads.filter(
    (thread) =>
      !["resolved", "dormant"].includes(thread.status) &&
      (inRange(thread.lastMeaningfulChangeAt, range) || thread.evidenceEventIds.some((id) => told.some((event) => event.id === id))),
  );
  const resolvedThreads = threads.filter(
    (thread) => thread.status === "resolved" && !!thread.resolution && inRange(thread.resolution.resolvedAt, range),
  );
  const evidenceEventIds = [
    ...new Set([
      ...told.map((event) => event.id),
      ...story.map(({ claim }) => claim.eventId),
      ...unfinishedThreads.flatMap((thread) => thread.evidenceEventIds),
      ...resolvedThreads.flatMap((thread) => thread.evidenceEventIds),
    ]),
  ];
  const label = period === "week" ? "seven days" : "month";
  const agentText = `Across this ${label}, Recall has ${toldEvents.length} telling${toldEvents.length === 1 ? "" : "s"}, ${peopleMap.size} named ${peopleMap.size === 1 ? "person" : "people"}, ${decisions.length} decision${decisions.length === 1 ? "" : "s"}, ${emotionalEpisodes.length} emotional episode${emotionalEpisodes.length === 1 ? "" : "s"}, and ${unfinishedThreads.length} unfinished thread${unfinishedThreads.length === 1 ? "" : "s"}. ${resolvedThreads.length ? `${resolvedThreads.length} thread${resolvedThreads.length === 1 ? " was" : "s were"} resolved.` : ""}`.trim();
  return {
    type: "constellation",
    period,
    range,
    toldEvents,
    storyEvents,
    people: [...peopleMap.values()].sort((left, right) => right.mentions - left.mentions),
    decisions,
    emotionalEpisodes,
    changes,
    unfinishedThreads,
    resolvedThreads,
    evidenceEventIds,
    agentText,
    projectorVersion: CONTINUITY_PROJECTOR_VERSION,
  };
}

export function buildEmotionalArc(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  about?: string,
): EmotionalArc {
  const episodes = ledger
    .listClaimEvidence(userId, space)
    .filter(canProjectClaimEvidence)
    .filter(
      (entry) =>
        entry.claim.predicate === "emotion.state" &&
        (!about || matches(about, `${entry.claim.subject.label} ${valueText(entry.claim.object)}`)),
    )
    .map((entry) => ({
      eventId: entry.claim.eventId,
      subject: entry.claim.subject,
      state: valueText(entry.claim.object),
      toldAt: entry.recordedAt,
      validTime: entry.claim.validTime,
      confidence: confidenceFor(entry),
    }))
    .sort((left, right) => left.toldAt.localeCompare(right.toldAt));
  const currentEpisode = episodes.at(-1) ?? null;
  const prior = episodes.at(-2);
  const direction =
    !currentEpisode || !prior
      ? "insufficient-evidence"
      : normalize(currentEpisode.state) === normalize(prior.state)
        ? "similar"
        : "changed";
  const evidenceEventIds = [...new Set(episodes.map((episode) => episode.eventId))];
  const agentText = !currentEpisode
    ? "There is not enough direct emotional evidence to describe an arc."
    : `The latest temporary emotional episode was “${currentEpisode.state}”${prior ? `; the previous recorded episode was “${prior.state}”` : ""}. Treat these as moments, not personality traits.`;
  return {
    type: "emotional-arc",
    episodes,
    currentEpisode,
    direction,
    evidenceEventIds,
    agentText,
    projectorVersion: CONTINUITY_PROJECTOR_VERSION,
  };
}

export function buildRoutineView(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
): RoutineView {
  const beliefs = ledger
    .listBeliefs({ userId, space, predicate: "routine.pattern", limit: 5_000 })
    .filter((belief) => belief.status !== "unknown");
  const threads = ledger.listThreads({ userId, space, kind: "routine", limit: 5_000 });
  const events = new Map(ledger.listActiveEvents(userId, space).map((event) => [event.id, event]));
  const claimEvent = new Map(
    ledger
      .listClaimEvidence(userId, space)
      .filter(canProjectClaimEvidence)
      .map((entry) => [entry.claim.id, entry.claim.eventId]),
  );
  const routines = beliefs.map((belief) => {
    const thread = threads.find(
      (candidate) =>
        candidate.anchorKey === belief.subject.id || matches(candidate.title, belief.subject.label),
    );
    const evidenceEventIds = belief.support
      .map((claimId) => claimEvent.get(claimId))
      .filter((id): id is string => !!id && events.has(id));
    const status: RoutineView["routines"][number]["status"] = thread?.status === "dormant" || thread?.status === "resolved"
      ? thread.status
      : thread?.status === "open"
        ? "open"
        : "emerging";
    return {
      entity: belief.subject,
      pattern: valueText(belief.value),
      confidence: belief.confidence,
      status,
      observations: evidenceEventIds.length,
      lastObservedAt:
        evidenceEventIds.map((id) => events.get(id)?.recordedAt ?? "").sort().at(-1) || null,
      evidenceEventIds,
    };
  });
  const evidenceEventIds = [...new Set(routines.flatMap((routine) => routine.evidenceEventIds))];
  const associations = ledger
    .listAssociations({ userId, space, includeStale: false, limit: 50 })
    .map((association) => ({
      id: association.id,
      subject: {
        id: association.subjectId,
        kind: association.subjectKind as EntityRef["kind"],
        label: association.subjectLabel,
      },
      outcomeKind: association.outcomeKind,
      outcomeValue: association.outcomeValue,
      status: association.status,
      confidence: association.confidence,
      observations: association.observations,
      evidenceEventIds: association.evidenceEventIds,
      lastObservedAt: association.lastObservedAt,
    }));
  const associationText = associations.slice(0, 5).map(
    (association) =>
      `${association.subject.label} was associated with ${association.outcomeValue} across ${association.observations} grounded episodes (${association.status}; non-causal hypothesis).`,
  );
  const agentText = [
    routines.length
      ? `${routines.length} recurring pattern${routines.length === 1 ? " is" : "s are"} visible; ${routines.filter((routine) => routine.status === "open").length} crossed the evidence threshold and ${routines.filter((routine) => routine.status === "emerging").length} remain hypotheses.`
      : "No explicit routine has enough grounded evidence to present yet.",
    ...associationText,
  ].join(" ");
  return {
    type: "routines",
    routines,
    associations,
    evidenceEventIds: [...new Set([...evidenceEventIds, ...associations.flatMap((item) => item.evidenceEventIds)])],
    agentText,
    projectorVersion: CONTINUITY_PROJECTOR_VERSION,
  };
}

function dossierSubject(query: string) {
  const patterns = [
    /(?:tell me about|what do you know about|show me|how is|how's)\s+(.+?)[?.!]*$/i,
    /(?:my history with|what happened with)\s+(.+?)[?.!]*$/i,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern)?.[1]?.trim();
    if (match && match.length <= 120) return match;
  }
  return null;
}

export function continuityContextViews(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  query: string,
  at = new Date().toISOString(),
): ContinuityContextView[] {
  const lower = normalize(query);
  const views: ContinuityContextView[] = [];
  const dossierQuery = dossierSubject(query);
  if (dossierQuery) {
    const dossier = buildDossier(ledger, userId, space, dossierQuery);
    if (dossier) {
      views.push({
        id: stableId("dossier", `${space}:${dossier.entity.id}`),
        kind: dossier.type,
        text: dossier.agentText,
        whyIncluded: `the user asked for the living dossier on ${dossier.entity.label}`,
        evidenceEventIds: dossier.evidenceEventIds,
        confidence: dossier.historicalBeliefs.some((belief) => belief.status === "conflicting")
          ? "conflicting"
          : "direct",
      });
    }
  }
  if (/\b(my|this|last) week\b|\blast seven days\b/.test(lower)) {
    const view = buildConstellation(ledger, userId, space, "week", at);
    views.push({
      id: stableId("constellation", `${space}:week:${view.range.end.slice(0, 10)}`),
      kind: view.type,
      text: view.agentText,
      whyIncluded: "the user asked for a grounded seven-day continuity view",
      evidenceEventIds: view.evidenceEventIds,
      confidence: "direct",
    });
  } else if (/\b(my|this|last) month\b|\bmonthly\b/.test(lower)) {
    const view = buildConstellation(ledger, userId, space, "month", at);
    views.push({
      id: stableId("constellation", `${space}:month:${view.range.end.slice(0, 10)}`),
      kind: view.type,
      text: view.agentText,
      whyIncluded: "the user asked for a grounded monthly continuity view",
      evidenceEventIds: view.evidenceEventIds,
      confidence: "direct",
    });
  }
  if (/\b(feel|felt|feeling|emotion|mood|emotionally)\b/.test(lower)) {
    const view = buildEmotionalArc(ledger, userId, space);
    views.push({
      id: stableId("emotion", `${space}:${view.evidenceEventIds.join(":")}`),
      kind: view.type,
      text: view.agentText,
      whyIncluded: "the user asked about emotional continuity; episodes remain temporary evidence",
      evidenceEventIds: view.evidenceEventIds,
      confidence: view.currentEpisode?.confidence ?? "tentative",
    });
  }
  if (/\b(routine|routines|pattern|patterns|usually|habit|habits)\b/.test(lower)) {
    const view = buildRoutineView(ledger, userId, space);
    views.push({
      id: stableId("routines", `${space}:${view.evidenceEventIds.join(":")}`),
      kind: view.type,
      text: view.agentText,
      whyIncluded: "the user asked for grounded routine and recurring-pattern evidence",
      evidenceEventIds: view.evidenceEventIds,
      confidence: view.routines.some((routine) => routine.confidence === "tentative")
        ? "tentative"
        : "strong",
    });
  }
  return views.slice(0, 3);
}

export function eventExcerpt(event: MemoryEvent) {
  return event.payload.content.replace(/\s+/g, " ").trim().slice(0, 240);
}
