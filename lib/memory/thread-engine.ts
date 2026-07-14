import { createHash } from "node:crypto";
import {
  LifeThreadSchema,
  ThreadTransitionSchema,
  type Belief,
  type ConfidenceBand,
  type EntityRef,
  type LifeThread,
  type LifeThreadKind,
  type LifeThreadStatus,
  type MemoryEvent,
  type MemorySpace,
  type ThreadCommitmentRef,
  type ThreadExpectedNext,
  type ThreadTransition,
  type TypedValue,
} from "./contracts";
import type { ClaimEvidence, MemoryEventLedger } from "./event-ledger";

export const THREAD_PROJECTOR_VERSION = "threads-v1";

export type ThreadProjection = {
  threads: LifeThread[];
  transitions: ThreadTransition[];
};

type Descriptor = {
  anchorKey: string;
  kind: LifeThreadKind;
  title: string;
};

type ThreadGroup = Descriptor & {
  beliefs: Belief[];
  primaryBeliefKeys: Set<string>;
  titleUpdatedAt: string;
};

type ThreadEntry = {
  belief: Belief;
  descriptor: Descriptor;
};

const STATUS_PREDICATES = new Set([
  "state.status",
  "thread.status",
  "project.status",
  "goal.status",
  "problem.status",
  "health.status",
  "relationship.status",
  "routine.status",
  "waiting.status",
]);

const AUXILIARY_THREAD_PREDICATES = new Set(["location", "relationship"]);

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "bring",
  "call",
  "cancelled",
  "completed",
  "done",
  "from",
  "have",
  "into",
  "need",
  "next",
  "that",
  "the",
  "this",
  "with",
]);

const DORMANCY_DAYS: Record<LifeThreadKind, number> = {
  decision: 30,
  project: 45,
  relationship: 90,
  health: 30,
  place: 60,
  routine: 90,
  goal: 60,
  problem: 45,
  waiting: 45,
};

function deterministicUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);
}

function valueText(value: TypedValue) {
  if (value.type === "entity") return value.value.label;
  return String(value.value);
}

function descriptorFor(belief: Belief): Descriptor | null {
  const predicate = belief.predicate.toLowerCase();
  let kind: LifeThreadKind | null = null;
  if (belief.subject.kind === "person") {
    if (
      predicate.startsWith("relationship.") ||
      predicate === "state.status" ||
      predicate.startsWith("waiting.") ||
      predicate === "expected.next"
    ) {
      kind = "relationship";
    }
  } else if (belief.subject.kind === "place") {
    if (
      predicate === "state.status" ||
      predicate === "meeting.scheduled_for" ||
      predicate === "expected.next" ||
      predicate.startsWith("waiting.") ||
      predicate.startsWith("problem.") ||
      predicate.startsWith("goal.")
    ) {
      kind = "place";
    }
  } else if (
    belief.subject.kind === "project" ||
    belief.subject.kind === "organization" ||
    belief.subject.kind === "thing"
  ) {
    if (
      predicate === "meeting.scheduled_for" ||
      predicate === "state.status" ||
      predicate === "decision" ||
      predicate === "expected.next" ||
      predicate.startsWith("project.") ||
      predicate.startsWith("waiting.") ||
      predicate.startsWith("problem.") ||
      predicate.startsWith("goal.") ||
      predicate.startsWith("health.")
    ) {
      kind = "project";
    }
  } else if (belief.subject.kind === "routine") {
    if (
      predicate === "routine.pattern" ||
      predicate.startsWith("routine.") ||
      predicate === "state.status" ||
      predicate === "expected.next"
    ) {
      kind = "routine";
    }
  } else if (belief.subject.kind === "user") {
    if (predicate === "decision" || predicate.startsWith("decision.")) kind = "decision";
    else if (predicate.startsWith("health.")) kind = "health";
    else if (predicate === "goal" || predicate.startsWith("goal.")) kind = "goal";
    else if (predicate === "problem" || predicate.startsWith("problem.")) kind = "problem";
    else if (predicate.startsWith("waiting.")) kind = "waiting";
    else if (predicate === "routine.pattern" || predicate.startsWith("routine.")) kind = "routine";
    else if (STATUS_PREDICATES.has(predicate) && belief.scope.contexts[0]?.trim()) kind = "project";
  }
  if (!kind) return null;

  if (belief.subject.kind !== "user") {
    return {
      anchorKey: belief.subject.id,
      kind,
      title: belief.subject.label,
    };
  }

  // User-subject goals and symptoms need independent anchors; otherwise all
  // of a person's goals or health situations collapse into one giant thread.
  // Generic user state is only threadable when extraction supplied a named
  // context, which becomes the stable local anchor.
  const contextual = belief.scope.contexts[0]?.trim();
  const title = STATUS_PREDICATES.has(predicate) ? contextual : valueText(belief.value).trim();
  if (!title) return null;
  return {
    anchorKey: `${kind}:${normalize(title) || belief.key}`,
    kind,
    title,
  };
}

