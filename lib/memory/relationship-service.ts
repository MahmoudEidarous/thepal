import { RelationshipEventInputSchema, type MemorySpace, type RelationshipEvent, type RelationshipEventInput } from "./contracts";
import { getMemoryEventLedger, type MemoryEventLedger } from "./event-ledger";
import {
  RECALL_PERSONA_VERSION,
  projectRelationshipState,
  type RelationshipState,
} from "./relationship-engine";

function words(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

function overlap(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  return [...a].filter((word) => b.has(word)).length / Math.max(1, Math.min(a.size, b.size));
}

function requireFields(input: RelationshipEventInput) {
  const payload = input.payload;
  if (
    (input.kind === "boundary" || input.kind === "shared_reference") &&
    input.source !== "user_explicit"
  ) {
    throw new Error(`relationship event: ${input.kind} requires explicit user authority`);
  }
  if (
    input.kind === "repair_outcome" &&
    (payload.repairOutcome === "accepted" || payload.repairOutcome === "rejected") &&
    input.source !== "user_explicit"
  ) {
    throw new Error("relationship event: user acceptance or rejection requires explicit user authority");
  }
  if (input.kind === "agent_promise" && !payload.action) {
    throw new Error("relationship event: agent_promise requires payload.action");
  }
  if (input.kind === "promise_outcome" && !payload.promiseOutcome) {
    throw new Error("relationship event: promise_outcome requires payload.promiseOutcome");
  }
  if (input.kind === "boundary" && !payload.rule) {
    throw new Error("relationship event: boundary requires payload.rule");
  }
  if (
    input.kind === "interaction_feedback" &&
    ((!payload.dimension || !payload.direction) && (!payload.targetId || !payload.outcome))
  ) {
    throw new Error("relationship event: interaction_feedback requires a dialect direction or a targeted outcome");
  }
  if (input.kind === "repair_outcome" && !payload.repairOutcome) {
    throw new Error("relationship event: repair_outcome requires payload.repairOutcome");
  }
  if (input.kind === "humor_episode" && (!payload.humorRole || !payload.reference)) {
    throw new Error("relationship event: humor_episode requires humorRole and reference");
  }
  if (input.kind === "shared_reference" && !payload.reference) {
    throw new Error("relationship event: shared_reference requires reference");
  }
  if (input.source === "recall_observed" && payload.explicit) {
    throw new Error("relationship event: Recall observations cannot claim explicit user authority");
  }
}

function latestOpenPromise(state: RelationshipState) {
  return [...state.promises].reverse().find((promise) => promise.status === "open") ?? null;
}

function currentRupture(state: RelationshipState) {
  return state.rupture.status === "open" || state.rupture.status === "repairing"
    ? state.rupture.ruptureEventId
    : null;
}

function matchingArtifact(state: RelationshipState, reference: string | null) {
  if (!reference) return null;
  return [...state.humor]
    .map((artifact) => ({ artifact, score: overlap(reference, `${artifact.reference} ${artifact.theme}`) }))
    .sort((left, right) => right.score - left.score || left.artifact.id.localeCompare(right.artifact.id))
    .find((item) => item.score >= 0.5)?.artifact ?? null;
}

function normalizeTargets(input: RelationshipEventInput, state: RelationshipState): RelationshipEventInput {
  const payload = { ...input.payload };
  if (input.source === "user_explicit") payload.explicit = true;
  if (input.kind === "promise_outcome" && !payload.targetId) {
    payload.targetId = latestOpenPromise(state)?.id ?? null;
  }
  if ((input.kind === "repair_attempt" || input.kind === "repair_outcome") && !payload.targetId) {
    payload.targetId = currentRupture(state);
  }
  if (
    (input.kind === "shared_reference" ||
      (input.kind === "humor_episode" && payload.humorRole !== "seed")) &&
    !payload.artifactId
  ) {
    payload.artifactId = matchingArtifact(state, payload.reference)?.id ?? null;
  }
  if (input.kind === "promise_outcome" && !payload.targetId) {
    throw new Error("relationship event: no open Recall promise matched this outcome");
  }
  if ((input.kind === "repair_attempt" || input.kind === "repair_outcome") && !payload.targetId) {
    throw new Error("relationship event: no unresolved rupture matched this repair");
  }
  if (input.kind === "humor_episode" && payload.humorRole !== "seed" && !payload.artifactId) {
    throw new Error("relationship event: no shared humor artifact matched this reference");
  }
  return { ...input, payload };
}

function requireValidTransition(input: RelationshipEventInput, state: RelationshipState) {
  const payload = input.payload;
  if (input.kind === "promise_outcome") {
    const promise = state.promises.find((item) => item.id === payload.targetId);
    if (!promise || promise.status !== "open") {
      throw new Error("relationship event: promise outcome requires the matching open Recall promise");
    }
  }
  if (input.kind === "repair_attempt") {
    const rupture = state.ruptures.find((item) => item.ruptureEventId === payload.targetId);
    if (!rupture || (rupture.status !== "open" && rupture.status !== "repairing")) {
      throw new Error("relationship event: repair attempt requires the matching unresolved rupture");
    }
  }
  if (input.kind === "repair_outcome") {
    const rupture = state.ruptures.find((item) => item.ruptureEventId === payload.targetId);
    if (!rupture || rupture.status !== "repairing") {
      throw new Error("relationship event: repair outcome requires a recorded repair attempt");
    }
  }
  if (input.kind === "humor_episode" && payload.humorRole === "recall_callback") {
    const artifact = state.humor.find((item) => item.id === payload.artifactId);
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const explicitNegativeOutcome = input.source === "user_explicit" && payload.outcome === "negative";
    if (
      !artifact ||
      (!explicitNegativeOutcome &&
        (artifact.status !== "shared" ||
          artifact.negativeSignals > 0 ||
          (artifact.cooldownUntil && artifact.cooldownUntil > occurredAt)))
    ) {
      throw new Error("relationship event: callback requires an eligible shared reference outside cooldown");
    }
  }
  if (input.kind === "interaction_feedback" && payload.targetId && payload.outcome) {
    const artifact = state.humor.find((item) => item.id === payload.targetId);
    if (!artifact) {
      throw new Error("relationship event: targeted feedback requires the matching humor artifact");
    }
  }
}

export function rebuildRelationshipState(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  at = new Date().toISOString(),
) {
  const state = projectRelationshipState(
    ledger.listRelationshipEvents({ userId, space, limit: 10_000 }),
    userId,
    space,
    at,
  );
  ledger.replaceRelationshipState(state);
  return state;
}

export function loadRelationshipState(options: {
  ledger?: MemoryEventLedger;
  userId?: string;
  space: MemorySpace;
  at?: string;
}) {
  const ledger = options.ledger ?? getMemoryEventLedger();
  return rebuildRelationshipState(
    ledger,
    options.userId ?? "local-user",
    options.space,
    options.at,
  );
}

export function recordRelationshipEvent(
  value: unknown,
  dependencies: { ledger?: MemoryEventLedger } = {},
): { event: RelationshipEvent; state: RelationshipState } {
  const ledger = dependencies.ledger ?? getMemoryEventLedger();
  const parsed = RelationshipEventInputSchema.parse(value);
  requireFields(parsed);
  const current = loadRelationshipState({
    ledger,
    userId: parsed.userId,
    space: parsed.space,
    at: parsed.occurredAt,
  });
  const input = normalizeTargets(parsed, current);
  requireValidTransition(input, current);
  const event = ledger.appendRelationshipEvent(input, RECALL_PERSONA_VERSION);
  const state = rebuildRelationshipState(
    ledger,
    input.userId,
    input.space,
    input.occurredAt ?? event.occurredAt,
  );
  return { event, state };
}

export function deleteRelationshipEventAndRebuild(options: {
  id: string;
  userId?: string;
  space: MemorySpace;
  ledger?: MemoryEventLedger;
}) {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const deleted = ledger.deleteRelationshipEvent(options.id, options.userId ?? "local-user", options.space);
  const state = rebuildRelationshipState(ledger, deleted.userId, deleted.space);
  return { deleted, state };
}
