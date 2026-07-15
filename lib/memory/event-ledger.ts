import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  Belief,
  CaptureEvidencePayload,
  ClaimRelation,
  EventKind,
  LifeThread,
  MemoryClaim,
  MemoryEvent,
  MemoryReceipt,
  MemorySource,
  MemorySpace,
  ProspectiveMemory,
  RelationshipEvent,
  RelationshipEventInput,
  Sensitivity,
  ThreadTransition,
} from "./contracts";
import type { RelationshipState } from "./relationship-engine";

type SqliteModule = typeof import("node:sqlite");
type SqliteDatabase = InstanceType<SqliteModule["DatabaseSync"]>;

// Turbopack's dev runtime externalizes `node:sqlite` through `require`, while
// its app-route chunk is ESM. Node's synchronous built-in lookup avoids that
// interop edge and still gives us the native module without another package.
function sqliteConstructor(): SqliteModule["DatabaseSync"] {
  const getBuiltinModule = (
    process as typeof process & {
      getBuiltinModule?: (id: "node:sqlite") => SqliteModule | undefined;
    }
  ).getBuiltinModule;
  if (!getBuiltinModule) {
    throw new Error("Recall's memory ledger requires Node.js 22.5 or newer");
  }
  const sqlite = getBuiltinModule("node:sqlite");
  if (!sqlite) throw new Error("This Node.js runtime does not provide the built-in SQLite module");
  return sqlite.DatabaseSync;
}

const CONTRACT_VERSION = 1 as const;
const SCHEMA_VERSION = 7 as const;
const MAX_JOB_ATTEMPTS = 5;
const PROCESSING_JOB_KIND = "enrich_and_index" as const;

type SqlRow = Record<string, null | number | bigint | string | Uint8Array>;

export type MemoryJobStatus = "pending" | "processing" | "succeeded" | "dead";
export type MemoryStateJobKind = "extract_and_project" | "purge_mirror";

