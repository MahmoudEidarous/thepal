import { z } from "zod";

// Phase 0 freezes the language shared by every later memory layer. These
// values are persisted, so additions are fine but renames require a migration.
export const MEMORY_CONTRACT_VERSION = 1 as const;
export const MEMORY_SCHEMA_VERSION = 1 as const;

export const MEMORY_SPACES = ["personal", "work", "health", "eval"] as const;
export const EVENT_KINDS = [
  "utterance",
  "document_quote",
  "observation",
  "correction",
  "consent",
  "deletion",
] as const;
export const TRUST_TIERS = [
  "user_direct",
  "user_approved",
  "recall_observation",
  "tool_output",
  "external_content",
] as const;
export const SOURCE_ACTORS = ["user", "recall", "tool", "external"] as const;
export const SOURCE_CHANNELS = [
  "voice",
  "text",
  "document",
  "agent",
  "tool",
  "web",
  "unknown",
] as const;
export const SENSITIVITIES = ["normal", "sensitive", "restricted"] as const;
export const REQUESTED_MEMORY_KINDS = [
  "memory",
  "decision",
  "commitment",
  "briefing",
] as const;
export const CLAIM_MODALITIES = ["asserted", "hedged", "inferred"] as const;
export const CLAIM_RELATION_HINTS = ["assert", "supersede", "retract"] as const;
export const CLAIM_RELATIONS = [
  "supports",
  "extends",
  "contradicts",
  "supersedes",
  "unrelated",
] as const;
export const BELIEF_STATUSES = ["current", "historical", "conflicting", "unknown"] as const;
export const CONFIDENCE_BANDS = ["direct", "strong", "tentative", "conflicting"] as const;
export const LIFE_THREAD_KINDS = [
  "decision",
  "project",
  "relationship",
  "health",
  "place",
  "routine",
  "goal",
  "problem",
  "waiting",
] as const;
export const LIFE_THREAD_STATUSES = [
  "emerging",
  "open",
  "waiting",
  "blocked",
  "resolved",
  "dormant",
] as const;
export const THREAD_TRANSITION_KINDS = [
  "created",
  "state_updated",
  "status_changed",
  "became_dormant",
] as const;
export const THREAD_COMMITMENT_STATUSES = [
  "open",
  "done",
  "cancelled",
  "superseded",
] as const;
export const PROSPECTIVE_OPERATIONS = [
  "create",
  "fire",
  "resolve",
  "cancel",
  "snooze",
] as const;
export const PROSPECTIVE_STATUSES = ["open", "done", "cancelled"] as const;
export const PROSPECTIVE_OUTCOMES = ["fired", "resolved", "cancelled"] as const;

const InstantSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), {
  message: "expected an ISO-compatible instant",
});

export const MemorySpaceSchema = z.enum(MEMORY_SPACES);
export const EventKindSchema = z.enum(EVENT_KINDS);
export const TrustTierSchema = z.enum(TRUST_TIERS);
export const SourceActorSchema = z.enum(SOURCE_ACTORS);
export const SourceChannelSchema = z.enum(SOURCE_CHANNELS);
export const SensitivitySchema = z.enum(SENSITIVITIES);
export const RequestedMemoryKindSchema = z.enum(REQUESTED_MEMORY_KINDS);
export const ClaimModalitySchema = z.enum(CLAIM_MODALITIES);
export const ClaimRelationHintSchema = z.enum(CLAIM_RELATION_HINTS);
export const ClaimRelationSchema = z.enum(CLAIM_RELATIONS);
export const BeliefStatusSchema = z.enum(BELIEF_STATUSES);
export const ConfidenceBandSchema = z.enum(CONFIDENCE_BANDS);
export const LifeThreadKindSchema = z.enum(LIFE_THREAD_KINDS);
export const LifeThreadStatusSchema = z.enum(LIFE_THREAD_STATUSES);
export const ThreadTransitionKindSchema = z.enum(THREAD_TRANSITION_KINDS);
export const ThreadCommitmentStatusSchema = z.enum(THREAD_COMMITMENT_STATUSES);
export const ProspectiveOperationSchema = z.enum(PROSPECTIVE_OPERATIONS);
export const ProspectiveStatusSchema = z.enum(PROSPECTIVE_STATUSES);
export const ProspectiveOutcomeSchema = z.enum(PROSPECTIVE_OUTCOMES);

export const TimeRangeSchema = z
  .object({
    start: z.string().min(4).max(40),
    end: z.string().min(4).max(40).nullable(),
    precision: z.enum(["instant", "day", "month", "year", "interval"]),
  })
  .refine((range) => range.end === null || range.start <= range.end, {
    message: "time range must end after it starts",
  });

export const EntityRefSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["user", "person", "place", "project", "routine", "organization", "thing"]),
  label: z.string().min(1).max(300),
});

export const TypedValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: z.string().max(20_000) }),
  z.object({ type: z.literal("number"), value: z.number().finite() }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("date"), value: z.string().min(4).max(40) }),
  z.object({ type: z.literal("entity"), value: EntityRefSchema }),
]);