function confidenceFor(beliefs: Belief[]): ConfidenceBand {
  const applicable = beliefs.filter(
    (belief) => belief.status === "current" || belief.status === "conflicting",
  );
  const source = applicable.length ? applicable : beliefs;
  if (source.some((belief) => belief.status === "conflicting" || belief.confidence === "conflicting")) {
    return "conflicting";
  }
  if (source.some((belief) => belief.confidence === "direct")) return "direct";
  if (source.some((belief) => belief.confidence === "strong")) return "strong";
  return "tentative";
}

function explicitStatus(value: string): LifeThreadStatus | null {
  const normalized = value.toLowerCase();
  if (/\b(done|resolved|complete|completed|finished|closed|handled|fixed|signed|accepted|approved|rejected|cancelled|canceled|scrapped|dropped|ended|over)\b/.test(normalized)) {
    return "resolved";
  }
  if (/\b(blocked|stuck|stalled|held up|dependency|cannot proceed|cant proceed)\b/.test(normalized)) {
    return "blocked";
  }
  if (/\b(waiting|pending|awaiting|submitted|applied|under review|reply|response|result|delivery)\b/.test(normalized)) {
    return "waiting";
  }
  if (/\b(dormant|paused|shelved|on hold|inactive)\b/.test(normalized)) return "dormant";
  if (/\b(open|active|ongoing|in progress|underway|started|scheduled|working on)\b/.test(normalized)) {
    return "open";
  }
  return null;
}

function statusForBelief(
  belief: Belief,
  kind: LifeThreadKind,
  confidence: ConfidenceBand,
): LifeThreadStatus | null {
  if (belief.status === "conflicting" || belief.status === "unknown") return null;
  const predicate = belief.predicate.toLowerCase();
  if (STATUS_PREDICATES.has(predicate)) {
    return explicitStatus(valueText(belief.value));
  }
  if (predicate === "waiting.for" || predicate === "expected.next") return "waiting";
  if (
    belief.polarity === -1 &&
    (predicate === "problem" || predicate.startsWith("problem.") || predicate.startsWith("health."))
  ) {
    return "resolved";
  }
  if (predicate === "decision" && belief.polarity === 1) return "resolved";
  if (
    (predicate === "relationship" || predicate.startsWith("relationship.")) &&
    explicitStatus(valueText(belief.value)) === "resolved"
  ) {
    return "resolved";
  }
  if (kind === "routine" && confidence === "tentative" && belief.support.length < 3) {
    return "emerging";
  }
  if (
    predicate === "meeting.scheduled_for" ||
    predicate === "goal" ||
    predicate === "problem" ||
    predicate === "health.symptom"
  ) {
    return "open";
  }
  if (kind === "routine") return "open";
  return null;
}

function predicateLabel(predicate: string) {
  const labels: Record<string, string> = {
    "meeting.scheduled_for": "scheduled for",
    "state.status": "status",
    "thread.status": "status",
    "project.status": "project status",
    "goal.status": "goal status",
    "problem.status": "problem status",
    "health.status": "health status",
    "relationship.status": "relationship status",
    "routine.status": "routine status",
    "waiting.status": "waiting status",
    "waiting.for": "waiting for",
    "expected.next": "expected next",
    "routine.pattern": "routine",
    "health.symptom": "health symptom",
    "health.plan": "health plan",
  };
  return labels[predicate] ?? predicate.replace(/[._]+/g, " ");
}

