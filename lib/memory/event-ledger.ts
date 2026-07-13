import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CaptureEvidencePayload,
  EventKind,
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
const SCHEMA_VERSION = 1 as const;
const MAX_JOB_ATTEMPTS = 5;
const PROCESSING_JOB_KIND = "enrich_and_index" as const;

type SqlRow = Record<string, null | number | bigint | string | Uint8Array>;

export type MemoryJobStatus = "pending" | "processing" | "succeeded" | "dead";

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
  receipt: MemoryReceipt;
};

export type LedgerStats = {
  databasePath: string;
  schemaVersion: number;
  integrity: string;
  events: number;
  jobs: Record<MemoryJobStatus, number>;
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
    const current = Number(Object.values(versionRow)[0] ?? 0);
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
        this.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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

  appendEvent(input: AppendEventInput): AppendEventResult {
    if (input.idempotencyKey) {
      const existing = this.database
        .prepare("SELECT * FROM memory_events WHERE user_id = ? AND idempotency_key = ?")
        .get(input.userId, input.idempotencyKey) as SqlRow | undefined;
      if (existing) {
        const event = eventFromRow(existing);
        const jobRow = this.database
          .prepare("SELECT * FROM memory_jobs WHERE event_id = ? AND kind = ?")
          .get(event.id, PROCESSING_JOB_KIND) as SqlRow | undefined;
        if (!jobRow) throw new Error(`memory ledger: event ${event.id} is missing its processing job`);
        const job = jobFromRow(jobRow);
        return {
          event,
          job,
          receipt: {
            eventId: event.id,
            jobId: job.id,
            recordedAt: event.recordedAt,
            payloadHash: event.payloadHash,
            contractVersion: CONTRACT_VERSION,
            duplicate: true,
          },
        };
      }
    }

    const eventId = randomUUID();
    const jobId = randomUUID();
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
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    const event = this.getEvent(eventId);
    const job = this.getJob(jobId);
    if (!event || !job) throw new Error("memory ledger: committed receipt could not be read back");
    return {
      event,
      job,
      receipt: {
        eventId,
        jobId,
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

  listJobs(status?: MemoryJobStatus, limit = 50): MemoryJob[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = status
      ? this.database
          .prepare("SELECT * FROM memory_jobs WHERE status = ? ORDER BY created_at LIMIT ?")
          .all(status, safeLimit)
      : this.database.prepare("SELECT * FROM memory_jobs ORDER BY created_at LIMIT ?").all(safeLimit);
    return (rows as SqlRow[]).map(jobFromRow);
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
    const jobs: Record<MemoryJobStatus, number> = {
      pending: 0,
      processing: 0,
      succeeded: 0,
      dead: 0,
    };
    const jobRows = this.database
      .prepare("SELECT status, COUNT(*) AS count FROM memory_jobs GROUP BY status")
      .all() as SqlRow[];
    for (const row of jobRows) jobs[text(row, "status") as MemoryJobStatus] = integer(row, "count");
    const integrityRow = this.database.prepare("PRAGMA quick_check").get() ?? {};
    return {
      databasePath: this.databasePath,
      schemaVersion: SCHEMA_VERSION,
      integrity: String(Object.values(integrityRow)[0] ?? "unknown"),
      events: count("memory_events"),
      jobs,
      mirrors: count("memory_mirrors"),
    };
  }
}

type MemoryGlobal = typeof globalThis & {
  __recallMemoryLedger?: MemoryEventLedger;
};

export function getMemoryEventLedger(): MemoryEventLedger {
  const memoryGlobal = globalThis as MemoryGlobal;
  if (!memoryGlobal.__recallMemoryLedger) {
    memoryGlobal.__recallMemoryLedger = new MemoryEventLedger();
  }
  return memoryGlobal.__recallMemoryLedger;
}
