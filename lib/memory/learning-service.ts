import { randomUUID } from "node:crypto";
import type { MemorySpace } from "./contracts";
import {
  getMemoryEventLedger,
  type AttentionOutcomeRecord,
  type AttentionOutcomeSignal,
  type MemoryConsolidationRun,
  type MemoryEventLedger,
} from "./event-ledger";
import {
  LEARNING_PROJECTOR_VERSION,
  projectAttentionLearningProfile,
  projectMemoryAssociations,
  type AttentionLearningProfile,
} from "./learning-engine";
import { recordRelationshipEvent } from "./relationship-service";

const SIGNAL_VALUE: Record<
  AttentionOutcomeSignal,
  { reward: number; confidence: number; source: AttentionOutcomeRecord["source"] }
> = {
  engaged: { reward: 0.65, confidence: 0.8, source: "system_observed" },
  laughter: { reward: 0.45, confidence: 0.6, source: "system_observed" },
  silence: { reward: -0.08, confidence: 0.15, source: "system_observed" },
  ignored: { reward: -0.12, confidence: 0.3, source: "system_observed" },
  interrupted: { reward: -0.45, confidence: 0.65, source: "system_observed" },
  dismissed: { reward: -0.8, confidence: 0.9, source: "system_observed" },
  resolved: { reward: 0.9, confidence: 1, source: "system_observed" },
  explicit_positive: { reward: 1, confidence: 1, source: "user_explicit" },
  explicit_negative: { reward: -1, confidence: 1, source: "user_explicit" },
};

function isSignal(value: unknown): value is AttentionOutcomeSignal {
  return typeof value === "string" && value in SIGNAL_VALUE;
}

function cleanIdempotency(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 200);
  return cleaned || null;
}

function surfaceFromDecision(decision: Record<string, unknown>) {
  const surface = decision.surface;
  if (!surface || typeof surface !== "object") return null;
  return surface as Record<string, unknown>;
}

function profileFor(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  at = new Date().toISOString(),
) {
  const profile = projectAttentionLearningProfile({
    outcomes: ledger.listAttentionOutcomes({ userId, space, limit: 20_000 }),
    userId,
    space,
    at,
  });
  ledger.replaceAttentionProfile(
    userId,
    space,
    profile.projectorVersion,
    profile as unknown as Record<string, unknown>,
    at,
  );
  return profile;
}

function recordHumorOutcome(
  ledger: MemoryEventLedger,
  outcome: AttentionOutcomeRecord,
  sourceItemId: unknown,
) {
  if (outcome.candidateKind !== "humor_callback" || typeof sourceItemId !== "string") return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceItemId)) return;
  const positive = outcome.signal === "laughter" || outcome.signal === "engaged" || outcome.signal === "resolved";
  const negative = outcome.signal === "dismissed" || outcome.signal === "explicit_negative";
  if (!positive && !negative) return;
  recordRelationshipEvent(
    {
      userId: outcome.userId,
      space: outcome.space,
      sessionId: null,
      kind: "interaction_feedback",
      source: outcome.source === "user_explicit" ? "user_explicit" : "system_outcome",
      sensitivity: "normal",
      payload: {
        summary: `outcome for surfaced humor callback ${outcome.decisionId}`,
        targetId: sourceItemId,
        outcome: positive ? "positive" : "negative",
        explicit: outcome.source === "user_explicit",
      },
      evidenceEventIds: [],
      occurredAt: outcome.occurredAt,
      idempotencyKey: `attention-outcome:${outcome.id}`,
    },
    { ledger },
  );
}

