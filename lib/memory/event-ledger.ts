import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  Belief,
  CaptureEvidencePayload,
  ClaimRelation,
  EventKind,
  MemoryClaim,
  MemoryEvent,
  MemoryReceipt,
  MemorySource,
  MemorySpace,
  Sensitivity,
} from "./contracts";

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
const SCHEMA_VERSION = 2 as const;
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
  mirrored: boolean;
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
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
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
      limit: 500,
    })
      .filter((belief) =>
        [...belief.support, ...belief.opposition].some((claimId) => claimIds.has(claimId)),
      )
      .map((belief) => belief.key);
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