export const ApplicabilityScopeSchema = z.object({
  space: MemorySpaceSchema,
  contexts: z.array(z.string().min(1).max(120)).max(20).default([]),
});

export const CaptureRequestSchema = z.object({
  content: z.string().trim().min(1).max(256_000),
  space: MemorySpaceSchema.default("personal"),
  source: z.string().trim().min(1).max(200).default("recall-app"),
  kind: RequestedMemoryKindSchema.default("memory"),
  due: z.string().trim().max(64).optional(),
  userId: z.string().trim().min(1).max(120).default("local-user"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const CorrectionRequestSchema = z.object({
  targetEventId: z.string().uuid(),
  content: z.string().trim().min(1).max(256_000),
  source: z.string().trim().min(1).max(200).default("recall-app#correction"),
  userId: z.string().trim().min(1).max(120).default("local-user"),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const ProspectiveEvidenceSchema = z.object({
  operation: ProspectiveOperationSchema,
  triggerId: z.string().uuid().nullable().default(null),
  topic: z.string().trim().min(1).max(120).nullable().default(null),
  action: z.string().trim().min(1).max(300).nullable().default(null),
  firePolicy: z.literal("once").default("once"),
  until: InstantSchema.nullable().default(null),
  reason: z.string().trim().min(1).max(500).nullable().default(null),
  sourceEventId: z.string().uuid().nullable().default(null),
  providerExternalId: z.string().trim().min(1).max(500).nullable().default(null),
});

export const CaptureEvidencePayloadSchema = z.object({
  content: z.string().min(1).max(256_000),
  redacted: z.boolean(),
  legacySource: z.string().min(1).max(200),
  requested: z.object({
    kind: RequestedMemoryKindSchema,
    due: z.string().max(64).nullable(),
  }),
  prospective: ProspectiveEvidenceSchema.optional(),
});

export const ProspectiveMemorySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1).max(120),
  space: MemorySpaceSchema,
  createEventId: z.string().uuid(),
  lastEventId: z.string().uuid(),
  topic: z.string().min(1).max(120),
  action: z.string().min(1).max(300),
  firePolicy: z.literal("once"),
  status: ProspectiveStatusSchema,
  outcome: ProspectiveOutcomeSchema.nullable(),
  snoozedUntil: InstantSchema.nullable(),
  createdAt: InstantSchema,
  firedAt: InstantSchema.nullable(),
  providerExternalId: z.string().min(1).max(500).nullable(),
  evidenceEventIds: z.array(z.string().uuid()).min(1).max(1_000),
  projectorVersion: z.string().min(1).max(120),
});

export const MemorySourceSchema = z.object({
  actor: SourceActorSchema,
  channel: SourceChannelSchema,
  trust: TrustTierSchema,
  label: z.string().min(1).max(200),
});

export const MemoryEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  space: MemorySpaceSchema,
  kind: EventKindSchema,
  payload: CaptureEvidencePayloadSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: MemorySourceSchema,
  sensitivity: SensitivitySchema,
  recordedAt: InstantSchema,
  revisionOf: z.string().uuid().nullable(),
  tombstonedAt: InstantSchema.nullable(),
  contractVersion: z.literal(MEMORY_CONTRACT_VERSION),
});

export const MemoryReceiptSchema = z.object({
  eventId: z.string().uuid(),
  jobId: z.string().uuid(),
  projectionJobId: z.string().uuid().optional(),
  recordedAt: InstantSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  contractVersion: z.literal(MEMORY_CONTRACT_VERSION),
  duplicate: z.boolean(),
});

// Phase 0 freezes these projection contracts before their Phase 2 tables and
// projectors exist. Claims remain evidence-local; beliefs are rebuildable views.
export const MemoryClaimSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  subject: EntityRefSchema,
  predicate: z.string().min(1).max(200),
  object: TypedValueSchema,
  polarity: z.union([z.literal(1), z.literal(-1)]),
  modality: ClaimModalitySchema,
  relationHint: ClaimRelationHintSchema.default("assert"),
  validTime: TimeRangeSchema.nullable(),
  scope: ApplicabilityScopeSchema,
  extractorVersion: z.string().min(1).max(120),
});

export const BeliefSchema = z.object({
  key: z.string().min(1).max(500),
  subject: EntityRefSchema,
  predicate: z.string().min(1).max(200),
  value: TypedValueSchema,
  polarity: z.union([z.literal(1), z.literal(-1)]),
  status: BeliefStatusSchema,
  confidence: ConfidenceBandSchema,
  validTime: TimeRangeSchema,
  systemTime: TimeRangeSchema,
  scope: ApplicabilityScopeSchema,
  support: z.array(z.string().uuid()).min(1),
  opposition: z.array(z.string().uuid()).default([]),
  projectorVersion: z.string().min(1).max(120),
});

export const GroundedThreadTextSchema = z.object({
  text: z.string().min(1).max(2_000),
  beliefKeys: z.array(z.string().min(1).max(500)).max(20_000),
  evidenceEventIds: z.array(z.string().uuid()).min(1).max(20_000),
  confidence: ConfidenceBandSchema,
});

