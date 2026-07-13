// Phase 0/1 replay: no dev server, model, or Supermemory process required.
// It validates the persisted contract, trust policy, local redaction,
// transactional receipt, idempotency, retry lifecycle, mirror linkage,
// restart durability, and SQLite integrity.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BeliefSchema,
  CaptureEvidencePayloadSchema,
  CaptureRequestSchema,
  MemoryClaimSchema,
  MemoryEventSchema,
  MemoryReceiptSchema,
} from "../lib/memory/contracts.ts";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";
import { memoryFoundationMode } from "../lib/memory/flags.ts";
import { redactSecrets } from "../lib/memory/redaction.ts";
import { classifyCaptureSource } from "../lib/memory/source-policy.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "fixtures", "memory-foundation.json"), "utf8"),
);
const directory = mkdtempSync(join(tmpdir(), "recall-memory-foundation-"));
const databasePath = join(directory, "memory.sqlite");
const BASE_TIME = "2026-07-14T09:00:00.000Z";
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
  console.log(`✅  ${message}`);
};

let ledger = new MemoryEventLedger({ databasePath });
try {
  const configuredMode = process.env.RECALL_MEMORY_FOUNDATION_MODE;
  try {
    delete process.env.RECALL_MEMORY_FOUNDATION_MODE;
    check(memoryFoundationMode() === "required", "foundation defaults to fail-closed required mode");
    process.env.RECALL_MEMORY_FOUNDATION_MODE = "shadow";
    check(memoryFoundationMode() === "shadow", "shadow rollout mode is selectable");
    process.env.RECALL_MEMORY_FOUNDATION_MODE = "off";
    check(memoryFoundationMode() === "off", "legacy rollback mode is selectable");
    process.env.RECALL_MEMORY_FOUNDATION_MODE = "invalid";
    check(memoryFoundationMode() === "required", "invalid rollout mode fails closed");
  } finally {
    if (configuredMode === undefined) delete process.env.RECALL_MEMORY_FOUNDATION_MODE;
    else process.env.RECALL_MEMORY_FOUNDATION_MODE = configuredMode;
  }

  const receipts = [];
  for (const [index, testCase] of fixture.cases.entries()) {
    const request = CaptureRequestSchema.parse({
      content: testCase.content,
      source: testCase.source,
      kind: testCase.kind,
      space: "eval",
      idempotencyKey: `fixture:${index}`,
    });
    const classification = classifyCaptureSource(request.source);
    const redaction = redactSecrets(request.content);
    const payload = CaptureEvidencePayloadSchema.parse({
      content: redaction.text,
      redacted: redaction.redacted,
      legacySource: request.source,
      requested: { kind: request.kind, due: null },
    });
    const appended = ledger.appendEvent({
      userId: "fixture-user",
      space: "eval",
      kind: classification.eventKind,
      payload,
      source: classification.source,
      sensitivity: redaction.redacted ? "sensitive" : "normal",
      idempotencyKey: request.idempotencyKey,
      recordedAt: new Date(Date.parse(BASE_TIME) + index * 1000).toISOString(),
    });
    MemoryEventSchema.parse(appended.event);
    MemoryReceiptSchema.parse(appended.receipt);
    receipts.push(appended.receipt);
    check(classification.eventKind === testCase.expected.eventKind, `${testCase.name}: event kind`);
    check(classification.source.actor === testCase.expected.actor, `${testCase.name}: actor`);
    check(classification.source.channel === testCase.expected.channel, `${testCase.name}: channel`);
    check(classification.source.trust === testCase.expected.trust, `${testCase.name}: trust tier`);
    check(redaction.redacted === testCase.expected.redacted, `${testCase.name}: redaction decision`);
    check(ledger.verifyEventPayload(appended.event.id), `${testCase.name}: payload hash`);
    if (redaction.redacted) {
      check(!appended.event.payload.content.includes("sk-or-v1"), `${testCase.name}: secret absent`);
    }
  }

  const first = fixture.cases[0];
  const firstClass = classifyCaptureSource(first.source);
  const duplicate = ledger.appendEvent({
    userId: "fixture-user",
    space: "eval",
    kind: firstClass.eventKind,
    payload: {
      content: first.content,
      redacted: false,
      legacySource: first.source,
      requested: { kind: first.kind, due: null },
    },
    source: firstClass.source,
    sensitivity: "normal",
    idempotencyKey: "fixture:0",
    recordedAt: BASE_TIME,
  });
  check(duplicate.receipt.duplicate, "idempotent retry returns the existing receipt");
  check(duplicate.receipt.eventId === receipts[0].eventId, "idempotent retry keeps one event ID");

  const job = ledger.claimJob(receipts[0].jobId, BASE_TIME);
  check(job?.status === "processing" && job.attempts === 1, "pending job receives a processing lease");
  const retryAt = "2026-07-14T09:00:10.000Z";
  const failed = ledger.markJobFailed(job.id, new Error("simulated Supermemory outage"), {
    now: "2026-07-14T09:00:01.000Z",
    retryAt,
  });
  check(failed.status === "pending" && failed.lastError?.includes("outage"), "failed mirror remains retryable");
  check(ledger.claimJob(job.id, "2026-07-14T09:00:09.000Z") === null, "backoff prevents an early retry");
  const retried = ledger.claimJob(job.id, retryAt);
  check(retried?.attempts === 2, "due retry obtains a second lease");
  ledger.recordSupermemoryMirror({
    eventId: receipts[0].eventId,
    externalId: "sm-fixture-1",
    payloadHash: receipts[0].payloadHash,
    syncedAt: "2026-07-14T09:00:11.000Z",
  });
  ledger.markJobSucceeded(job.id, "2026-07-14T09:00:11.000Z");
  check(ledger.getJob(job.id)?.status === "succeeded", "successful retry closes the job");
  check(ledger.getMirror(receipts[0].eventId)?.externalId === "sm-fixture-1", "mirror links to canonical event");

  const secondJob = ledger.claimJob(receipts[1].jobId, "2026-07-14T09:01:00.000Z");
  check(secondJob?.status === "processing", "second job can enter processing");
  check(
    ledger.recoverStaleJobs({
      before: "2026-07-14T09:01:30.000Z",
      now: "2026-07-14T09:02:00.000Z",
    }) === 1,
    "stale processing lease returns to the queue",
  );

  const terminalJobId = receipts[2].jobId;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const now = new Date(Date.parse(BASE_TIME) + 120_000 + attempt * 1000).toISOString();
    const terminalJob = ledger.claimJob(terminalJobId, now);
    assert.ok(terminalJob, `terminal job claim ${attempt}`);
    ledger.markJobFailed(terminalJob.id, new Error("provider remains unavailable"), {
      now,
      retryAt: now,
    });
  }
  check(ledger.getJob(terminalJobId)?.status === "dead", "bounded retries eventually park a dead job");
  check(
    ledger.requeueDeadJobs(1, "2026-07-14T09:03:00.000Z") === 1 &&
      ledger.getJob(terminalJobId)?.attempts === 0,
    "manual repair can safely requeue a dead job",
  );

  const beforeRestart = ledger.stats();
  check(beforeRestart.integrity === "ok", "SQLite quick_check is clean");
  check(beforeRestart.events === fixture.cases.length, "one canonical event exists per fixture");
  ledger.close();
  ledger = new MemoryEventLedger({ databasePath });
  check(ledger.getEvent(receipts[0].eventId)?.payload.content === first.content, "event survives process restart");
  check(ledger.getMirror(receipts[0].eventId)?.externalId === "sm-fixture-1", "mirror survives process restart");
  check(ledger.stats().events === fixture.cases.length, "restart creates no duplicate events");

  const claim = MemoryClaimSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    eventId: receipts[0].eventId,
    subject: { id: "user:local", kind: "user", label: "User" },
    predicate: "meeting.scheduled_for",
    object: { type: "date", value: "2026-07-24" },
    polarity: 1,
    modality: "asserted",
    validTime: { start: "2026-07-24", end: null, precision: "day" },
    scope: { space: "eval", contexts: ["Vienna"] },
    extractorVersion: "fixture-v1",
  });
  check(claim.eventId === receipts[0].eventId, "claim contract preserves evidence provenance");
  check(claim.validTime?.precision === "day", "claim contract preserves valid-time precision");

  const belief = BeliefSchema.parse({
    key: "user:local|meeting.scheduled_for|vienna",
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.object,
    status: "current",
    confidence: "direct",
    validTime: claim.validTime,
    systemTime: { start: BASE_TIME, end: null, precision: "instant" },
    scope: claim.scope,
    support: [claim.id],
    opposition: [],
    projectorVersion: "fixture-v1",
  });
  check(belief.support[0] === claim.id, "belief contract points back to supporting claims");
  check(belief.systemTime.start === BASE_TIME, "belief contract separates system time from valid time");

  assert.throws(
    () =>
      BeliefSchema.parse({
        ...belief,
        key: "unsupported-belief",
        support: [],
      }),
    /too_small|at least/i,
  );
  check(true, "unsupported belief is rejected by the contract");

  assert.throws(
    () => CaptureRequestSchema.parse({ content: "", source: "recall-app" }),
    /too_small|at least|expected/i,
  );
  check(true, "invalid empty capture is rejected by the contract");

  console.log(`\n${checks} memory-foundation checks passed`);
} finally {
  try {
    ledger.close();
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