export function recordAttentionOutcome(
  value: unknown,
  dependencies: { ledger?: MemoryEventLedger } = {},
): { outcome: AttentionOutcomeRecord; profile: AttentionLearningProfile } {
  const ledger = dependencies.ledger ?? getMemoryEventLedger();
  if (!value || typeof value !== "object") throw new Error("attention outcome: expected an object");
  const input = value as Record<string, unknown>;
  if (typeof input.decisionId !== "string") throw new Error("attention outcome: decisionId is required");
  if (!isSignal(input.signal)) throw new Error("attention outcome: unsupported signal");
  const decision = ledger.getAttentionDecision(input.decisionId);
  if (!decision || !decision.shouldSurface) {
    throw new Error("attention outcome: only an actually surfaced decision can receive an outcome");
  }
  const surface = surfaceFromDecision(decision.decision);
  if (!surface || typeof surface.id !== "string" || typeof surface.kind !== "string") {
    throw new Error("attention outcome: surfaced candidate trace is unavailable");
  }
  const occurredAt = typeof input.occurredAt === "string" && Number.isFinite(Date.parse(input.occurredAt))
    ? input.occurredAt
    : new Date().toISOString();
  const configured = SIGNAL_VALUE[input.signal];
  const requestedSource = input.source === "user_explicit" ? "user_explicit" : "system_observed";
  if (configured.source === "user_explicit" && requestedSource !== "user_explicit") {
    throw new Error("attention outcome: explicit feedback requires explicit user authority");
  }
  if (
    requestedSource === "system_observed" &&
    Date.parse(occurredAt) - Date.parse(decision.createdAt) > 30 * 60_000
  ) {
    throw new Error("attention outcome: an automatic signal cannot be attached to an old turn");
  }
  const idempotencyKey = cleanIdempotency(input.idempotencyKey) ?? `${decision.id}:${input.signal}`;
  const outcome = ledger.recordAttentionOutcome({
    decisionId: decision.id,
    userId: decision.userId,
    space: decision.space,
    candidateId: surface.id,
    candidateKind: surface.kind,
    cooldownKey:
      typeof surface.cooldownKey === "string"
        ? surface.cooldownKey
        : decision.cooldownKey ?? decision.selectedCandidateId ?? decision.id,
    momentKind: decision.momentKind,
    signal: input.signal,
    reward: configured.reward,
    confidence: configured.confidence,
    source: requestedSource,
    occurredAt,
    idempotencyKey,
  });
  recordHumorOutcome(ledger, outcome, surface.sourceItemId);
  return {
    outcome,
    profile: profileFor(ledger, decision.userId, decision.space, occurredAt),
  };
}

export function loadAttentionLearningProfile(options: {
  ledger?: MemoryEventLedger;
  userId?: string;
  space: MemorySpace;
  at?: string;
}) {
  return profileFor(
    options.ledger ?? getMemoryEventLedger(),
    options.userId ?? "local-user",
    options.space,
    options.at,
  );
}

export function readAttentionLearningProfile(options: {
  ledger?: MemoryEventLedger;
  userId?: string;
  space: MemorySpace;
  at?: string;
}) {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const userId = options.userId ?? "local-user";
  const stored = ledger.getAttentionProfile(userId, options.space);
  if (stored?.projectorVersion === LEARNING_PROJECTOR_VERSION) {
    return stored.profile as unknown as AttentionLearningProfile;
  }
  return profileFor(ledger, userId, options.space, options.at);
}

export function runMemoryConsolidation(options: {
  ledger?: MemoryEventLedger;
  userId?: string;
  space: MemorySpace;
  trigger?: MemoryConsolidationRun["trigger"];
  at?: string;
  force?: boolean;
}) {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const userId = options.userId ?? "local-user";
  const at = options.at ?? new Date().toISOString();
  const trigger = options.trigger ?? "scheduled";
  const latest = ledger.listConsolidationRuns({ userId, space: options.space, limit: 1 })[0];
  const fresh = latest?.status === "completed" && Date.parse(at) - Date.parse(latest.completedAt) < 6 * 60 * 60_000;
  const evidenceChanged = latest
    ? ledger
        .listActiveEvents(userId, options.space)
        .some((event) => event.recordedAt > latest.completedAt)
    : true;
  if (fresh && !evidenceChanged && !options.force) {
    const skipped: MemoryConsolidationRun = {
      id: randomUUID(),
      userId,
      space: options.space,
      projectorVersion: LEARNING_PROJECTOR_VERSION,
      trigger,
      status: "skipped",
      startedAt: at,
      completedAt: at,
      metrics: { reason: "fresh_projection", ageMs: Math.max(0, Date.parse(at) - Date.parse(latest.completedAt)) },
      idempotencyKey: `skip:${trigger}:${at}`,
    };
    return { run: ledger.recordConsolidationRun(skipped), profile: null, associations: null };
  }
  const startedAt = at;
  const profile = profileFor(ledger, userId, options.space, at);
  const associations = projectMemoryAssociations({
    evidence: ledger.listClaimEvidence(userId, options.space),
    userId,
    space: options.space,
    at,
  });
  ledger.replaceAssociations(userId, options.space, associations, at);
  const completedAt = new Date(Math.max(Date.now(), Date.parse(at))).toISOString();
  const run: MemoryConsolidationRun = {
    id: randomUUID(),
    userId,
    space: options.space,
    projectorVersion: LEARNING_PROJECTOR_VERSION,
    trigger,
    status: "completed",
    startedAt,
    completedAt,
    metrics: {
      outcomesReviewed: profile.totalOutcomes,
      associationsProjected: associations.length,
      activeAssociations: associations.filter((association) => association.status === "active").length,
      emergingAssociations: associations.filter((association) => association.status === "emerging").length,
      staleAssociations: associations.filter((association) => association.status === "stale").length,
    },
    idempotencyKey: `run:${trigger}:${at}`,
  };
  return { run: ledger.recordConsolidationRun(run), profile, associations };
}