function stateText(belief: Belief, title: string) {
  const negation = belief.polarity === -1 ? "not " : "";
  const conflict = belief.status === "conflicting" ? "Conflicting evidence: " : "";
  return `${conflict}${title}: ${negation}${predicateLabel(belief.predicate)} ${valueText(belief.value)}`.trim();
}

function statePriority(belief: Belief) {
  if (STATUS_PREDICATES.has(belief.predicate)) return 100;
  if (belief.predicate === "waiting.for") return 95;
  if (belief.predicate === "expected.next") return 90;
  if (belief.predicate === "meeting.scheduled_for") return 85;
  if (belief.predicate.startsWith("problem.")) return 80;
  if (belief.predicate.startsWith("health.")) return 75;
  if (belief.predicate.startsWith("goal.")) return 70;
  if (belief.predicate === "decision") return 65;
  if (belief.predicate.startsWith("relationship")) return 60;
  if (belief.predicate.startsWith("routine")) return 50;
  return 40;
}

function eventIdsForBelief(
  belief: Belief,
  claims: Map<string, ClaimEvidence>,
  includeOpposition = true,
) {
  return [...new Set(
    [...belief.support, ...(includeOpposition ? belief.opposition : [])]
      .map((claimId) => claims.get(claimId)?.claim.eventId)
      .filter((eventId): eventId is string => !!eventId),
  )].sort();
}