export type MemoryJob = {
  id: string;
  eventId: string;
  kind: typeof PROCESSING_JOB_KIND;
  status: MemoryJobStatus;
  attempts: number;
  availableAt: string;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryMirror = {
  eventId: string;
  provider: "supermemory";
  externalId: string;
  payloadHash: string;
  status: "synced" | "deleted";
  syncedAt: string;
  lastError: string | null;
};

export type MemoryStateJob = {
  id: string;
  eventId: string;
  kind: MemoryStateJobKind;
  status: MemoryJobStatus;
  attempts: number;
  availableAt: string;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClaimEvidence = {
  claim: MemoryClaim;
  userId: string;
  space: MemorySpace;
  eventKind: EventKind;
  trust: MemorySource["trust"];
  actor: MemorySource["actor"];
  recordedAt: string;
  revisionOf: string | null;
};

export type StoredClaimRelation = {
  fromClaimId: string;
  toClaimId: string;
  relation: ClaimRelation;
  reason: string;
  projectorVersion: string;
};

export type DeletionPreview = {
  token: string;
  eventId: string;
  excerpt: string;
  expiresAt: string;
  claims: number;
  affectedBeliefs: string[];
  affectedThreads: string[];
  affectedProspective: string[];
  affectedAttention: number;
  affectedRelationship: number;
  mirrored: boolean;
};

export type AttentionDecisionRecord = {
  id: string;
  userId: string;
  space: MemorySpace;
  sessionId: string;
  engineVersion: string;
  mode: "shadow" | "guarded" | "active";
  momentKind: "session_start" | "user_turn" | "lull";
  selectedCandidateId: string | null;
  selectedKind: string | null;
  selectedAction: string | null;
  selectedScore: number | null;
  cooldownKey: string | null;
  shouldSurface: boolean;
  silenceReason: string | null;
  decision: Record<string, unknown>;
  evidenceEventIds: string[];
  relationshipEventIds: string[];
  createdAt: string;
};

export type RecordAttentionDecisionInput = Omit<
  AttentionDecisionRecord,
  "evidenceEventIds" | "relationshipEventIds"
> & {
  evidenceEventIds?: string[];
  relationshipEventIds?: string[];
};

export type AttentionOutcomeSignal =
  | "engaged"
  | "laughter"
  | "silence"
  | "ignored"
  | "interrupted"
  | "dismissed"
  | "resolved"
  | "explicit_positive"
  | "explicit_negative";

export type AttentionOutcomeRecord = {
  id: string;
  decisionId: string;
  userId: string;
  space: MemorySpace;
  candidateId: string;
  candidateKind: string;
  cooldownKey: string;
  momentKind: AttentionDecisionRecord["momentKind"];
  signal: AttentionOutcomeSignal;
  reward: number;
  confidence: number;
  source: "system_observed" | "user_explicit";
  occurredAt: string;
  idempotencyKey: string;
};

export type MemoryAssociationRecord = {
  id: string;
  userId: string;
  space: MemorySpace;
  subjectId: string;
  subjectKind: string;
  subjectLabel: string;
  outcomeKind: "emotion" | "decision" | "status";
  outcomeValue: string;
  status: "emerging" | "active" | "stale";
  confidence: number;
  observations: number;
  evidenceEventIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  projectorVersion: string;
  updatedAt: string;
};

export type MemoryConsolidationRun = {
  id: string;
  userId: string;
  space: MemorySpace;
  projectorVersion: string;
  trigger: "manual" | "session" | "scheduled" | "outcome";
  status: "completed" | "skipped";
  startedAt: string;
  completedAt: string;
  metrics: Record<string, number | string | boolean>;
  idempotencyKey: string;
};

export type TombstoneResult = {
  event: MemoryEvent;
  mirror: MemoryMirror | null;
  purgeJob: MemoryStateJob | null;
};

export type AppendEventInput = {
  userId: string;
  space: MemorySpace;
  kind: EventKind;
  payload: CaptureEvidencePayload;
  source: MemorySource;
  sensitivity: Sensitivity;
  revisionOf?: string | null;
  idempotencyKey?: string;
  recordedAt?: string;
};

export type AppendEventResult = {
  event: MemoryEvent;
  job: MemoryJob;
  stateJob: MemoryStateJob;
  receipt: MemoryReceipt;
};

export type LedgerStats = {
  databasePath: string;
  schemaVersion: number;
  integrity: string;
  events: number;
  jobs: Record<MemoryJobStatus, number>;
  stateJobs: Record<MemoryJobStatus, number>;
  claims: number;
  beliefs: number;
  threads: number;
  threadTransitions: number;
  prospective: number;
  attentionDecisions: number;
  attentionOutcomes: number;
  attentionProfiles: number;
  associations: number;
  consolidationRuns: number;
  relationshipEvents: number;
  relationshipStates: number;
  mirrors: number;
};

const MIGRATION_1 = `
  CREATE TABLE IF NOT EXISTS memory_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    kind TEXT NOT NULL CHECK (kind IN ('utterance','document_quote','observation','correction','consent','deletion')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
    source_actor TEXT NOT NULL CHECK (source_actor IN ('user','recall','tool','external')),
    source_channel TEXT NOT NULL CHECK (source_channel IN ('voice','text','document','agent','tool','web','unknown')),
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ('user_direct','user_approved','recall_observation','tool_output','external_content')),
    source_label TEXT NOT NULL,
    sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal','sensitive','restricted')),
    recorded_at TEXT NOT NULL,
    revision_of TEXT REFERENCES memory_events(id),
    tombstoned_at TEXT,
    contract_version INTEGER NOT NULL,
    idempotency_key TEXT,
    UNIQUE(user_id, idempotency_key)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_events_user_time
    ON memory_events(user_id, recorded_at DESC);
  CREATE INDEX IF NOT EXISTS memory_events_space_time
    ON memory_events(space, recorded_at DESC);
  CREATE INDEX IF NOT EXISTS memory_events_revision
    ON memory_events(revision_of) WHERE revision_of IS NOT NULL;

  CREATE TABLE IF NOT EXISTS memory_jobs (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('enrich_and_index')),
    status TEXT NOT NULL CHECK (status IN ('pending','processing','succeeded','dead')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TEXT NOT NULL,
    locked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, kind)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_jobs_due
    ON memory_jobs(status, available_at, created_at);

  CREATE TABLE IF NOT EXISTS memory_mirrors (
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('supermemory')),
    external_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
    status TEXT NOT NULL CHECK (status IN ('synced','deleted')),
    synced_at TEXT NOT NULL,
    last_error TEXT,
    PRIMARY KEY(event_id, provider),
    UNIQUE(provider, external_id)
  ) STRICT;
`;

const MIGRATION_2 = `
  CREATE TABLE IF NOT EXISTS memory_state_jobs (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('extract_and_project','purge_mirror')),
    status TEXT NOT NULL CHECK (status IN ('pending','processing','succeeded','dead')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TEXT NOT NULL,
    locked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(event_id, kind)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_state_jobs_due
    ON memory_state_jobs(status, available_at, created_at);

  CREATE TABLE IF NOT EXISTS memory_claims (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user','person','place','project','routine','organization','thing')),
    subject_label TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_json TEXT NOT NULL CHECK (json_valid(object_json)),
    polarity INTEGER NOT NULL CHECK (polarity IN (-1,1)),
    modality TEXT NOT NULL CHECK (modality IN ('asserted','hedged','inferred')),
    relation_hint TEXT NOT NULL CHECK (relation_hint IN ('assert','supersede','retract')),
    valid_time_json TEXT CHECK (valid_time_json IS NULL OR json_valid(valid_time_json)),
    scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_claims_event ON memory_claims(event_id);
  CREATE INDEX IF NOT EXISTS memory_claims_slot
    ON memory_claims(subject_id, predicate);

  CREATE TABLE IF NOT EXISTS memory_claim_relations (
    from_claim_id TEXT NOT NULL REFERENCES memory_claims(id) ON DELETE CASCADE,
    to_claim_id TEXT NOT NULL REFERENCES memory_claims(id) ON DELETE CASCADE,
    relation TEXT NOT NULL CHECK (relation IN ('supports','extends','contradicts','supersedes','unrelated')),
    reason TEXT NOT NULL,
    projector_version TEXT NOT NULL,
    PRIMARY KEY(from_claim_id, to_claim_id, relation)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_beliefs (
    key TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    subject_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('user','person','place','project','routine','organization','thing')),
    subject_label TEXT NOT NULL,
    predicate TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    polarity INTEGER NOT NULL CHECK (polarity IN (-1,1)),
    status TEXT NOT NULL CHECK (status IN ('current','historical','conflicting','unknown')),
    confidence TEXT NOT NULL CHECK (confidence IN ('direct','strong','tentative','conflicting')),
    valid_time_json TEXT NOT NULL CHECK (json_valid(valid_time_json)),
    system_time_json TEXT NOT NULL CHECK (json_valid(system_time_json)),
    scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
    support_json TEXT NOT NULL CHECK (json_valid(support_json)),
    opposition_json TEXT NOT NULL CHECK (json_valid(opposition_json)),
    projector_version TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_beliefs_current
    ON memory_beliefs(user_id, space, status, subject_id, predicate);

  CREATE TABLE IF NOT EXISTS memory_deletion_consents (
    token TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_deletion_audit (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    executed_at TEXT NOT NULL
  ) STRICT;
`;

const MIGRATION_3 = `
  CREATE TABLE IF NOT EXISTS memory_threads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    anchor_key TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('decision','project','relationship','health','place','routine','goal','problem','waiting')),
    status TEXT NOT NULL CHECK (status IN ('emerging','open','waiting','blocked','resolved','dormant')),
    current_state_json TEXT NOT NULL CHECK (json_valid(current_state_json)),
    participants_json TEXT NOT NULL CHECK (json_valid(participants_json)),
    commitments_json TEXT NOT NULL CHECK (json_valid(commitments_json)),
    expected_next_json TEXT CHECK (expected_next_json IS NULL OR json_valid(expected_next_json)),
    last_meaningful_change_at TEXT NOT NULL,
    next_review_at TEXT,
    evidence_event_ids_json TEXT NOT NULL CHECK (json_valid(evidence_event_ids_json)),
    belief_keys_json TEXT NOT NULL CHECK (json_valid(belief_keys_json)),
    resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
    confidence TEXT NOT NULL CHECK (confidence IN ('direct','strong','tentative','conflicting')),
    projector_version TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, space, anchor_key)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_threads_active
    ON memory_threads(user_id, space, status, last_meaningful_change_at DESC);
  CREATE INDEX IF NOT EXISTS memory_threads_subject
    ON memory_threads(user_id, space, anchor_key);

  CREATE TABLE IF NOT EXISTS memory_thread_transitions (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES memory_threads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('created','state_updated','status_changed','became_dormant')),
    from_status TEXT CHECK (from_status IS NULL OR from_status IN ('emerging','open','waiting','blocked','resolved','dormant')),
    to_status TEXT NOT NULL CHECK (to_status IN ('emerging','open','waiting','blocked','resolved','dormant')),
    occurred_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    state_text TEXT NOT NULL,
    evidence_event_ids_json TEXT NOT NULL CHECK (json_valid(evidence_event_ids_json)),
    projector_version TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_thread_transitions_time
    ON memory_thread_transitions(thread_id, occurred_at, id);
`;

const MIGRATION_4 = `
  CREATE TABLE IF NOT EXISTS memory_prospective_triggers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    create_event_id TEXT NOT NULL REFERENCES memory_events(id) ON DELETE CASCADE,
    last_event_id TEXT NOT NULL REFERENCES memory_events(id),
    topic TEXT NOT NULL,
    action TEXT NOT NULL,
    fire_policy TEXT NOT NULL CHECK (fire_policy = 'once'),
    status TEXT NOT NULL CHECK (status IN ('open','done','cancelled')),
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('fired','resolved','cancelled')),
    snoozed_until TEXT,
    created_at TEXT NOT NULL,
    fired_at TEXT,
    provider_external_id TEXT,
    evidence_event_ids_json TEXT NOT NULL CHECK (json_valid(evidence_event_ids_json)),
    projector_version TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, space, create_event_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_prospective_open
    ON memory_prospective_triggers(user_id, space, status, snoozed_until, created_at);
`;

const MIGRATION_5 = `
  CREATE TABLE IF NOT EXISTS memory_attention_decisions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    session_id TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('shadow','guarded','active')),
    moment_kind TEXT NOT NULL CHECK (moment_kind IN ('session_start','user_turn','lull')),
    selected_candidate_id TEXT,
    selected_kind TEXT,
    selected_action TEXT,
    selected_score INTEGER,
    cooldown_key TEXT,
    should_surface INTEGER NOT NULL CHECK (should_surface IN (0,1)),
    silence_reason TEXT,
    decision_json TEXT NOT NULL CHECK (json_valid(decision_json)),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_attention_user_time
    ON memory_attention_decisions(user_id, space, created_at DESC);
  CREATE INDEX IF NOT EXISTS memory_attention_cooldown
    ON memory_attention_decisions(user_id, space, cooldown_key, should_surface, created_at DESC);

  CREATE TABLE IF NOT EXISTS memory_attention_evidence (
    decision_id TEXT NOT NULL REFERENCES memory_attention_decisions(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES memory_events(id),
    PRIMARY KEY(decision_id, event_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_attention_evidence_event
    ON memory_attention_evidence(event_id, decision_id);
`;

const MIGRATION_6 = `
  CREATE TABLE IF NOT EXISTS memory_relationship_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    session_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN (
      'agent_promise','promise_outcome','recall_mistake','boundary','rupture',
      'repair_attempt','repair_outcome','interaction_feedback','humor_episode','shared_reference'
    )),
    source TEXT NOT NULL CHECK (source IN ('user_explicit','recall_observed','system_outcome')),
    sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal','sensitive','restricted')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    persona_version TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    idempotency_key TEXT,
    UNIQUE(user_id, space, idempotency_key)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_relationship_events_time
    ON memory_relationship_events(user_id, space, occurred_at, id);
  CREATE INDEX IF NOT EXISTS memory_relationship_events_kind
    ON memory_relationship_events(user_id, space, kind, occurred_at DESC);

  CREATE TABLE IF NOT EXISTS memory_relationship_evidence (
    relationship_event_id TEXT NOT NULL REFERENCES memory_relationship_events(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES memory_events(id),
    PRIMARY KEY(relationship_event_id, event_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_relationship_evidence_event
    ON memory_relationship_evidence(event_id, relationship_event_id);

  CREATE TABLE IF NOT EXISTS memory_relationship_state (
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    projector_version TEXT NOT NULL,
    persona_version TEXT NOT NULL,
    state_json TEXT NOT NULL CHECK (json_valid(state_json)),
    projected_at TEXT NOT NULL,
    PRIMARY KEY(user_id, space)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_attention_relationship_evidence (
    decision_id TEXT NOT NULL REFERENCES memory_attention_decisions(id) ON DELETE CASCADE,
    relationship_event_id TEXT NOT NULL REFERENCES memory_relationship_events(id),
    PRIMARY KEY(decision_id, relationship_event_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_attention_relationship_event
    ON memory_attention_relationship_evidence(relationship_event_id, decision_id);
`;

const MIGRATION_7 = `
  CREATE TABLE IF NOT EXISTS memory_attention_outcomes (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL REFERENCES memory_attention_decisions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    candidate_id TEXT NOT NULL,
    candidate_kind TEXT NOT NULL,
    cooldown_key TEXT NOT NULL,
    moment_kind TEXT NOT NULL CHECK (moment_kind IN ('session_start','user_turn','lull')),
    signal TEXT NOT NULL CHECK (signal IN (
      'engaged','laughter','silence','ignored','interrupted','dismissed',
      'resolved','explicit_positive','explicit_negative'
    )),
    reward REAL NOT NULL CHECK (reward >= -1 AND reward <= 1),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    source TEXT NOT NULL CHECK (source IN ('system_observed','user_explicit')),
    occurred_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    UNIQUE(user_id, space, idempotency_key)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_attention_outcomes_scope_time
    ON memory_attention_outcomes(user_id, space, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS memory_attention_outcomes_decision
    ON memory_attention_outcomes(decision_id, occurred_at);

  CREATE TABLE IF NOT EXISTS memory_attention_profiles (
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    projector_version TEXT NOT NULL,
    profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
    projected_at TEXT NOT NULL,
    PRIMARY KEY(user_id, space)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_associations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    subject_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL,
    subject_label TEXT NOT NULL,
    outcome_kind TEXT NOT NULL CHECK (outcome_kind IN ('emotion','decision','status')),
    outcome_value TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('emerging','active','stale')),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    observations INTEGER NOT NULL CHECK (observations >= 2),
    evidence_event_ids_json TEXT NOT NULL CHECK (json_valid(evidence_event_ids_json)),
    first_observed_at TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    projector_version TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_associations_scope_status
    ON memory_associations(user_id, space, status, last_observed_at DESC);

  CREATE TABLE IF NOT EXISTS memory_consolidation_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    space TEXT NOT NULL CHECK (space IN ('personal','work','health','eval')),
    projector_version TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('manual','session','scheduled','outcome')),
    status TEXT NOT NULL CHECK (status IN ('completed','skipped')),
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
    idempotency_key TEXT NOT NULL,
    UNIQUE(user_id, space, idempotency_key)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_consolidation_scope_time
    ON memory_consolidation_runs(user_id, space, completed_at DESC);
`;

function text(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`memory ledger: ${key} is not text`);
  return value;
}

function nullableText(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function integer(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  throw new Error(`memory ledger: ${key} is not numeric`);
}

function hashPayload(payloadJson: string): string {
  return createHash("sha256").update(payloadJson).digest("hex");
}

function resolveDatabasePath(value?: string): string {
  const selected = value?.trim() || process.env.RECALL_MEMORY_DB_PATH?.trim();
  if (selected === ":memory:") return selected;
  if (selected) {
    return isAbsolute(selected)
      ? selected
      : resolve(/* turbopackIgnore: true */ process.cwd(), selected);
  }
  return join(process.cwd(), ".recall", "memory.sqlite");
}

function eventFromRow(row: SqlRow): MemoryEvent {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    kind: text(row, "kind") as EventKind,
    payload: JSON.parse(text(row, "payload_json")) as CaptureEvidencePayload,
    payloadHash: text(row, "payload_hash"),
    source: {
      actor: text(row, "source_actor") as MemorySource["actor"],
      channel: text(row, "source_channel") as MemorySource["channel"],
      trust: text(row, "trust_tier") as MemorySource["trust"],
      label: text(row, "source_label"),
    },
    sensitivity: text(row, "sensitivity") as Sensitivity,
    recordedAt: text(row, "recorded_at"),
    revisionOf: nullableText(row, "revision_of"),
    tombstonedAt: nullableText(row, "tombstoned_at"),
    contractVersion: CONTRACT_VERSION,
  };
}

function jobFromRow(row: SqlRow): MemoryJob {
  return {
    id: text(row, "id"),
    eventId: text(row, "event_id"),
    kind: PROCESSING_JOB_KIND,
    status: text(row, "status") as MemoryJobStatus,
    attempts: integer(row, "attempts"),
    availableAt: text(row, "available_at"),
    lockedAt: nullableText(row, "locked_at"),
    lastError: nullableText(row, "last_error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function stateJobFromRow(row: SqlRow): MemoryStateJob {
  return {
    id: text(row, "id"),
    eventId: text(row, "event_id"),
    kind: text(row, "kind") as MemoryStateJobKind,
    status: text(row, "status") as MemoryJobStatus,
    attempts: integer(row, "attempts"),
    availableAt: text(row, "available_at"),
    lockedAt: nullableText(row, "locked_at"),
    lastError: nullableText(row, "last_error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function claimFromRow(row: SqlRow): MemoryClaim {
  return {
    id: text(row, "id"),
    eventId: text(row, "event_id"),
    subject: {
      id: text(row, "subject_id"),
      kind: text(row, "subject_kind") as MemoryClaim["subject"]["kind"],
      label: text(row, "subject_label"),
    },
    predicate: text(row, "predicate"),
    object: JSON.parse(text(row, "object_json")) as MemoryClaim["object"],
    polarity: integer(row, "polarity") as MemoryClaim["polarity"],
    modality: text(row, "modality") as MemoryClaim["modality"],
    relationHint: text(row, "relation_hint") as MemoryClaim["relationHint"],
    validTime: nullableText(row, "valid_time_json")
      ? (JSON.parse(text(row, "valid_time_json")) as MemoryClaim["validTime"])
      : null,
    scope: JSON.parse(text(row, "scope_json")) as MemoryClaim["scope"],
    extractorVersion: text(row, "extractor_version"),
  };
}

function beliefFromRow(row: SqlRow): Belief {
  return {
    key: text(row, "key"),
    subject: {
      id: text(row, "subject_id"),
      kind: text(row, "subject_kind") as Belief["subject"]["kind"],
      label: text(row, "subject_label"),
    },
    predicate: text(row, "predicate"),
    value: JSON.parse(text(row, "value_json")) as Belief["value"],
    polarity: integer(row, "polarity") as Belief["polarity"],
    status: text(row, "status") as Belief["status"],
    confidence: text(row, "confidence") as Belief["confidence"],
    validTime: JSON.parse(text(row, "valid_time_json")) as Belief["validTime"],
    systemTime: JSON.parse(text(row, "system_time_json")) as Belief["systemTime"],
    scope: JSON.parse(text(row, "scope_json")) as Belief["scope"],
    support: JSON.parse(text(row, "support_json")) as Belief["support"],
    opposition: JSON.parse(text(row, "opposition_json")) as Belief["opposition"],
    projectorVersion: text(row, "projector_version"),
  };
}

function threadFromRow(row: SqlRow): LifeThread {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    anchorKey: text(row, "anchor_key"),
    title: text(row, "title"),
    kind: text(row, "kind") as LifeThread["kind"],
    status: text(row, "status") as LifeThread["status"],
    currentState: JSON.parse(text(row, "current_state_json")) as LifeThread["currentState"],
    participants: JSON.parse(text(row, "participants_json")) as LifeThread["participants"],
    commitments: JSON.parse(text(row, "commitments_json")) as LifeThread["commitments"],
    expectedNext: nullableText(row, "expected_next_json")
      ? (JSON.parse(text(row, "expected_next_json")) as LifeThread["expectedNext"])
      : null,
    lastMeaningfulChangeAt: text(row, "last_meaningful_change_at"),
    nextReviewAt: nullableText(row, "next_review_at"),
    evidenceEventIds: JSON.parse(
      text(row, "evidence_event_ids_json"),
    ) as LifeThread["evidenceEventIds"],
    beliefKeys: JSON.parse(text(row, "belief_keys_json")) as LifeThread["beliefKeys"],
    resolution: nullableText(row, "resolution_json")
      ? (JSON.parse(text(row, "resolution_json")) as LifeThread["resolution"])
      : null,
    confidence: text(row, "confidence") as LifeThread["confidence"],
    projectorVersion: text(row, "projector_version"),
  };
}

function threadTransitionFromRow(row: SqlRow): ThreadTransition {
  return {
    id: text(row, "id"),
    threadId: text(row, "thread_id"),
    kind: text(row, "kind") as ThreadTransition["kind"],
    fromStatus: nullableText(row, "from_status") as ThreadTransition["fromStatus"],
    toStatus: text(row, "to_status") as ThreadTransition["toStatus"],
    at: text(row, "occurred_at"),
    reason: text(row, "reason"),
    state: text(row, "state_text"),
    evidenceEventIds: JSON.parse(
      text(row, "evidence_event_ids_json"),
    ) as ThreadTransition["evidenceEventIds"],
    projectorVersion: text(row, "projector_version"),
  };
}

function prospectiveFromRow(row: SqlRow): ProspectiveMemory {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    createEventId: text(row, "create_event_id"),
    lastEventId: text(row, "last_event_id"),
    topic: text(row, "topic"),
    action: text(row, "action"),
    firePolicy: "once",
    status: text(row, "status") as ProspectiveMemory["status"],
    outcome: nullableText(row, "outcome") as ProspectiveMemory["outcome"],
    snoozedUntil: nullableText(row, "snoozed_until"),
    createdAt: text(row, "created_at"),
    firedAt: nullableText(row, "fired_at"),
    providerExternalId: nullableText(row, "provider_external_id"),
    evidenceEventIds: JSON.parse(
      text(row, "evidence_event_ids_json"),
    ) as ProspectiveMemory["evidenceEventIds"],
    projectorVersion: text(row, "projector_version"),
  };
}

function relationshipEventFromRow(row: SqlRow): RelationshipEvent {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    sessionId: nullableText(row, "session_id"),
    kind: text(row, "kind") as RelationshipEvent["kind"],
    source: text(row, "source") as RelationshipEvent["source"],
    sensitivity: text(row, "sensitivity") as Sensitivity,
    payload: JSON.parse(text(row, "payload_json")) as RelationshipEvent["payload"],
    evidenceEventIds: JSON.parse(text(row, "evidence_event_ids_json")) as string[],
    occurredAt: text(row, "occurred_at"),
    personaVersion: text(row, "persona_version"),
  };
}

function attentionDecisionFromRow(row: SqlRow): AttentionDecisionRecord {
  const selected = row.selected_score;
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    sessionId: text(row, "session_id"),
    engineVersion: text(row, "engine_version"),
    mode: text(row, "mode") as AttentionDecisionRecord["mode"],
    momentKind: text(row, "moment_kind") as AttentionDecisionRecord["momentKind"],
    selectedCandidateId: nullableText(row, "selected_candidate_id"),
    selectedKind: nullableText(row, "selected_kind"),
    selectedAction: nullableText(row, "selected_action"),
    selectedScore:
      typeof selected === "number" || typeof selected === "bigint" ? Number(selected) : null,
    cooldownKey: nullableText(row, "cooldown_key"),
    shouldSurface: integer(row, "should_surface") === 1,
    silenceReason: nullableText(row, "silence_reason"),
    decision: JSON.parse(text(row, "decision_json")) as Record<string, unknown>,
    evidenceEventIds: JSON.parse(text(row, "evidence_event_ids_json")) as string[],
    relationshipEventIds: JSON.parse(text(row, "relationship_event_ids_json")) as string[],
    createdAt: text(row, "created_at"),
  };
}

function attentionOutcomeFromRow(row: SqlRow): AttentionOutcomeRecord {
  return {
    id: text(row, "id"),
    decisionId: text(row, "decision_id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    candidateId: text(row, "candidate_id"),
    candidateKind: text(row, "candidate_kind"),
    cooldownKey: text(row, "cooldown_key"),
    momentKind: text(row, "moment_kind") as AttentionOutcomeRecord["momentKind"],
    signal: text(row, "signal") as AttentionOutcomeSignal,
    reward: Number(row.reward),
    confidence: Number(row.confidence),
    source: text(row, "source") as AttentionOutcomeRecord["source"],
    occurredAt: text(row, "occurred_at"),
    idempotencyKey: text(row, "idempotency_key"),
  };
}

function associationFromRow(row: SqlRow): MemoryAssociationRecord {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    subjectId: text(row, "subject_id"),
    subjectKind: text(row, "subject_kind"),
    subjectLabel: text(row, "subject_label"),
    outcomeKind: text(row, "outcome_kind") as MemoryAssociationRecord["outcomeKind"],
    outcomeValue: text(row, "outcome_value"),
    status: text(row, "status") as MemoryAssociationRecord["status"],
    confidence: Number(row.confidence),
    observations: integer(row, "observations"),
    evidenceEventIds: JSON.parse(text(row, "evidence_event_ids_json")) as string[],
    firstObservedAt: text(row, "first_observed_at"),
    lastObservedAt: text(row, "last_observed_at"),
    projectorVersion: text(row, "projector_version"),
    updatedAt: text(row, "updated_at"),
  };
}

function consolidationRunFromRow(row: SqlRow): MemoryConsolidationRun {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    space: text(row, "space") as MemorySpace,
    projectorVersion: text(row, "projector_version"),
    trigger: text(row, "trigger") as MemoryConsolidationRun["trigger"],
    status: text(row, "status") as MemoryConsolidationRun["status"],
    startedAt: text(row, "started_at"),
    completedAt: text(row, "completed_at"),
    metrics: JSON.parse(text(row, "metrics_json")) as MemoryConsolidationRun["metrics"],
    idempotencyKey: text(row, "idempotency_key"),
  };
}

