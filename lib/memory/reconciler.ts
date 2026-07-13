import { CaptureEvidencePayloadSchema } from "./contracts";
import { findCanonicalSupermemoryMirror, processCaptureEvent } from "./capture-processor";
import {
  getMemoryEventLedger,
  type MemoryEventLedger,
  type MemoryJob,
} from "./event-ledger";

type SuccessfulProcessing = {
  state: "succeeded";
  externalId: string;
  response: Awaited<ReturnType<typeof processCaptureEvent>>["response"];
};

type DeferredProcessing = {
  state: "pending" | "dead" | "busy" | "already_succeeded";
  externalId?: string;
  error?: string;
};

export type ProcessingOutcome = SuccessfulProcessing | DeferredProcessing;

async function processClaimedJob(
  ledger: MemoryEventLedger,
  job: MemoryJob,
): Promise<ProcessingOutcome> {
  const event = ledger.getEvent(job.eventId);
  if (!event) {
    const updated = ledger.markJobFailed(job.id, new Error(`canonical event ${job.eventId} missing`));
    return { state: updated.status === "dead" ? "dead" : "pending", error: updated.lastError ?? undefined };
  }
  try {
    const knownMirror = ledger.getMirror(event.id);
    if (knownMirror) {
      ledger.markJobSucceeded(job.id);
      return { state: "already_succeeded", externalId: knownMirror.externalId };
    }
    // A process may die after Supermemory accepted the document but before
    // SQLite recorded the mirror. On retries, reconcile by canonicalEventId
    // before adding anything, keeping the provider side idempotent too.
    if (job.attempts > 1) {
      const externalId = await findCanonicalSupermemoryMirror(event.space, event.id).catch(
        () => null,
      );
      if (externalId) {
        ledger.recordSupermemoryMirror({
          eventId: event.id,
          externalId,
          payloadHash: event.payloadHash,
        });
        ledger.markJobSucceeded(job.id);
        return { state: "already_succeeded", externalId };
      }
    }
    const payload = CaptureEvidencePayloadSchema.parse(event.payload);
    const result = await processCaptureEvent({
      eventId: event.id,
      payloadHash: event.payloadHash,
      recordedAt: event.recordedAt,
      trust: event.source.trust,
      content: payload.content,
      preRedacted: payload.redacted,
      source: payload.legacySource,
      space: event.space,
      kind: payload.requested.kind,
      due: payload.requested.due ?? undefined,
    });
    ledger.recordSupermemoryMirror({
      eventId: event.id,
      externalId: result.externalId,
      payloadHash: event.payloadHash,
    });
    ledger.markJobSucceeded(job.id);
    return { state: "succeeded", externalId: result.externalId, response: result.response };
  } catch (error) {
    const updated = ledger.markJobFailed(job.id, error);
    return {
      state: updated.status === "dead" ? "dead" : "pending",
      error: updated.lastError ?? "capture processing failed",
    };
  }
}

export async function processCaptureJob(
  jobId: string,
  ledger: MemoryEventLedger = getMemoryEventLedger(),
): Promise<ProcessingOutcome> {
  const claimed = ledger.claimJob(jobId);
  if (claimed) return processClaimedJob(ledger, claimed);
  const job = ledger.getJob(jobId);
  if (!job) return { state: "dead", error: `memory job ${jobId} not found` };
  if (job.status === "succeeded") {
    const mirror = ledger.getMirror(job.eventId);
    return { state: "already_succeeded", externalId: mirror?.externalId };
  }
  if (job.status === "dead") return { state: "dead", error: job.lastError ?? undefined };
  return { state: "busy" };
}

export async function reconcileCaptureJobs(
  options: { limit?: number; ledger?: MemoryEventLedger } = {},
) {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const limit = Math.max(1, Math.min(10, Math.floor(options.limit ?? 2)));
  const now = new Date();
  ledger.recoverStaleJobs({ before: new Date(now.getTime() - 120_000).toISOString() });
  const outcomes: ProcessingOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const job = ledger.claimNextJob();
    if (!job) break;
    outcomes.push(await processClaimedJob(ledger, job));
  }
  return { processed: outcomes.length, outcomes, stats: ledger.stats() };
}
