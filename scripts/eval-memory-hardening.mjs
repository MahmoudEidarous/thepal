// Phase 9 operational replay: health classification and durable retry behavior.
// This is intentionally small; the release runner composes the existing phase banks.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";
import { assessMemoryHealth } from "../lib/memory/health.ts";
import { isAlreadyDeletedProviderError } from "../lib/memory/state-reconciler.ts";
import { pinTemporarySelfStateType } from "../lib/envelope.ts";

const directory = mkdtempSync(join(tmpdir(), "recall-memory-hardening-"));
const databasePath = join(directory, "memory.sqlite");
const AT = "2026-07-14T12:00:00.000Z";
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
  console.log(`✅  ${message}`);
};

const health = (ledger) => assessMemoryHealth({
  stats: ledger.stats(),
  pendingStateJobs: [
    ...ledger.listStateJobs("pending", 500),
    ...ledger.listStateJobs("processing", 500),
  ],
  deadJobs: ledger.listJobs("dead", 500),
  deadStateJobs: ledger.listStateJobs("dead", 500),
});

function failStateJobToDead(ledger, id) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = new Date(Date.parse(AT) + attempt * 1000).toISOString();
    const claimed = ledger.claimStateJob(id, now);
    assert.ok(claimed, `state job should be claimable on attempt ${attempt + 1}`);
    ledger.markStateJobFailed(id, new Error("simulated provider outage"), {
      now,
      retryAt: now,
    });
  }
}

let ledger = new MemoryEventLedger({ databasePath });
try {
  const empty = health(ledger);
  check(empty.status === "healthy", "an empty intact ledger is healthy");
  check(empty.releaseReady, "a drained healthy ledger is release ready");
  check(empty.issues.length === 0, "healthy output does not invent operational issues");
  check(isAlreadyDeletedProviderError({ status: 404 }), "provider 404 completes idempotent deletion");
  check(!isAlreadyDeletedProviderError({ status: 409 }), "provider conflict remains retryable");
  check(!isAlreadyDeletedProviderError(new Error("404 in unrelated text")), "message text cannot fake deletion completion");
  const baseEnvelope = {
    text: "I think I'm falling behind on everything this week.",
    type: "fact",
    provenance: "stated",
    storyDate: "2026-07-14",
    due: null,
    valence: -1,
    intensity: 0.6,
    salience: 0.3,
    entities: [],
    hints: ["How has this week felt?"],
    redacted: false,
    commitments: [],
    prospective: null,
    supersedes: null,
  };
  check(
    pinTemporarySelfStateType(baseEnvelope, baseEnvelope.text)?.type === "impression",
    "a temporary self-state cannot harden into a permanent fact",
  );
  check(
    pinTemporarySelfStateType(
      { ...baseEnvelope, type: "safety" },
      "I feel anxious because this allergy puts me in the hospital.",
    )?.type === "safety",
    "temporary-state normalization never overrides safety",
  );

  const appended = ledger.appendEvent({
    userId: "fixture-user",
    space: "eval",
    kind: "utterance",
    payload: {
      content: "The Vienna call moved to July 24th.",
      redacted: false,
      legacySource: "phase-9-replay",
      requested: { kind: "memory", due: null },
    },
    source: {
      actor: "user",
      channel: "text",
      trust: "user_direct",
      label: "phase-9-replay",
    },
    sensitivity: "normal",
    idempotencyKey: "phase-9:vienna-change",
    recordedAt: AT,
  });
  const queued = health(ledger);
  check(queued.status === "catching_up", "accepted asynchronous work reports catching up");
  check(!queued.releaseReady, "a pending pipeline is not reported as release ready");
  check(queued.backlog.mirrorPending === 1 && queued.backlog.projectionPending === 1, "health separates mirror and projection backlog");

  const mirrorJob = ledger.claimJob(appended.job.id, AT);
  assert.ok(mirrorJob);
  ledger.markJobSucceeded(mirrorJob.id, AT);
  const stateJob = ledger.claimStateJob(appended.stateJob.id, AT);
  assert.ok(stateJob);
  ledger.markStateJobSucceeded(stateJob.id, AT);
  check(health(ledger).status === "healthy", "draining both pipelines restores healthy status");

  const projection = ledger.enqueueStateJob(appended.event.id, "extract_and_project", AT);
  failStateJobToDead(ledger, projection.id);
  const projectionFailure = health(ledger);
  check(projectionFailure.status === "action_required", "dead projection work requires action");
  check(projectionFailure.backlog.projectionDead === 1, "projection failure is classified separately");
  check(projectionFailure.issues.some((issue) => issue.code === "projection_failed"), "projection recovery is explicit");
  check(!JSON.stringify(projectionFailure).includes("simulated provider outage"), "health never exposes raw provider errors");

  check(ledger.requeueDeadStateJobs(1, AT) === 1, "dead state work can be requeued durably");
  check(health(ledger).status === "catching_up", "requeued work returns to catching-up state");
  const retriedProjection = ledger.claimStateJob(projection.id, AT);
  assert.ok(retriedProjection);
  ledger.markStateJobSucceeded(retriedProjection.id, AT);

  const purge = ledger.enqueueStateJob(appended.event.id, "purge_mirror", AT);
  failStateJobToDead(ledger, purge.id);
  const deletionFailure = health(ledger);
  check(deletionFailure.backlog.deletionDead === 1, "failed deletion propagation has its own counter");
  check(deletionFailure.issues.some((issue) => issue.code === "deletion_propagation_failed"), "failed deletion propagation blocks release");
  check(deletionFailure.canonicalStore === "healthy", "provider failure does not misreport canonical corruption");

  ledger.close();
  ledger = new MemoryEventLedger({ databasePath });
  check(health(ledger).backlog.deletionDead === 1, "operational failure classification survives restart");
  check(ledger.stats().integrity === "ok", "hardening replay preserves SQLite integrity");

  console.log(`\n${checks} memory-hardening checks passed`);
} finally {
  try {
    ledger.close();
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