function addDays(instant: string, days: number) {
  const date = new Date(instant);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function asInstant(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function tokens(value: string) {
  return normalize(value)
    .split("-")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function relatedText(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (a.length >= 4 && (b.includes(a) || a.includes(b))) return true;
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const needed = Math.min(2, Math.max(1, Math.ceil(Math.min(leftTokens.size, rightTokens.size) / 2)));
  return overlap >= needed;
}

// Thread identity is stricter than retrieval similarity. Two anchors may only
// join when the user explicitly changed/corrected the same predicate (or used
// the correction API) and one entity label contains the other. This catches
// extraction drift such as "Project Meridian" -> "Project Meridian review"
// without merging nearby situations such as "Vienna call" and "Vienna flight".
function compatibleChangedEntity(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

function threadAnchorAliases(entries: ThreadEntry[], claimEvidence: ClaimEvidence[]) {
  const parent = new Map<string, string>();
  const firstSeen = new Map<string, string>();
  const descriptorByAnchor = new Map<string, Descriptor>();
  const anchorsByClaim = new Map<string, Set<string>>();
  const anchorsByEvent = new Map<string, Set<string>>();
  const supersededByEvent = new Map<string, string>();

  const remember = (map: Map<string, Set<string>>, key: string, anchor: string) => {
    const values = map.get(key) ?? new Set<string>();
    values.add(anchor);
    map.set(key, values);
  };
  for (const entry of entries) {
    const anchor = entry.descriptor.anchorKey;
    parent.set(anchor, anchor);
    descriptorByAnchor.set(anchor, entry.descriptor);
    const seen = firstSeen.get(anchor);
    if (!seen || entry.belief.systemTime.start < seen) {
      firstSeen.set(anchor, entry.belief.systemTime.start);
    }
    for (const claimId of entry.belief.support) remember(anchorsByClaim, claimId, anchor);
  }
  for (const evidence of claimEvidence) {
    for (const anchor of anchorsByClaim.get(evidence.claim.id) ?? []) {
      remember(anchorsByEvent, evidence.claim.eventId, anchor);
    }
  }

  const root = (anchor: string): string => {
    const direct = parent.get(anchor) ?? anchor;
    if (direct === anchor) return anchor;
    const resolved = root(direct);
    parent.set(anchor, resolved);
    return resolved;
  };
  const join = (left: string, right: string) => {
    const a = root(left);
    const b = root(right);
    if (a === b) return;
    const aSeen = firstSeen.get(a) ?? "";
    const bSeen = firstSeen.get(b) ?? "";
    const keepA = aSeen < bSeen || (aSeen === bSeen && a.localeCompare(b) <= 0);
    parent.set(keepA ? b : a, keepA ? a : b);
  };
  const compatible = (left: string, right: string) => {
    const a = descriptorByAnchor.get(left);
    const b = descriptorByAnchor.get(right);
    return !!a && !!b && a.kind === b.kind && compatibleChangedEntity(a.title, b.title);
  };

  // An explicit correction event is the strongest identity edge available.
  for (const evidence of claimEvidence) {
    if (!evidence.revisionOf) continue;
    supersededByEvent.set(evidence.revisionOf, evidence.claim.eventId);
    for (const current of anchorsByEvent.get(evidence.claim.eventId) ?? []) {
      for (const previous of anchorsByEvent.get(evidence.revisionOf) ?? []) {
        if (compatible(current, previous)) join(current, previous);
      }
    }
  }

  // Voice captures can express a correction before they know a canonical
  // target event. In that path the extractor emits relationHint=supersede.
  // Search backward only within the same predicate, then accept the newest
  // conservatively compatible entity.
  const previousByPredicate = new Map<string, ClaimEvidence[]>();
  for (const evidence of [...claimEvidence].sort(
    (left, right) =>
      left.recordedAt.localeCompare(right.recordedAt) || left.claim.id.localeCompare(right.claim.id),
  )) {
    const previous = previousByPredicate.get(evidence.claim.predicate) ?? [];
    if (evidence.claim.relationHint === "supersede") {
      const currentAnchors = [...(anchorsByClaim.get(evidence.claim.id) ?? [])];
      for (const current of currentAnchors) {
        for (let index = previous.length - 1; index >= 0; index -= 1) {
          const candidate = previous[index];
          const candidateAnchors = [...(anchorsByClaim.get(candidate.claim.id) ?? [])];
          const match = candidateAnchors.find(
            (prior) => root(prior) === root(current) || compatible(prior, current),
          );
          if (!match) continue;
          if (root(match) !== root(current)) join(current, match);
          supersededByEvent.set(candidate.claim.eventId, evidence.claim.eventId);
          break;
        }
      }
    }
    previous.push(evidence);
    previousByPredicate.set(evidence.claim.predicate, previous);
  }

  return {
    canonicalAnchor: (anchor: string) => (parent.has(anchor) ? root(anchor) : anchor),
    supersededByEvent,
  };
}

function closureEvent(event: MemoryEvent) {
  const match = event.payload.content.match(/^\s*(Done|Cancelled|Canceled):\s*(.+?)(?:\s*\((?:completed|called off).*)?$/i);
  if (!match) return null;
  return {
    status: match[1].toLowerCase() === "done" ? ("done" as const) : ("cancelled" as const),
    subject: match[2].trim(),
  };
}

function commitmentsFor(
  group: ThreadGroup,
  eventIds: Set<string>,
  events: MemoryEvent[],
  supersededByEvent: Map<string, string>,
): ThreadCommitmentRef[] {
  const revisions = new Map<string, MemoryEvent[]>();
  for (const event of events) {
    if (event.source.trust !== "user_direct") continue;
    if (!event.revisionOf) continue;
    const list = revisions.get(event.revisionOf) ?? [];
    list.push(event);
    revisions.set(event.revisionOf, list);
  }
  const closures = events
    .filter((event) => event.source.trust === "user_direct")
    .map((event) => ({ event, closure: closureEvent(event) }))
    .filter((item): item is { event: MemoryEvent; closure: NonNullable<ReturnType<typeof closureEvent>> } => !!item.closure);

  return events
    .filter((event) => {
      if (event.source.trust !== "user_direct") return false;
      if (event.payload.requested.kind !== "commitment") return false;
      if (!event.payload.requested.due && /\b(next time|when i mention|when .* comes up)\b/i.test(event.payload.content)) {
        return false;
      }
      return eventIds.has(event.id) || relatedText(group.title, event.payload.content);
    })
    .map((event) => {
      const revision = (revisions.get(event.id) ?? [])
        .filter((candidate) => candidate.payload.requested.kind === "commitment")
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
      const replacementId = supersededByEvent.get(event.id) ?? revision?.id;
      if (replacementId) {
        return {
          eventId: event.id,
          content: event.payload.content.slice(0, 2_000),
          due: event.payload.requested.due,
          status: "superseded" as const,
          closedByEventId: replacementId,
        };
      }
      const closed = closures
        .filter(
          (candidate) =>
            candidate.event.recordedAt >= event.recordedAt &&
            relatedText(event.payload.content, candidate.closure.subject),
        )
        .sort((left, right) => left.event.recordedAt.localeCompare(right.event.recordedAt))[0];
      return {
        eventId: event.id,
        content: event.payload.content.slice(0, 2_000),
        due: event.payload.requested.due,
        status: closed?.closure.status ?? ("open" as const),
        closedByEventId: closed?.event.id ?? null,
      };
    })
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
    .slice(0, 100);
}

function expectedNextFor(
  group: ThreadGroup,
  claims: Map<string, ClaimEvidence>,
  commitments: ThreadCommitmentRef[],
): ThreadExpectedNext | null {
  const applicable = group.beliefs
    .filter((belief) => belief.status === "current")
    .filter((belief) =>
      ["meeting.scheduled_for", "expected.next", "waiting.for"].includes(belief.predicate),
    )
    .sort(
      (left, right) =>
        right.systemTime.start.localeCompare(left.systemTime.start) || left.key.localeCompare(right.key),
    )[0];
  if (applicable) {
    const eventIds = eventIdsForBelief(applicable, claims, false);
    const value = valueText(applicable.value);
    const by = applicable.value.type === "date"
      ? { start: value, end: value, precision: "day" as const }
      : null;
    return {
      event:
        applicable.predicate === "meeting.scheduled_for"
          ? `${group.title} scheduled`
          : value,
      by,
      evidenceEventIds: eventIds,
    };
  }

  const nextCommitment = commitments
    .filter((commitment) => commitment.status === "open" && commitment.due)
    .sort((left, right) => String(left.due).localeCompare(String(right.due)))[0];
  if (!nextCommitment?.due) return null;
  return {
    event: nextCommitment.content,
    by: { start: nextCommitment.due, end: nextCommitment.due, precision: "day" },
    evidenceEventIds: [nextCommitment.eventId],
  };
}

function makeTransition(input: {
  threadId: string;
  kind: ThreadTransition["kind"];
  fromStatus: LifeThreadStatus | null;
  toStatus: LifeThreadStatus;
  at: string;
  reason: string;
  state: string;
  evidenceEventIds: string[];
  projectorVersion: string;
  ordinal: number;
}) {
  return ThreadTransitionSchema.parse({
    id: deterministicUuid(
      `${input.threadId}|${input.kind}|${input.at}|${input.fromStatus}|${input.toStatus}|${input.ordinal}|${input.evidenceEventIds.join(",")}`,
    ),
    threadId: input.threadId,
    kind: input.kind,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    at: input.at,
    reason: input.reason,
    state: input.state,
    evidenceEventIds: input.evidenceEventIds,
    projectorVersion: input.projectorVersion,
  });
}

export function projectThreads(
  input: {
    userId: string;
    space: MemorySpace;
    beliefs: Belief[];
    claimEvidence: ClaimEvidence[];
    events: MemoryEvent[];
  },
  options: { asOf?: string; projectorVersion?: string } = {},
): ThreadProjection {
  const asOf = options.asOf ?? new Date().toISOString();
  const projectorVersion = options.projectorVersion ?? THREAD_PROJECTOR_VERSION;
  const claims = new Map(input.claimEvidence.map((evidence) => [evidence.claim.id, evidence]));
  const groups = new Map<string, ThreadGroup>();

  const entries: ThreadEntry[] = [];
  for (const belief of input.beliefs) {
    if (belief.status === "unknown") continue;
    const descriptor = descriptorFor(belief);
    if (!descriptor) continue;
    entries.push({ belief, descriptor });
  }
  const { canonicalAnchor, supersededByEvent } = threadAnchorAliases(
    entries,
    input.claimEvidence,
  );
  for (const { belief, descriptor } of entries) {
    const key = canonicalAnchor(descriptor.anchorKey);
    const group = groups.get(key) ?? {
      ...descriptor,
      anchorKey: key,
      beliefs: [],
      primaryBeliefKeys: new Set(),
      titleUpdatedAt: belief.systemTime.start,
    };
    group.beliefs.push(belief);
    group.primaryBeliefKeys.add(belief.key);
    if (
      belief.systemTime.start > group.titleUpdatedAt ||
      (belief.systemTime.start === group.titleUpdatedAt &&
        descriptor.title.localeCompare(group.title) < 0)
    ) {
      group.title = descriptor.title;
      group.titleUpdatedAt = belief.systemTime.start;
    }
    groups.set(key, group);
  }

  // Neutral facts can update the state of an existing situation, but cannot
  // create an open loop by themselves. This prevents a static address or a
  // family relationship from becoming a zombie thread while still allowing a
  // venue change to enrich an already-active project.
  for (const belief of input.beliefs) {
    if (
      belief.status === "unknown" ||
      belief.subject.kind === "user" ||
      !AUXILIARY_THREAD_PREDICATES.has(belief.predicate) ||
      descriptorFor(belief)
    ) {
      continue;
    }
    const group = groups.get(canonicalAnchor(belief.subject.id));
    if (group && !group.beliefs.some((item) => item.key === belief.key)) {
      group.beliefs.push(belief);
    }
  }

  const threads: LifeThread[] = [];
  const allTransitions: ThreadTransition[] = [];
  for (const group of [...groups.values()].sort((left, right) =>
    left.anchorKey.localeCompare(right.anchorKey),
  )) {
    group.beliefs.sort(
      (left, right) =>
        left.systemTime.start.localeCompare(right.systemTime.start) || left.key.localeCompare(right.key),
    );
    const threadId = deterministicUuid(`${input.userId}|${input.space}|${group.anchorKey}`);
    const confidence = confidenceFor(group.beliefs);
    const transitions: ThreadTransition[] = [];
    let status: LifeThreadStatus | null = null;

    for (const belief of group.beliefs) {
      const evidenceEventIds = eventIdsForBelief(belief, claims, false);
      if (!evidenceEventIds.length) continue;
      const desired = statusForBelief(belief, group.kind, confidence);
      const state = stateText(belief, group.title);
      if (!status) {
        if (!group.primaryBeliefKeys.has(belief.key)) continue;
        status = desired ?? (group.kind === "routine" ? "emerging" : "open");
        transitions.push(
          makeTransition({
            threadId,
            kind: "created",
            fromStatus: null,
            toStatus: status,
            at: belief.systemTime.start,
            reason: "first grounded thread signal",
            state,
            evidenceEventIds,
            projectorVersion,
            ordinal: transitions.length,
          }),
        );
        continue;
      }
      if (!desired || desired === status) {
        transitions.push(
          makeTransition({
            threadId,
            kind: "state_updated",
            fromStatus: status,
            toStatus: status,
            at: belief.systemTime.start,
            reason: desired
              ? "new evidence updated the situation"
              : belief.status === "conflicting"
                ? "conflicting evidence preserved uncertainty"
                : "new evidence updated the situation without changing its lifecycle",
            state,
            evidenceEventIds,
            projectorVersion,
            ordinal: transitions.length,
          }),
        );
        continue;
      }
      const previous = status;
      status = desired;
      transitions.push(
        makeTransition({
          threadId,
          kind: "status_changed",
          fromStatus: previous,
          toStatus: status,
          at: belief.systemTime.start,
          reason: status === "resolved" ? "explicit grounded resolution" : "grounded lifecycle update",
          state,
          evidenceEventIds,
          projectorVersion,
          ordinal: transitions.length,
        }),
      );
    }
    if (!status || !transitions.length) continue;

    const applicable = group.beliefs.filter(
      (belief) => belief.status === "current" || belief.status === "conflicting",
    );
    const currentCandidates = applicable.length ? applicable : [group.beliefs.at(-1)!];
    const currentBelief = [...currentCandidates].sort(
      (left, right) =>
        right.systemTime.start.localeCompare(left.systemTime.start) ||
        statePriority(right) - statePriority(left) ||
        left.key.localeCompare(right.key),
    )[0];
    const currentEvidence = eventIdsForBelief(currentBelief, claims, false);
    const evidenceEventIds = [...new Set(
      group.beliefs.flatMap((belief) => eventIdsForBelief(belief, claims)),
    )].sort();
    if (!currentEvidence.length || !evidenceEventIds.length) continue;

    const groupEventIds = new Set(evidenceEventIds);
    const commitments = commitmentsFor(group, groupEventIds, input.events, supersededByEvent);
    for (const commitment of commitments) {
      groupEventIds.add(commitment.eventId);
      if (commitment.closedByEventId) groupEventIds.add(commitment.closedByEventId);
    }
    const expectedNext = expectedNextFor(group, claims, commitments);
    const lastMeaningfulChangeAt = group.beliefs.reduce(
      (latest, belief) => belief.systemTime.start > latest ? belief.systemTime.start : latest,
      group.beliefs[0].systemTime.start,
    );
    const baseDormancyDays = DORMANCY_DAYS[group.kind];
    const dormancyDays = status === "waiting" || status === "blocked"
      ? baseDormancyDays * 2
      : baseDormancyDays;
    const dormantAt = addDays(lastMeaningfulChangeAt, dormancyDays);
    const expectedReviewAt = expectedNext?.by?.start ? asInstant(expectedNext.by.start) : null;
    let nextReviewAt: string | null = expectedReviewAt ?? dormantAt;

    if (status !== "resolved" && status !== "dormant" && asOf > dormantAt) {
      const previous = status;
      status = "dormant";
      transitions.push(
        makeTransition({
          threadId,
          kind: "became_dormant",
          fromStatus: previous,
          toStatus: "dormant",
          at: dormantAt,
          reason: "no meaningful update inside the thread review window; resolution was not inferred",
          state: stateText(currentBelief, group.title),
          evidenceEventIds: currentEvidence,
          projectorVersion,
          ordinal: transitions.length,
        }),
      );
      nextReviewAt = null;
    }

    const resolvedTransition = status === "resolved"
      ? [...transitions].reverse().find((transition) => transition.toStatus === "resolved")
      : null;
    const participants = new Map<string, EntityRef>();
    for (const belief of group.beliefs) {
      participants.set(belief.subject.id, belief.subject);
      if (belief.value.type === "entity") participants.set(belief.value.value.id, belief.value.value);
    }

    const thread = LifeThreadSchema.parse({
      id: threadId,
      userId: input.userId,
      space: input.space,
      anchorKey: group.anchorKey,
      title: group.title,
      kind: group.kind,
      status,
      currentState: {
        text: stateText(currentBelief, group.title),
        beliefKeys: [currentBelief.key],
        evidenceEventIds: currentEvidence,
        confidence,
      },
      participants: [...participants.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, 100),
      commitments,
      expectedNext,
      lastMeaningfulChangeAt,
      nextReviewAt: status === "resolved" ? null : nextReviewAt,
      evidenceEventIds: [...groupEventIds].sort(),
      beliefKeys: group.beliefs.map((belief) => belief.key).sort(),
      resolution: resolvedTransition
        ? {
            eventId: resolvedTransition.evidenceEventIds[0],
            reason: resolvedTransition.state,
            resolvedAt: resolvedTransition.at,
          }
        : null,
      confidence,
      projectorVersion,
    });
    threads.push(thread);
    allTransitions.push(...transitions);
  }

  return {
    threads: threads.sort((left, right) => left.id.localeCompare(right.id)),
    transitions: allTransitions.sort(
      (left, right) => left.at.localeCompare(right.at) || left.id.localeCompare(right.id),
    ),
  };
}

export function rebuildThreads(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  options: { asOf?: string; projectorVersion?: string } = {},
) {
  const projection = projectThreads(
    {
      userId,
      space,
      beliefs: ledger.listBeliefs({ userId, space, limit: 5_000 }),
      claimEvidence: ledger.listClaimEvidence(userId, space),
      events: ledger.listActiveEvents(userId, space),
    },
    options,
  );
  ledger.replaceThreadProjection(userId, space, projection.threads, projection.transitions);
  return projection;
}