function mirrorFromRow(row: SqlRow): MemoryMirror {
  return {
    eventId: text(row, "event_id"),
    provider: "supermemory",
    externalId: text(row, "external_id"),
    payloadHash: text(row, "payload_hash"),
    status: text(row, "status") as MemoryMirror["status"],
    syncedAt: text(row, "synced_at"),
    lastError: nullableText(row, "last_error"),
  };
}

export class MemoryEventLedger {
  readonly databasePath: string;
  private readonly database: SqliteDatabase;

  constructor(options: { databasePath?: string } = {}) {
    this.databasePath = resolveDatabasePath(options.databasePath);
    if (this.databasePath !== ":memory:") mkdirSync(dirname(this.databasePath), { recursive: true });
    const DatabaseSync = sqliteConstructor();
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (this.databasePath !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = FULL;");
    this.migrate();
  }

  private migrate() {
    const versionRow = this.database.prepare("PRAGMA user_version").get() ?? {};
    let current = Number(Object.values(versionRow)[0] ?? 0);
    if (current > SCHEMA_VERSION) {
      throw new Error(`memory ledger schema ${current} is newer than supported ${SCHEMA_VERSION}`);
    }
    if (current < 1) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_1);
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(1, "canonical evidence ledger", now);
        this.database.exec("PRAGMA user_version = 1");
        this.database.exec("COMMIT");
        current = 1;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 2) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_2);
        const existing = this.database
          .prepare("SELECT id, recorded_at FROM memory_events WHERE tombstoned_at IS NULL")
          .all() as SqlRow[];
        const insert = this.database.prepare(`
          INSERT OR IGNORE INTO memory_state_jobs(
            id, event_id, kind, status, attempts, available_at,
            locked_at, last_error, created_at, updated_at
          ) VALUES (?, ?, 'extract_and_project', 'pending', 0, ?, NULL, NULL, ?, ?)
        `);
        for (const row of existing) {
          const recordedAt = text(row, "recorded_at");
          insert.run(randomUUID(), text(row, "id"), recordedAt, recordedAt, recordedAt);
        }
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(2, "claims, temporal beliefs, and state jobs", now);
        this.database.exec("PRAGMA user_version = 2");
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 3) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_3);
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(3, "living threads and open-loop projections", now);
        this.database.exec("PRAGMA user_version = 3");
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 4) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_4);
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(4, "canonical prospective-memory projection", now);
        this.database.exec("PRAGMA user_version = 4");
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 5) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_5);
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(5, "auditable unified-attention decisions", now);
        this.database.exec("PRAGMA user_version = 5");
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 6) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_6);
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(6, "relationship memory, repair, dialect, and humor lifecycle", now);
        this.database.exec("PRAGMA user_version = 6");
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
    if (current < 7) {
      const now = new Date().toISOString();
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(MIGRATION_7);
        this.database
          .prepare(
            "INSERT OR IGNORE INTO memory_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
          )
          .run(7, "outcome learning, associations, and background consolidation", now);
        this.database.exec("PRAGMA user_version = 7");
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close() {
    this.database.close();
  }

  private existingAppendResult(userId: string, idempotencyKey: string): AppendEventResult | null {
    const existing = this.database
      .prepare("SELECT * FROM memory_events WHERE user_id = ? AND idempotency_key = ?")
      .get(userId, idempotencyKey) as SqlRow | undefined;
    if (!existing) return null;
    const event = eventFromRow(existing);
    const jobRow = this.database
      .prepare("SELECT * FROM memory_jobs WHERE event_id = ? AND kind = ?")
      .get(event.id, PROCESSING_JOB_KIND) as SqlRow | undefined;
    const stateJobRow = this.database
      .prepare(
        "SELECT * FROM memory_state_jobs WHERE event_id = ? AND kind = 'extract_and_project'",
      )
      .get(event.id) as SqlRow | undefined;
    if (!jobRow || !stateJobRow) {
      throw new Error(`memory ledger: event ${event.id} is missing its transactional jobs`);
    }
    const job = jobFromRow(jobRow);
    const stateJob = stateJobFromRow(stateJobRow);
    return {
      event,
      job,
      stateJob,
      receipt: {
        eventId: event.id,
        jobId: job.id,
        projectionJobId: stateJob.id,
        recordedAt: event.recordedAt,
        payloadHash: event.payloadHash,
        contractVersion: CONTRACT_VERSION,
        duplicate: true,
      },
    };
  }

  appendEvent(input: AppendEventInput): AppendEventResult {
    if (input.idempotencyKey) {
      const existing = this.existingAppendResult(input.userId, input.idempotencyKey);
      if (existing) return existing;
    }

    if (input.revisionOf) {
      const target = this.getEvent(input.revisionOf);
      if (!target || target.tombstonedAt) {
        throw new Error(`memory ledger: revision target ${input.revisionOf} is unavailable`);
      }
      if (target.userId !== input.userId || target.space !== input.space) {
        throw new Error("memory ledger: a correction cannot cross users or memory spaces");
      }
    }

    const eventId = randomUUID();
    const jobId = randomUUID();
    const stateJobId = randomUUID();
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const payloadJson = JSON.stringify(input.payload);
    const payloadHash = hashPayload(payloadJson);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO memory_events(
            id, user_id, space, kind, payload_json, payload_hash,
            source_actor, source_channel, trust_tier, source_label,
            sensitivity, recorded_at, revision_of, tombstoned_at,
            contract_version, idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `)
        .run(
          eventId,
          input.userId,
          input.space,
          input.kind,
          payloadJson,
          payloadHash,
          input.source.actor,
          input.source.channel,
          input.source.trust,
          input.source.label,
          input.sensitivity,
          recordedAt,
          input.revisionOf ?? null,
          CONTRACT_VERSION,
          input.idempotencyKey ?? null,
        );
      this.database
        .prepare(`
          INSERT INTO memory_jobs(
            id, event_id, kind, status, attempts, available_at,
            locked_at, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)
        `)
        .run(jobId, eventId, PROCESSING_JOB_KIND, recordedAt, recordedAt, recordedAt);
      this.database
        .prepare(`
          INSERT INTO memory_state_jobs(
            id, event_id, kind, status, attempts, available_at,
            locked_at, last_error, created_at, updated_at
          ) VALUES (?, ?, 'extract_and_project', 'pending', 0, ?, NULL, NULL, ?, ?)
        `)
        .run(stateJobId, eventId, recordedAt, recordedAt, recordedAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (input.idempotencyKey) {
        const raced = this.existingAppendResult(input.userId, input.idempotencyKey);
        if (raced) return raced;
      }
      throw error;
    }

    const event = this.getEvent(eventId);
    const job = this.getJob(jobId);
    const stateJob = this.getStateJob(stateJobId);
    if (!event || !job || !stateJob) {
      throw new Error("memory ledger: committed receipt could not be read back");
    }
    return {
      event,
      job,
      stateJob,
      receipt: {
        eventId,
        jobId,
        projectionJobId: stateJobId,
        recordedAt,
        payloadHash,
        contractVersion: CONTRACT_VERSION,
        duplicate: false,
      },
    };
  }

  getEvent(id: string): MemoryEvent | null {
    const row = this.database.prepare("SELECT * FROM memory_events WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    return row ? eventFromRow(row) : null;
  }

  listActiveEvents(userId: string, space: MemorySpace): MemoryEvent[] {
    const rows = this.database
      .prepare(`
        SELECT * FROM memory_events
        WHERE user_id = ? AND space = ? AND tombstoned_at IS NULL
        ORDER BY recorded_at, id
      `)
      .all(userId, space) as SqlRow[];
    return rows.map(eventFromRow);
  }

  getJob(id: string): MemoryJob | null {
    const row = this.database.prepare("SELECT * FROM memory_jobs WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    return row ? jobFromRow(row) : null;
  }

  getStateJob(id: string): MemoryStateJob | null {
    const row = this.database.prepare("SELECT * FROM memory_state_jobs WHERE id = ?").get(id) as
      | SqlRow
      | undefined;
    return row ? stateJobFromRow(row) : null;
  }

  getStateJobForEvent(eventId: string, kind: MemoryStateJobKind): MemoryStateJob | null {
    const row = this.database
      .prepare("SELECT * FROM memory_state_jobs WHERE event_id = ? AND kind = ?")
      .get(eventId, kind) as SqlRow | undefined;
    return row ? stateJobFromRow(row) : null;
  }

  getMirror(eventId: string): MemoryMirror | null {
    const row = this.database
      .prepare("SELECT * FROM memory_mirrors WHERE event_id = ? AND provider = 'supermemory'")
      .get(eventId) as SqlRow | undefined;
    return row ? mirrorFromRow(row) : null;
  }

  claimJob(id: string, now = new Date().toISOString()): MemoryJob | null {
    const result = this.database
      .prepare(`
        UPDATE memory_jobs
        SET status = 'processing', attempts = attempts + 1,
            locked_at = ?, updated_at = ?, last_error = NULL
        WHERE id = ? AND status = 'pending' AND available_at <= ?
      `)
      .run(now, now, id, now);
    if (Number(result.changes) !== 1) return null;
    return this.getJob(id);
  }

  claimNextJob(now = new Date().toISOString()): MemoryJob | null {
    const row = this.database
      .prepare(`
        SELECT id FROM memory_jobs
        WHERE status = 'pending' AND available_at <= ?
        ORDER BY available_at, created_at
        LIMIT 1
      `)
      .get(now) as SqlRow | undefined;
    return row ? this.claimJob(text(row, "id"), now) : null;
  }

  markJobSucceeded(id: string, now = new Date().toISOString()) {
    const result = this.database
      .prepare(`
        UPDATE memory_jobs
        SET status = 'succeeded', locked_at = NULL, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'processing'
      `)
      .run(now, id);
    if (Number(result.changes) !== 1) throw new Error(`memory ledger: job ${id} was not processing`);
  }

  markJobFailed(
    id: string,
    error: unknown,
    options: { now?: string; retryAt?: string } = {},
  ): MemoryJob {
    const job = this.getJob(id);
    if (!job) throw new Error(`memory ledger: job ${id} not found`);
    const now = options.now ?? new Date().toISOString();
    const terminal = job.attempts >= MAX_JOB_ATTEMPTS;
    const delay = Math.min(60_000, 1000 * 2 ** Math.max(0, job.attempts - 1));
    const retryAt = options.retryAt ?? new Date(Date.parse(now) + delay).toISOString();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    this.database
      .prepare(`
        UPDATE memory_jobs
        SET status = ?, available_at = ?, locked_at = NULL,
            last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'processing'
      `)
      .run(terminal ? "dead" : "pending", retryAt, message, now, id);
    const updated = this.getJob(id);
    if (!updated) throw new Error(`memory ledger: job ${id} vanished after failure`);
    return updated;
  }

  recoverStaleJobs(options: { before: string; now?: string }): number {
    const now = options.now ?? new Date().toISOString();
    const result = this.database
      .prepare(`
        UPDATE memory_jobs
        SET status = 'pending', available_at = ?, locked_at = NULL,
            last_error = 'recovered stale processing lease', updated_at = ?
        WHERE status = 'processing' AND locked_at < ?
      `)
      .run(now, now, options.before);
    return Number(result.changes);
  }

  requeueDeadJobs(limit = 10, now = new Date().toISOString()): number {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = this.database
      .prepare(`
        UPDATE memory_jobs
        SET status = 'pending', attempts = 0, available_at = ?,
            locked_at = NULL, last_error = NULL, updated_at = ?
        WHERE id IN (
          SELECT id FROM memory_jobs
          WHERE status = 'dead'
          ORDER BY updated_at
          LIMIT ?
        )
      `)
      .run(now, now, safeLimit);
    return Number(result.changes);
  }

  enqueueStateJob(
    eventId: string,
    kind: MemoryStateJobKind,
    now = new Date().toISOString(),
  ): MemoryStateJob {
    const id = randomUUID();
    this.database
      .prepare(`
        INSERT INTO memory_state_jobs(
          id, event_id, kind, status, attempts, available_at,
          locked_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)
        ON CONFLICT(event_id, kind) DO UPDATE SET
          status = 'pending', attempts = 0, available_at = excluded.available_at,
          locked_at = NULL, last_error = NULL, updated_at = excluded.updated_at
      `)
      .run(id, eventId, kind, now, now, now);
    const job = this.getStateJobForEvent(eventId, kind);
    if (!job) throw new Error(`memory ledger: failed to enqueue ${kind} for ${eventId}`);
    return job;
  }

  claimStateJob(id: string, now = new Date().toISOString()): MemoryStateJob | null {
    const result = this.database
      .prepare(`
        UPDATE memory_state_jobs
        SET status = 'processing', attempts = attempts + 1,
            locked_at = ?, updated_at = ?, last_error = NULL
        WHERE id = ? AND status = 'pending' AND available_at <= ?
      `)
      .run(now, now, id, now);
    if (Number(result.changes) !== 1) return null;
    return this.getStateJob(id);
  }

  claimNextStateJob(now = new Date().toISOString()): MemoryStateJob | null {
    const row = this.database
      .prepare(`
        SELECT id FROM memory_state_jobs
        WHERE status = 'pending' AND available_at <= ?
        ORDER BY available_at, created_at
        LIMIT 1
      `)
      .get(now) as SqlRow | undefined;
    return row ? this.claimStateJob(text(row, "id"), now) : null;
  }

  markStateJobSucceeded(id: string, now = new Date().toISOString()) {
    const result = this.database
      .prepare(`
        UPDATE memory_state_jobs
        SET status = 'succeeded', locked_at = NULL, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'processing'
      `)
      .run(now, id);
    if (Number(result.changes) !== 1) {
      throw new Error(`memory ledger: state job ${id} was not processing`);
    }
  }

  markStateJobFailed(
    id: string,
    error: unknown,
    options: { now?: string; retryAt?: string } = {},
  ): MemoryStateJob {
    const job = this.getStateJob(id);
    if (!job) throw new Error(`memory ledger: state job ${id} not found`);
    const now = options.now ?? new Date().toISOString();
    const terminal = job.attempts >= MAX_JOB_ATTEMPTS;
    const delay = Math.min(60_000, 1000 * 2 ** Math.max(0, job.attempts - 1));
    const retryAt = options.retryAt ?? new Date(Date.parse(now) + delay).toISOString();
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    this.database
      .prepare(`
        UPDATE memory_state_jobs
        SET status = ?, available_at = ?, locked_at = NULL,
            last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'processing'
      `)
      .run(terminal ? "dead" : "pending", retryAt, message, now, id);
    const updated = this.getStateJob(id);
    if (!updated) throw new Error(`memory ledger: state job ${id} vanished after failure`);
    return updated;
  }

  recoverStaleStateJobs(options: { before: string; now?: string }): number {
    const now = options.now ?? new Date().toISOString();
    const result = this.database
      .prepare(`
        UPDATE memory_state_jobs
        SET status = 'pending', available_at = ?, locked_at = NULL,
            last_error = 'recovered stale processing lease', updated_at = ?
        WHERE status = 'processing' AND locked_at < ?
      `)
      .run(now, now, options.before);
    return Number(result.changes);
  }

  requeueDeadStateJobs(limit = 10, now = new Date().toISOString()): number {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = this.database
      .prepare(`
        UPDATE memory_state_jobs
        SET status = 'pending', attempts = 0, available_at = ?,
            locked_at = NULL, last_error = NULL, updated_at = ?
        WHERE id IN (
          SELECT id FROM memory_state_jobs
          WHERE status = 'dead'
          ORDER BY updated_at
          LIMIT ?
        )
      `)
      .run(now, now, safeLimit);
    return Number(result.changes);
  }

  requeueProjectionJobs(
    options: { userId?: string; space?: MemorySpace; now?: string } = {},
  ): number {
    const now = options.now ?? new Date().toISOString();
    const conditions = ["e.tombstoned_at IS NULL", "j.kind = 'extract_and_project'"];
    const values: string[] = [now, now];
    if (options.userId) {
      conditions.push("e.user_id = ?");
      values.push(options.userId);
    }
    if (options.space) {
      conditions.push("e.space = ?");
      values.push(options.space);
    }
    const result = this.database
      .prepare(`
        UPDATE memory_state_jobs AS j
        SET status = 'pending', attempts = 0, available_at = ?,
            locked_at = NULL, last_error = NULL, updated_at = ?
        WHERE EXISTS (
          SELECT 1 FROM memory_events e
          WHERE e.id = j.event_id AND ${conditions.join(" AND ")}
        )
      `)
      .run(...values);
    return Number(result.changes);
  }

  recordSupermemoryMirror(input: {
    eventId: string;
    externalId: string;
    payloadHash: string;
    syncedAt?: string;
  }) {
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO memory_mirrors(
          event_id, provider, external_id, payload_hash, status, synced_at, last_error
        ) VALUES (?, 'supermemory', ?, ?, 'synced', ?, NULL)
        ON CONFLICT(event_id, provider) DO UPDATE SET
          external_id = excluded.external_id,
          payload_hash = excluded.payload_hash,
          status = 'synced',
          synced_at = excluded.synced_at,
          last_error = NULL
      `)
      .run(input.eventId, input.externalId, input.payloadHash, syncedAt);
  }

  markSupermemoryMirrorDeleted(eventId: string, now = new Date().toISOString()) {
    this.database
      .prepare(`
        UPDATE memory_mirrors
        SET status = 'deleted', synced_at = ?, last_error = NULL
        WHERE event_id = ? AND provider = 'supermemory'
      `)
      .run(now, eventId);
  }

  markSupermemoryMirrorDeletionFailed(eventId: string, error: unknown) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    this.database
      .prepare(`
        UPDATE memory_mirrors
        SET last_error = ?
        WHERE event_id = ? AND provider = 'supermemory'
      `)
      .run(message, eventId);
  }

  listJobs(status?: MemoryJobStatus, limit = 50): MemoryJob[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = status
      ? this.database
          .prepare("SELECT * FROM memory_jobs WHERE status = ? ORDER BY created_at LIMIT ?")
          .all(status, safeLimit)
      : this.database.prepare("SELECT * FROM memory_jobs ORDER BY created_at LIMIT ?").all(safeLimit);
    return (rows as SqlRow[]).map(jobFromRow);
  }

  listStateJobs(status?: MemoryJobStatus, limit = 50): MemoryStateJob[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = status
      ? this.database
          .prepare("SELECT * FROM memory_state_jobs WHERE status = ? ORDER BY created_at LIMIT ?")
          .all(status, safeLimit)
      : this.database
          .prepare("SELECT * FROM memory_state_jobs ORDER BY created_at LIMIT ?")
          .all(safeLimit);
    return (rows as SqlRow[]).map(stateJobFromRow);
  }

  replaceClaimsForEvent(eventId: string, claims: MemoryClaim[], now = new Date().toISOString()) {
    const event = this.getEvent(eventId);
    if (!event) throw new Error(`memory ledger: event ${eventId} not found`);
    if (event.tombstonedAt) throw new Error(`memory ledger: event ${eventId} is tombstoned`);
    if (claims.some((claim) => claim.eventId !== eventId)) {
      throw new Error("memory ledger: every replacement claim must reference the same event");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM memory_claims WHERE event_id = ?").run(eventId);
      const insert = this.database.prepare(`
        INSERT INTO memory_claims(
          id, event_id, subject_id, subject_kind, subject_label,
          predicate, object_json, polarity, modality, relation_hint,
          valid_time_json, scope_json, extractor_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const claim of claims) {
        insert.run(
          claim.id,
          eventId,
          claim.subject.id,
          claim.subject.kind,
          claim.subject.label,
          claim.predicate,
          JSON.stringify(claim.object),
          claim.polarity,
          claim.modality,
          claim.relationHint,
          claim.validTime ? JSON.stringify(claim.validTime) : null,
          JSON.stringify(claim.scope),
          claim.extractorVersion,
          now,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listClaimsForEvent(eventId: string): MemoryClaim[] {
    const rows = this.database
      .prepare("SELECT * FROM memory_claims WHERE event_id = ? ORDER BY id")
      .all(eventId) as SqlRow[];
    return rows.map(claimFromRow);
  }

  listClaimEvidence(userId: string, space: MemorySpace): ClaimEvidence[] {
    const rows = this.database
      .prepare(`
        SELECT c.*, e.user_id, e.space, e.kind AS event_kind,
               e.trust_tier, e.source_actor, e.recorded_at, e.revision_of
        FROM memory_claims c
        JOIN memory_events e ON e.id = c.event_id
        WHERE e.user_id = ? AND e.space = ? AND e.tombstoned_at IS NULL
        ORDER BY e.recorded_at, c.id
      `)
      .all(userId, space) as SqlRow[];
    return rows.map((row) => ({
      claim: claimFromRow(row),
      userId: text(row, "user_id"),
      space: text(row, "space") as MemorySpace,
      eventKind: text(row, "event_kind") as EventKind,
      trust: text(row, "trust_tier") as MemorySource["trust"],
      actor: text(row, "source_actor") as MemorySource["actor"],
      recordedAt: text(row, "recorded_at"),
      revisionOf: nullableText(row, "revision_of"),
    }));
  }

  replaceBeliefProjection(
    userId: string,
    space: MemorySpace,
    beliefs: Belief[],
    relations: StoredClaimRelation[],
    now = new Date().toISOString(),
  ) {
    if (beliefs.some((belief) => belief.scope.space !== space)) {
      throw new Error("memory ledger: belief projection crossed a memory space");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          DELETE FROM memory_claim_relations
          WHERE from_claim_id IN (
            SELECT c.id FROM memory_claims c
            JOIN memory_events e ON e.id = c.event_id
            WHERE e.user_id = ? AND e.space = ?
          ) OR to_claim_id IN (
            SELECT c.id FROM memory_claims c
            JOIN memory_events e ON e.id = c.event_id
            WHERE e.user_id = ? AND e.space = ?
          )
        `)
        .run(userId, space, userId, space);
      this.database
        .prepare("DELETE FROM memory_beliefs WHERE user_id = ? AND space = ?")
        .run(userId, space);

      const insertRelation = this.database.prepare(`
        INSERT INTO memory_claim_relations(
          from_claim_id, to_claim_id, relation, reason, projector_version
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const relation of relations) {
        insertRelation.run(
          relation.fromClaimId,
          relation.toClaimId,
          relation.relation,
          relation.reason,
          relation.projectorVersion,
        );
      }

      const insertBelief = this.database.prepare(`
        INSERT INTO memory_beliefs(
          key, user_id, space, subject_id, subject_kind, subject_label,
          predicate, value_json, polarity, status, confidence,
          valid_time_json, system_time_json, scope_json,
          support_json, opposition_json, projector_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const belief of beliefs) {
        insertBelief.run(
          belief.key,
          userId,
          space,
          belief.subject.id,
          belief.subject.kind,
          belief.subject.label,
          belief.predicate,
          JSON.stringify(belief.value),
          belief.polarity,
          belief.status,
          belief.confidence,
          JSON.stringify(belief.validTime),
          JSON.stringify(belief.systemTime),
          JSON.stringify(belief.scope),
          JSON.stringify(belief.support),
          JSON.stringify(belief.opposition),
          belief.projectorVersion,
          now,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listBeliefs(options: {
    userId?: string;
    space: MemorySpace;
    status?: Belief["status"];
    subjectId?: string;
    predicate?: string;
    limit?: number;
  }): Belief[] {
    const conditions = ["user_id = ?", "space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    if (options.subjectId) {
      conditions.push("subject_id = ?");
      values.push(options.subjectId);
    }
    if (options.predicate) {
      conditions.push("predicate = ?");
      values.push(options.predicate);
    }
    const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit ?? 100)));
    values.push(limit);
    const rows = this.database
      .prepare(`
        SELECT * FROM memory_beliefs
        WHERE ${conditions.join(" AND ")}
        ORDER BY CASE status
          WHEN 'current' THEN 0 WHEN 'conflicting' THEN 1
          WHEN 'historical' THEN 2 ELSE 3 END,
          subject_label, predicate, key
        LIMIT ?
      `)
      .all(...values) as SqlRow[];
    return rows.map(beliefFromRow);
  }

  replaceThreadProjection(
    userId: string,
    space: MemorySpace,
    threads: LifeThread[],
    transitions: ThreadTransition[],
    now = new Date().toISOString(),
  ) {
    if (threads.some((thread) => thread.userId !== userId || thread.space !== space)) {
      throw new Error("memory ledger: thread projection crossed a user or memory space");
    }
    const threadIds = new Set(threads.map((thread) => thread.id));
    if (transitions.some((transition) => !threadIds.has(transition.threadId))) {
      throw new Error("memory ledger: thread transition references a different projection");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM memory_threads WHERE user_id = ? AND space = ?")
        .run(userId, space);

      const insertThread = this.database.prepare(`
        INSERT INTO memory_threads(
          id, user_id, space, anchor_key, title, kind, status,
          current_state_json, participants_json, commitments_json,
          expected_next_json, last_meaningful_change_at, next_review_at,
          evidence_event_ids_json, belief_keys_json, resolution_json,
          confidence, projector_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const thread of threads) {
        insertThread.run(
          thread.id,
          userId,
          space,
          thread.anchorKey,
          thread.title,
          thread.kind,
          thread.status,
          JSON.stringify(thread.currentState),
          JSON.stringify(thread.participants),
          JSON.stringify(thread.commitments),
          thread.expectedNext ? JSON.stringify(thread.expectedNext) : null,
          thread.lastMeaningfulChangeAt,
          thread.nextReviewAt,
          JSON.stringify(thread.evidenceEventIds),
          JSON.stringify(thread.beliefKeys),
          thread.resolution ? JSON.stringify(thread.resolution) : null,
          thread.confidence,
          thread.projectorVersion,
          now,
        );
      }

      const insertTransition = this.database.prepare(`
        INSERT INTO memory_thread_transitions(
          id, thread_id, kind, from_status, to_status, occurred_at,
          reason, state_text, evidence_event_ids_json, projector_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const transition of transitions) {
        insertTransition.run(
          transition.id,
          transition.threadId,
          transition.kind,
          transition.fromStatus,
          transition.toStatus,
          transition.at,
          transition.reason,
          transition.state,
          JSON.stringify(transition.evidenceEventIds),
          transition.projectorVersion,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listThreads(options: {
    userId?: string;
    space: MemorySpace;
    id?: string;
    status?: LifeThread["status"];
    kind?: LifeThread["kind"];
    anchorKey?: string;
    activeOnly?: boolean;
    limit?: number;
  }): LifeThread[] {
    const conditions = ["user_id = ?", "space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.id) {
      conditions.push("id = ?");
      values.push(options.id);
    }
    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    if (options.kind) {
      conditions.push("kind = ?");
      values.push(options.kind);
    }
    if (options.anchorKey) {
      conditions.push("anchor_key = ?");
      values.push(options.anchorKey);
    }
    if (options.activeOnly) conditions.push("status NOT IN ('resolved','dormant')");
    const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit ?? 100)));
    values.push(limit);
    const rows = this.database
      .prepare(`
        SELECT * FROM memory_threads
        WHERE ${conditions.join(" AND ")}
        ORDER BY CASE status
          WHEN 'blocked' THEN 0 WHEN 'waiting' THEN 1 WHEN 'open' THEN 2
          WHEN 'emerging' THEN 3 WHEN 'dormant' THEN 4 ELSE 5 END,
          last_meaningful_change_at DESC, title, id
        LIMIT ?
      `)
      .all(...values) as SqlRow[];
    return rows.map(threadFromRow);
  }

  listThreadTransitions(options: {
    userId?: string;
    space: MemorySpace;
    threadId?: string;
    limit?: number;
  }): ThreadTransition[] {
    const conditions = ["t.user_id = ?", "t.space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.threadId) {
      conditions.push("x.thread_id = ?");
      values.push(options.threadId);
    }
    const limit = Math.max(1, Math.min(2_000, Math.floor(options.limit ?? 500)));
    values.push(limit);
    const rows = this.database
      .prepare(`
        SELECT x.* FROM memory_thread_transitions x
        JOIN memory_threads t ON t.id = x.thread_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY x.occurred_at, x.id
        LIMIT ?
      `)
      .all(...values) as SqlRow[];
    return rows.map(threadTransitionFromRow);
  }

  replaceProspectiveProjection(
    userId: string,
    space: MemorySpace,
    triggers: ProspectiveMemory[],
    now = new Date().toISOString(),
  ) {
    if (triggers.some((trigger) => trigger.userId !== userId || trigger.space !== space)) {
      throw new Error("memory ledger: prospective projection crossed a user or memory space");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM memory_prospective_triggers WHERE user_id = ? AND space = ?")
        .run(userId, space);
      const insert = this.database.prepare(`
        INSERT INTO memory_prospective_triggers(
          id, user_id, space, create_event_id, last_event_id,
          topic, action, fire_policy, status, outcome, snoozed_until,
          created_at, fired_at, provider_external_id,
          evidence_event_ids_json, projector_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'once', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const trigger of triggers) {
        insert.run(
          trigger.id,
          userId,
          space,
          trigger.createEventId,
          trigger.lastEventId,
          trigger.topic,
          trigger.action,
          trigger.status,
          trigger.outcome,
          trigger.snoozedUntil,
          trigger.createdAt,
          trigger.firedAt,
          trigger.providerExternalId,
          JSON.stringify(trigger.evidenceEventIds),
          trigger.projectorVersion,
          now,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listProspective(options: {
    userId?: string;
    space: MemorySpace;
    id?: string;
    includeClosed?: boolean;
    includeSnoozed?: boolean;
    at?: string;
    limit?: number;
  }): ProspectiveMemory[] {
    const conditions = ["user_id = ?", "space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.id) {
      conditions.push("id = ?");
      values.push(options.id);
    }
    if (!options.includeClosed) conditions.push("status = 'open'");
    if (!options.includeSnoozed) {
      conditions.push("(snoozed_until IS NULL OR snoozed_until <= ?)");
      values.push(options.at ?? new Date().toISOString());
    }
    const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit ?? 500)));
    values.push(limit);
    const rows = this.database
      .prepare(`
        SELECT * FROM memory_prospective_triggers
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at, id
        LIMIT ?
      `)
      .all(...values) as SqlRow[];
    return rows.map(prospectiveFromRow);
  }

  appendRelationshipEvent(
    input: RelationshipEventInput,
    personaVersion: string,
    id = randomUUID(),
  ): RelationshipEvent {
    if (input.idempotencyKey) {
      const existing = this.database
        .prepare(
          "SELECT id FROM memory_relationship_events WHERE user_id = ? AND space = ? AND idempotency_key = ?",
        )
        .get(input.userId, input.space, input.idempotencyKey) as SqlRow | undefined;
      if (existing) {
        const found = this.getRelationshipEvent(text(existing, "id"));
        if (!found) throw new Error("memory ledger: idempotent relationship event vanished");
        return found;
      }
    }
    const evidenceEventIds = [...new Set(input.evidenceEventIds)].sort();
    for (const eventId of evidenceEventIds) {
      const event = this.getEvent(eventId);
      if (!event || event.tombstonedAt) {
        throw new Error(`memory ledger: relationship evidence ${eventId} is unavailable`);
      }
      if (event.userId !== input.userId || event.space !== input.space) {
        throw new Error("memory ledger: relationship evidence crossed a user or memory space");
      }
    }
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO memory_relationship_events(
            id, user_id, space, session_id, kind, source, sensitivity,
            payload_json, persona_version, occurred_at, idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.userId,
          input.space,
          input.sessionId,
          input.kind,
          input.source,
          input.sensitivity,
          JSON.stringify(input.payload),
          personaVersion,
          occurredAt,
          input.idempotencyKey ?? null,
        );
      const link = this.database.prepare(
        "INSERT INTO memory_relationship_evidence(relationship_event_id, event_id) VALUES (?, ?)",
      );
      for (const eventId of evidenceEventIds) link.run(id, eventId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    const appended = this.getRelationshipEvent(id);
    if (!appended) throw new Error("memory ledger: appended relationship event vanished");
    return appended;
  }

  getRelationshipEvent(id: string): RelationshipEvent | null {
    const row = this.database
      .prepare(`
        SELECT r.*,
          COALESCE((
            SELECT json_group_array(e.event_id)
            FROM memory_relationship_evidence e
            WHERE e.relationship_event_id = r.id
          ), '[]') AS evidence_event_ids_json
        FROM memory_relationship_events r
        WHERE r.id = ?
      `)
      .get(id) as SqlRow | undefined;
    return row ? relationshipEventFromRow(row) : null;
  }

  listRelationshipEvents(options: {
    userId?: string;
    space: MemorySpace;
    kind?: RelationshipEvent["kind"];
    limit?: number;
  }): RelationshipEvent[] {
    const conditions = ["r.user_id = ?", "r.space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.kind) {
      conditions.push("r.kind = ?");
      values.push(options.kind);
    }
    const limit = Math.max(1, Math.min(10_000, Math.floor(options.limit ?? 2_000)));
    values.push(limit);
    const rows = this.database
      .prepare(`
        SELECT r.*,
          COALESCE((
            SELECT json_group_array(e.event_id)
            FROM memory_relationship_evidence e
            WHERE e.relationship_event_id = r.id
          ), '[]') AS evidence_event_ids_json
        FROM memory_relationship_events r
        WHERE ${conditions.join(" AND ")}
        ORDER BY r.occurred_at, r.id
        LIMIT ?
      `)
      .all(...values) as SqlRow[];
    return rows.map(relationshipEventFromRow);
  }

  replaceRelationshipState(state: RelationshipState) {
    this.database
      .prepare(`
        INSERT INTO memory_relationship_state(
          user_id, space, projector_version, persona_version, state_json, projected_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, space) DO UPDATE SET
          projector_version = excluded.projector_version,
          persona_version = excluded.persona_version,
          state_json = excluded.state_json,
          projected_at = excluded.projected_at
      `)
      .run(
        state.userId,
        state.space,
        state.projectorVersion,
        state.personaVersion,
        JSON.stringify(state),
        state.projectedAt,
      );
  }

  getRelationshipState(userId: string, space: MemorySpace): RelationshipState | null {
    const row = this.database
      .prepare("SELECT state_json FROM memory_relationship_state WHERE user_id = ? AND space = ?")
      .get(userId, space) as SqlRow | undefined;
    return row ? (JSON.parse(text(row, "state_json")) as RelationshipState) : null;
  }

  deleteRelationshipEvent(id: string, userId = "local-user", space?: MemorySpace) {
    const event = this.getRelationshipEvent(id);
    if (!event || event.userId !== userId || (space && event.space !== space)) {
      throw new Error(`memory ledger: relationship event ${id} is unavailable`);
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          DELETE FROM memory_attention_decisions
          WHERE id IN (
            SELECT decision_id FROM memory_attention_relationship_evidence
            WHERE relationship_event_id = ?
          )
        `)
        .run(id);
      this.database.prepare("DELETE FROM memory_relationship_events WHERE id = ?").run(id);
      this.database
        .prepare("DELETE FROM memory_relationship_state WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database
        .prepare("DELETE FROM memory_attention_profiles WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return event;
  }

  recordAttentionDecision(input: RecordAttentionDecisionInput): AttentionDecisionRecord {
    const evidenceEventIds = [...new Set(input.evidenceEventIds ?? [])].sort();
    const relationshipEventIds = [...new Set(input.relationshipEventIds ?? [])].sort();
    for (const eventId of evidenceEventIds) {
      const event = this.getEvent(eventId);
      if (!event || event.tombstonedAt) {
        throw new Error(`memory ledger: attention evidence ${eventId} is unavailable`);
      }
      if (event.userId !== input.userId || event.space !== input.space) {
        throw new Error("memory ledger: attention evidence crossed a user or memory space");
      }
    }
    for (const relationshipEventId of relationshipEventIds) {
      const event = this.getRelationshipEvent(relationshipEventId);
      if (!event) {
        throw new Error(`memory ledger: attention relationship evidence ${relationshipEventId} is unavailable`);
      }
      if (event.userId !== input.userId || event.space !== input.space) {
        throw new Error("memory ledger: attention relationship evidence crossed a user or memory space");
      }
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          INSERT INTO memory_attention_decisions(
            id, user_id, space, session_id, engine_version, mode, moment_kind,
            selected_candidate_id, selected_kind, selected_action, selected_score,
            cooldown_key, should_surface, silence_reason, decision_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.id,
          input.userId,
          input.space,
          input.sessionId,
          input.engineVersion,
          input.mode,
          input.momentKind,
          input.selectedCandidateId,
          input.selectedKind,
          input.selectedAction,
          input.selectedScore,
          input.cooldownKey,
          input.shouldSurface ? 1 : 0,
          input.silenceReason,
          JSON.stringify(input.decision),
          input.createdAt,
        );
      const link = this.database.prepare(
        "INSERT INTO memory_attention_evidence(decision_id, event_id) VALUES (?, ?)",
      );
      for (const eventId of evidenceEventIds) link.run(input.id, eventId);
      const relationshipLink = this.database.prepare(
        "INSERT INTO memory_attention_relationship_evidence(decision_id, relationship_event_id) VALUES (?, ?)",
      );
      for (const relationshipEventId of relationshipEventIds) {
        relationshipLink.run(input.id, relationshipEventId);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { ...input, evidenceEventIds, relationshipEventIds };
  }

  getAttentionDecision(id: string): AttentionDecisionRecord | null {
    const row = this.database
      .prepare(`
        SELECT d.*,
          COALESCE((
            SELECT json_group_array(e.event_id)
            FROM memory_attention_evidence e
            WHERE e.decision_id = d.id
          ), '[]') AS evidence_event_ids_json,
          COALESCE((
            SELECT json_group_array(re.relationship_event_id)
            FROM memory_attention_relationship_evidence re
            WHERE re.decision_id = d.id
          ), '[]') AS relationship_event_ids_json
        FROM memory_attention_decisions d
        WHERE d.id = ?
      `)
      .get(id) as SqlRow | undefined;
    return row ? attentionDecisionFromRow(row) : null;
  }

  listAttentionDecisions(options: {
    userId?: string;
    space: MemorySpace;
    sessionId?: string;
    surfacedOnly?: boolean;
    since?: string;
    limit?: number;
  }): AttentionDecisionRecord[] {
    const conditions = ["d.user_id = ?", "d.space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.sessionId) {
      conditions.push("d.session_id = ?");
      values.push(options.sessionId);
    }
    if (options.surfacedOnly) conditions.push("d.should_surface = 1");
    if (options.since) {
      conditions.push("d.created_at >= ?");
      values.push(options.since);
    }
    const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit ?? 200)));
    values.push(limit);
    const rows = this.database
      .prepare(`
        SELECT d.*,
          COALESCE(json_group_array(e.event_id) FILTER (WHERE e.event_id IS NOT NULL), '[]')
            AS evidence_event_ids_json,
          COALESCE((
            SELECT json_group_array(re.relationship_event_id)
            FROM memory_attention_relationship_evidence re
            WHERE re.decision_id = d.id
          ), '[]') AS relationship_event_ids_json
        FROM memory_attention_decisions d
        LEFT JOIN memory_attention_evidence e ON e.decision_id = d.id
        WHERE ${conditions.join(" AND ")}
        GROUP BY d.id
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT ?
      `)
      .all(...values) as SqlRow[];
    return rows.map(attentionDecisionFromRow);
  }

  recordAttentionOutcome(input: Omit<AttentionOutcomeRecord, "id">, id = randomUUID()) {
    const existing = this.database
      .prepare(
        "SELECT * FROM memory_attention_outcomes WHERE user_id = ? AND space = ? AND idempotency_key = ?",
      )
      .get(input.userId, input.space, input.idempotencyKey) as SqlRow | undefined;
    if (existing) return attentionOutcomeFromRow(existing);
    this.database
      .prepare(`
        INSERT INTO memory_attention_outcomes(
          id, decision_id, user_id, space, candidate_id, candidate_kind,
          cooldown_key, moment_kind, signal, reward, confidence, source,
          occurred_at, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.decisionId,
        input.userId,
        input.space,
        input.candidateId,
        input.candidateKind,
        input.cooldownKey,
        input.momentKind,
        input.signal,
        input.reward,
        input.confidence,
        input.source,
        input.occurredAt,
        input.idempotencyKey,
      );
    const row = this.database
      .prepare("SELECT * FROM memory_attention_outcomes WHERE id = ?")
      .get(id) as SqlRow;
    return attentionOutcomeFromRow(row);
  }

  listAttentionOutcomes(options: {
    userId?: string;
    space: MemorySpace;
    decisionId?: string;
    limit?: number;
  }): AttentionOutcomeRecord[] {
    const conditions = ["user_id = ?", "space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (options.decisionId) {
      conditions.push("decision_id = ?");
      values.push(options.decisionId);
    }
    const limit = Math.max(1, Math.min(20_000, Math.floor(options.limit ?? 5_000)));
    values.push(limit);
    return (this.database
      .prepare(`
        SELECT * FROM memory_attention_outcomes
        WHERE ${conditions.join(" AND ")}
        ORDER BY occurred_at, id
        LIMIT ?
      `)
      .all(...values) as SqlRow[]).map(attentionOutcomeFromRow);
  }

  replaceAttentionProfile(
    userId: string,
    space: MemorySpace,
    projectorVersion: string,
    profile: Record<string, unknown>,
    projectedAt = new Date().toISOString(),
  ) {
    this.database
      .prepare(`
        INSERT INTO memory_attention_profiles(
          user_id, space, projector_version, profile_json, projected_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, space) DO UPDATE SET
          projector_version = excluded.projector_version,
          profile_json = excluded.profile_json,
          projected_at = excluded.projected_at
      `)
      .run(userId, space, projectorVersion, JSON.stringify(profile), projectedAt);
  }

  getAttentionProfile(userId: string, space: MemorySpace) {
    const row = this.database
      .prepare(
        "SELECT projector_version, profile_json, projected_at FROM memory_attention_profiles WHERE user_id = ? AND space = ?",
      )
      .get(userId, space) as SqlRow | undefined;
    return row
      ? {
          projectorVersion: text(row, "projector_version"),
          profile: JSON.parse(text(row, "profile_json")) as Record<string, unknown>,
          projectedAt: text(row, "projected_at"),
        }
      : null;
  }

  replaceAssociations(
    userId: string,
    space: MemorySpace,
    associations: MemoryAssociationRecord[],
    now = new Date().toISOString(),
  ) {
    if (associations.some((association) => association.userId !== userId || association.space !== space)) {
      throw new Error("memory ledger: association projection crossed a user or memory space");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare("DELETE FROM memory_associations WHERE user_id = ? AND space = ?")
        .run(userId, space);
      const insert = this.database.prepare(`
        INSERT INTO memory_associations(
          id, user_id, space, subject_id, subject_kind, subject_label,
          outcome_kind, outcome_value, status, confidence, observations,
          evidence_event_ids_json, first_observed_at, last_observed_at,
          projector_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const association of associations) {
        insert.run(
          association.id,
          userId,
          space,
          association.subjectId,
          association.subjectKind,
          association.subjectLabel,
          association.outcomeKind,
          association.outcomeValue,
          association.status,
          association.confidence,
          association.observations,
          JSON.stringify(association.evidenceEventIds),
          association.firstObservedAt,
          association.lastObservedAt,
          association.projectorVersion,
          now,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listAssociations(options: {
    userId?: string;
    space: MemorySpace;
    includeStale?: boolean;
    limit?: number;
  }): MemoryAssociationRecord[] {
    const conditions = ["user_id = ?", "space = ?"];
    const values: Array<string | number> = [options.userId ?? "local-user", options.space];
    if (!options.includeStale) conditions.push("status != 'stale'");
    const limit = Math.max(1, Math.min(5_000, Math.floor(options.limit ?? 500)));
    values.push(limit);
    return (this.database
      .prepare(`
        SELECT * FROM memory_associations
        WHERE ${conditions.join(" AND ")}
        ORDER BY status = 'active' DESC, confidence DESC, last_observed_at DESC, id
        LIMIT ?
      `)
      .all(...values) as SqlRow[]).map(associationFromRow);
  }

  recordConsolidationRun(run: MemoryConsolidationRun) {
    const existing = this.database
      .prepare(
        "SELECT * FROM memory_consolidation_runs WHERE user_id = ? AND space = ? AND idempotency_key = ?",
      )
      .get(run.userId, run.space, run.idempotencyKey) as SqlRow | undefined;
    if (existing) return consolidationRunFromRow(existing);
    this.database
      .prepare(`
        INSERT INTO memory_consolidation_runs(
          id, user_id, space, projector_version, trigger, status,
          started_at, completed_at, metrics_json, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.id,
        run.userId,
        run.space,
        run.projectorVersion,
        run.trigger,
        run.status,
        run.startedAt,
        run.completedAt,
        JSON.stringify(run.metrics),
        run.idempotencyKey,
      );
    return run;
  }

  listConsolidationRuns(options: {
    userId?: string;
    space: MemorySpace;
    limit?: number;
  }): MemoryConsolidationRun[] {
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 20)));
    return (this.database
      .prepare(`
        SELECT * FROM memory_consolidation_runs
        WHERE user_id = ? AND space = ?
        ORDER BY completed_at DESC, id DESC
        LIMIT ?
      `)
      .all(options.userId ?? "local-user", options.space, limit) as SqlRow[]).map(
      consolidationRunFromRow,
    );
  }

  attentionDecisionCountForEvent(eventId: string): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(DISTINCT decision_id) AS count FROM (
            SELECT decision_id FROM memory_attention_evidence WHERE event_id = ?
            UNION
            SELECT are.decision_id
            FROM memory_attention_relationship_evidence are
            JOIN memory_relationship_evidence re
              ON re.relationship_event_id = are.relationship_event_id
            WHERE re.event_id = ?
          )
        `,
      )
      .get(eventId, eventId) as SqlRow;
    return integer(row, "count");
  }

  listClaimRelations(userId: string, space: MemorySpace): StoredClaimRelation[] {
    const rows = this.database
      .prepare(`
        SELECT r.* FROM memory_claim_relations r
        JOIN memory_claims c ON c.id = r.from_claim_id
        JOIN memory_events e ON e.id = c.event_id
        WHERE e.user_id = ? AND e.space = ?
        ORDER BY r.from_claim_id, r.to_claim_id, r.relation
      `)
      .all(userId, space) as SqlRow[];
    return rows.map((row) => ({
      fromClaimId: text(row, "from_claim_id"),
      toClaimId: text(row, "to_claim_id"),
      relation: text(row, "relation") as ClaimRelation,
      reason: text(row, "reason"),
      projectorVersion: text(row, "projector_version"),
    }));
  }

  createDeletionPreview(
    eventId: string,
    options: { ttlMs?: number; now?: string } = {},
  ): DeletionPreview {
    const event = this.getEvent(eventId);
    if (!event) throw new Error(`memory ledger: event ${eventId} not found`);
    if (event.tombstonedAt) throw new Error(`memory ledger: event ${eventId} is already deleted`);
    const claims = this.listClaimsForEvent(eventId);
    const claimIds = new Set(claims.map((claim) => claim.id));
    const affectedBeliefs = this.listBeliefs({
      userId: event.userId,
      space: event.space,
      limit: 5_000,
    })
      .filter((belief) =>
        [...belief.support, ...belief.opposition].some((claimId) => claimIds.has(claimId)),
      )
      .map((belief) => belief.key);
    const affectedThreads = this.listThreads({
      userId: event.userId,
      space: event.space,
      limit: 5_000,
    })
      .filter((thread) => thread.evidenceEventIds.includes(eventId))
      .map((thread) => thread.id);
    const affectedProspective = this.listProspective({
      userId: event.userId,
      space: event.space,
      includeClosed: true,
      includeSnoozed: true,
      limit: 5_000,
    })
      .filter((trigger) => trigger.evidenceEventIds.includes(eventId))
      .map((trigger) => trigger.id);
    const affectedAttention = this.attentionDecisionCountForEvent(eventId);
    const affectedRelationshipRow = this.database
      .prepare(
        "SELECT COUNT(DISTINCT relationship_event_id) AS count FROM memory_relationship_evidence WHERE event_id = ?",
      )
      .get(eventId) as SqlRow;
    const affectedRelationship = integer(affectedRelationshipRow, "count");
    const token = randomUUID();
    const issuedAt = options.now ?? new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(issuedAt) + Math.max(60_000, options.ttlMs ?? 10 * 60_000),
    ).toISOString();
    this.database
      .prepare(
        "INSERT INTO memory_deletion_consents(token, event_id, expires_at, used_at) VALUES (?, ?, ?, NULL)",
      )
      .run(token, eventId, expiresAt);
    return {
      token,
      eventId,
      excerpt: event.payload.content.slice(0, 200),
      expiresAt,
      claims: claims.length,
      affectedBeliefs,
      affectedThreads,
      affectedProspective,
      affectedAttention,
      affectedRelationship,
      mirrored: this.getMirror(eventId)?.status === "synced",
    };
  }

  tombstoneWithConsent(token: string, now = new Date().toISOString()): TombstoneResult {
    const consent = this.database
      .prepare("SELECT * FROM memory_deletion_consents WHERE token = ?")
      .get(token) as SqlRow | undefined;
    if (!consent || nullableText(consent, "used_at")) {
      throw new Error("memory ledger: deletion consent is invalid or already used");
    }
    if (text(consent, "expires_at") < now) {
      throw new Error("memory ledger: deletion consent expired");
    }
    const eventId = text(consent, "event_id");
    const event = this.getEvent(eventId);
    if (!event || event.tombstonedAt) {
      throw new Error(`memory ledger: event ${eventId} is unavailable for deletion`);
    }
    const mirror = this.getMirror(eventId);
    const deletedPayload: CaptureEvidencePayload = {
      content: "[deleted by user]",
      redacted: true,
      legacySource: "recall-memory-control",
      requested: { kind: event.payload.requested.kind, due: null },
    };
    const payloadJson = JSON.stringify(deletedPayload);
    const payloadHash = hashPayload(payloadJson);
    // Always queue a provider purge. The mirror row may not exist yet if a
    // deletion races an in-flight provider write or a process died after the
    // provider accepted a document but before SQLite recorded its ID.
    const purgeJobId = randomUUID();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(`
          UPDATE memory_events
          SET payload_json = ?, payload_hash = ?, tombstoned_at = ?
          WHERE id = ? AND tombstoned_at IS NULL
        `)
        .run(payloadJson, payloadHash, now, eventId);
      this.database.prepare("DELETE FROM memory_claims WHERE event_id = ?").run(eventId);
      this.database
        .prepare("DELETE FROM memory_beliefs WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      // Threads are rebuildable projections. Clear the whole scoped view
      // inside the deletion transaction so a tombstoned event can never
      // remain visible through a stale open loop if the process stops before
      // the immediate rebuild finishes.
      this.database
        .prepare("DELETE FROM memory_threads WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database
        .prepare("DELETE FROM memory_prospective_triggers WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database
        .prepare(`
          DELETE FROM memory_attention_decisions
          WHERE id IN (
            SELECT decision_id FROM memory_attention_evidence WHERE event_id = ?
            UNION
            SELECT are.decision_id
            FROM memory_attention_relationship_evidence are
            JOIN memory_relationship_evidence re
              ON re.relationship_event_id = are.relationship_event_id
            WHERE re.event_id = ?
          )
        `)
        .run(eventId, eventId);
      this.database
        .prepare(`
          DELETE FROM memory_relationship_events
          WHERE id IN (
            SELECT relationship_event_id FROM memory_relationship_evidence WHERE event_id = ?
          )
        `)
        .run(eventId);
      this.database
        .prepare("DELETE FROM memory_relationship_state WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database
        .prepare("DELETE FROM memory_attention_profiles WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database
        .prepare("DELETE FROM memory_associations WHERE user_id = ? AND space = ?")
        .run(event.userId, event.space);
      this.database
        .prepare(`
          UPDATE memory_jobs
          SET status = 'succeeded', locked_at = NULL,
              last_error = NULL, updated_at = ?
          WHERE event_id = ? AND status IN ('pending','dead')
        `)
        .run(now, eventId);
      this.database
        .prepare(`
          UPDATE memory_state_jobs
          SET status = 'succeeded', locked_at = NULL,
              last_error = NULL, updated_at = ?
          WHERE event_id = ? AND kind = 'extract_and_project'
            AND status IN ('pending','dead')
        `)
        .run(now, eventId);
      this.database
        .prepare(`
          INSERT INTO memory_state_jobs(
            id, event_id, kind, status, attempts, available_at,
            locked_at, last_error, created_at, updated_at
          ) VALUES (?, ?, 'purge_mirror', 'pending', 0, ?, NULL, NULL, ?, ?)
          ON CONFLICT(event_id, kind) DO UPDATE SET
            status = 'pending', attempts = 0, available_at = excluded.available_at,
            locked_at = NULL, last_error = NULL, updated_at = excluded.updated_at
        `)
        .run(purgeJobId, eventId, now, now, now);
      this.database
        .prepare("INSERT INTO memory_deletion_audit(id, event_id, executed_at) VALUES (?, ?, ?)")
        .run(randomUUID(), eventId, now);
      this.database
        .prepare("UPDATE memory_deletion_consents SET used_at = ? WHERE token = ?")
        .run(now, token);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    const deleted = this.getEvent(eventId);
    if (!deleted) throw new Error(`memory ledger: deleted event ${eventId} vanished`);
    return {
      event: deleted,
      mirror,
      purgeJob: this.getStateJobForEvent(eventId, "purge_mirror"),
    };
  }

  verifyEventPayload(eventId: string): boolean {
    const row = this.database
      .prepare("SELECT payload_json, payload_hash FROM memory_events WHERE id = ?")
      .get(eventId) as SqlRow | undefined;
    return !!row && hashPayload(text(row, "payload_json")) === text(row, "payload_hash");
  }

  stats(): LedgerStats {
    const count = (table: string) => {
      const row = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as SqlRow;
      return integer(row, "count");
    };
    const statusCounts = (table: "memory_jobs" | "memory_state_jobs") => {
      const result: Record<MemoryJobStatus, number> = {
        pending: 0,
        processing: 0,
        succeeded: 0,
        dead: 0,
      };
      const rows = this.database
        .prepare(`SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status`)
        .all() as SqlRow[];
      for (const row of rows) {
        result[text(row, "status") as MemoryJobStatus] = integer(row, "count");
      }
      return result;
    };
    const integrityRow = this.database.prepare("PRAGMA quick_check").get() ?? {};
    return {
      databasePath: this.databasePath,
      schemaVersion: SCHEMA_VERSION,
      integrity: String(Object.values(integrityRow)[0] ?? "unknown"),
      events: count("memory_events"),
      jobs: statusCounts("memory_jobs"),
      stateJobs: statusCounts("memory_state_jobs"),
      claims: count("memory_claims"),
      beliefs: count("memory_beliefs"),
      threads: count("memory_threads"),
      threadTransitions: count("memory_thread_transitions"),
      prospective: count("memory_prospective_triggers"),
      attentionDecisions: count("memory_attention_decisions"),
      attentionOutcomes: count("memory_attention_outcomes"),
      attentionProfiles: count("memory_attention_profiles"),
      associations: count("memory_associations"),
      consolidationRuns: count("memory_consolidation_runs"),
      relationshipEvents: count("memory_relationship_events"),
      relationshipStates: count("memory_relationship_state"),
      mirrors: count("memory_mirrors"),
    };
  }
}

type MemoryGlobal = typeof globalThis & {
  __recallMemoryLedger?: MemoryEventLedger;
  __recallMemoryLedgerSchemaVersion?: number;
};

export function getMemoryEventLedger(): MemoryEventLedger {
  const memoryGlobal = globalThis as MemoryGlobal;
  if (
    !memoryGlobal.__recallMemoryLedger ||
    memoryGlobal.__recallMemoryLedgerSchemaVersion !== SCHEMA_VERSION
  ) {
    try {
      memoryGlobal.__recallMemoryLedger?.close();
    } catch {}
    memoryGlobal.__recallMemoryLedger = new MemoryEventLedger();
    memoryGlobal.__recallMemoryLedgerSchemaVersion = SCHEMA_VERSION;
  }
  return memoryGlobal.__recallMemoryLedger;
}