export const ThreadCommitmentRefSchema = z.object({
  eventId: z.string().uuid(),
  content: z.string().min(1).max(2_000),
  due: z.string().min(4).max(64).nullable(),
  status: ThreadCommitmentStatusSchema,
  closedByEventId: z.string().uuid().nullable(),
});

export const ThreadExpectedNextSchema = z.object({
  event: z.string().min(1).max(1_000),
  by: TimeRangeSchema.nullable(),
  evidenceEventIds: z.array(z.string().uuid()).min(1).max(20_000),
});

export const ThreadResolutionSchema = z.object({
  eventId: z.string().uuid(),
  reason: z.string().min(1).max(1_000),
  resolvedAt: InstantSchema,
});

export const LifeThreadSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1).max(120),
  space: MemorySpaceSchema,
  anchorKey: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  kind: LifeThreadKindSchema,
  status: LifeThreadStatusSchema,
  currentState: GroundedThreadTextSchema,
  participants: z.array(EntityRefSchema).max(100),
  commitments: z.array(ThreadCommitmentRefSchema).max(100),
  expectedNext: ThreadExpectedNextSchema.nullable(),
  lastMeaningfulChangeAt: InstantSchema,
  nextReviewAt: InstantSchema.nullable(),
  evidenceEventIds: z.array(z.string().uuid()).min(1).max(20_000),
  beliefKeys: z.array(z.string().min(1).max(500)).min(1).max(20_000),
  resolution: ThreadResolutionSchema.nullable(),
  confidence: ConfidenceBandSchema,
  projectorVersion: z.string().min(1).max(120),
});

export const ThreadTransitionSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  kind: ThreadTransitionKindSchema,
  fromStatus: LifeThreadStatusSchema.nullable(),
  toStatus: LifeThreadStatusSchema,
  at: InstantSchema,
  reason: z.string().min(1).max(1_000),
  state: z.string().min(1).max(2_000),
  evidenceEventIds: z.array(z.string().uuid()).min(1).max(20_000),
  projectorVersion: z.string().min(1).max(120),
});

export type MemorySpace = z.infer<typeof MemorySpaceSchema>;
export type EventKind = z.infer<typeof EventKindSchema>;
export type TrustTier = z.infer<typeof TrustTierSchema>;
export type SourceActor = z.infer<typeof SourceActorSchema>;
export type SourceChannel = z.infer<typeof SourceChannelSchema>;
export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type RequestedMemoryKind = z.infer<typeof RequestedMemoryKindSchema>;
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;
export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;
export type CaptureEvidencePayload = z.infer<typeof CaptureEvidencePayloadSchema>;
export type MemorySource = z.infer<typeof MemorySourceSchema>;
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;
export type MemoryReceipt = z.infer<typeof MemoryReceiptSchema>;
export type ClaimModality = z.infer<typeof ClaimModalitySchema>;
export type ClaimRelationHint = z.infer<typeof ClaimRelationHintSchema>;
export type ClaimRelation = z.infer<typeof ClaimRelationSchema>;
export type BeliefStatus = z.infer<typeof BeliefStatusSchema>;
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;
export type LifeThreadKind = z.infer<typeof LifeThreadKindSchema>;
export type LifeThreadStatus = z.infer<typeof LifeThreadStatusSchema>;
export type ThreadTransitionKind = z.infer<typeof ThreadTransitionKindSchema>;
export type ThreadCommitmentStatus = z.infer<typeof ThreadCommitmentStatusSchema>;
export type ProspectiveOperation = z.infer<typeof ProspectiveOperationSchema>;
export type ProspectiveStatus = z.infer<typeof ProspectiveStatusSchema>;
export type ProspectiveOutcome = z.infer<typeof ProspectiveOutcomeSchema>;
export type TimeRange = z.infer<typeof TimeRangeSchema>;
export type EntityRef = z.infer<typeof EntityRefSchema>;
export type TypedValue = z.infer<typeof TypedValueSchema>;
export type ApplicabilityScope = z.infer<typeof ApplicabilityScopeSchema>;
export type MemoryClaim = z.infer<typeof MemoryClaimSchema>;
export type Belief = z.infer<typeof BeliefSchema>;
export type GroundedThreadText = z.infer<typeof GroundedThreadTextSchema>;
export type ThreadCommitmentRef = z.infer<typeof ThreadCommitmentRefSchema>;
export type ThreadExpectedNext = z.infer<typeof ThreadExpectedNextSchema>;
export type ThreadResolution = z.infer<typeof ThreadResolutionSchema>;
export type LifeThread = z.infer<typeof LifeThreadSchema>;
export type ThreadTransition = z.infer<typeof ThreadTransitionSchema>;
export type ProspectiveEvidence = z.infer<typeof ProspectiveEvidenceSchema>;
export type ProspectiveMemory = z.infer<typeof ProspectiveMemorySchema>;
