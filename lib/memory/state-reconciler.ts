import { rebuildBeliefs } from "./belief-projector";
import { extractClaimsForEvent } from "./extractor";
import {
  getMemoryEventLedger,
  type MemoryEventLedger,
  type MemoryStateJob,
} from "./event-ledger";
import type { MemoryClaim, MemoryEvent } from "./contracts";

export type ClaimExtractor = (
  event: MemoryEvent,
  options: Parameters<typeof extractClaimsForEvent>[1],
) => Promise<MemoryClaim[]>;

export type StateProcessingOutcome = {
  state: "succeeded" | "pending" | "dead" | "busy" | "already_succeeded";
  kind?: MemoryStateJob["kind"];
  claims?: number;
  beliefs?: number;
  excludedClaims?: number;
  error?: string;
};

function alignCorrectionClaims(
  ledger: MemoryEventLedger,
  event: MemoryEvent,
  claims: MemoryClaim[],
) {
  if (event.kind !== "correction" || !event.revisionOf) return claims;
  const targetClaims = ledger.listClaimsForEvent(event.revisionOf);
  return claims.map((claim) => {
    const candidates = targetClaims.filter((target) => target.predicate === claim.predicate);
    if (!candidates.length) return claim;
    const label = claim.subject.label.toLowerCase();
    const target =
      candidates.find(
        (item) =>
          item.subject.label.toLowerCase().includes(label) ||
          label.includes(item.subject.label.toLowerCase()),
      ) ?? (candidates.length === 1 ? candidates[0] : null);
    return target
      ? {
          ...claim,
          subject: target.subject,
          scope: target.scope,
          relationHint: "supersede" as const,
        }
      : claim;
  });
}

async function processClaimedStateJob(
  ledger: MemoryEventLedger,
  job: MemoryStateJob,
  extractor: ClaimExtractor,
  asOf?: string,
): Promise<StateProcessingOutcome> {
  const event = ledger.getEvent(job.eventId);
  if (!event) {
    const failed = ledger.markStateJobFailed(job.id, new Error(`canonical event ${job.eventId} missing`));
    return { state: failed.status === "dead" ? "dead" : "pending", kind: job.kind };
  }
  try {
    if (job.kind === "purge_mirror") {
      let mirror = ledger.getMirror(event.id);
      if (mirror?.status === "deleted") {
        ledger.markStateJobSucceeded(job.id);
        return { state: "succeeded", kind: job.kind };
      }
      try {
        if (!mirror) {
          const { findCanonicalSupermemoryMirror } = await import("./capture-processor");
          const externalId = await findCanonicalSupermemoryMirror(event.space, event.id);
          if (!externalId) {
            ledger.markStateJobSucceeded(job.id);
            return { state: "succeeded", kind: job.kind };
          }
          ledger.recordSupermemoryMirror({
            eventId: event.id,
            externalId,
            payloadHash: event.payloadHash,
          });
          mirror = ledger.getMirror(event.id);
        }
        if (!mirror) throw new Error(`provider mirror for ${event.id} could not be recorded`);
        const [{ supermemory }, { invalidateCorpus }] = await Promise.all([
          import("../supermemory"),
          import("../fusion"),
        ]);
        await supermemory.documents.delete(mirror.externalId);
        invalidateCorpus(event.space);
      } catch (error) {
        ledger.markSupermemoryMirrorDeletionFailed(event.id, error);
        throw error;
      }
      ledger.markSupermemoryMirrorDeleted(event.id);
      ledger.markStateJobSucceeded(job.id);
      return { state: "succeeded", kind: job.kind };
    }

    if (event.tombstonedAt) {
      const projection = rebuildBeliefs(ledger, event.userId, event.space, { asOf });
      ledger.markStateJobSucceeded(job.id);
      return {
        state: "succeeded",
        kind: job.kind,
        claims: 0,
        beliefs: projection.beliefs.length,
        excludedClaims: projection.excludedClaimIds.length,
      };
    }
    const currentBeliefs = ledger.listBeliefs({
      userId: event.userId,
      space: event.space,
      status: "current",
      limit: 30,
    });
    const claims = alignCorrectionClaims(
      ledger,
      event,
      await extractor(event, { currentBeliefs }),
    );
    ledger.replaceClaimsForEvent(event.id, claims);
    const projection = rebuildBeliefs(ledger, event.userId, event.space, { asOf });
    ledger.markStateJobSucceeded(job.id);
    return {
      state: "succeeded",
      kind: job.kind,
      claims: claims.length,
      beliefs: projection.beliefs.length,
      excludedClaims: projection.excludedClaimIds.length,
    };
  } catch (error) {
    const failed = ledger.markStateJobFailed(job.id, error);
    return {
      state: failed.status === "dead" ? "dead" : "pending",
      kind: job.kind,
      error: failed.lastError ?? "state projection failed",
    };
  }
}

export async function processStateJob(
  jobId: string,
  options: {
    ledger?: MemoryEventLedger;
    extractor?: ClaimExtractor;
    now?: string;
    asOf?: string;
  } = {},
): Promise<StateProcessingOutcome> {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const extractor = options.extractor ?? extractClaimsForEvent;
  const claimed = ledger.claimStateJob(jobId, options.now);
  if (claimed) return processClaimedStateJob(ledger, claimed, extractor, options.asOf);
  const job = ledger.getStateJob(jobId);
  if (!job) return { state: "dead", error: `memory state job ${jobId} not found` };
  if (job.status === "succeeded") return { state: "already_succeeded", kind: job.kind };
  if (job.status === "dead") {
    return { state: "dead", kind: job.kind, error: job.lastError ?? undefined };
  }
  return { state: "busy", kind: job.kind };
}

export async function reconcileStateJobs(
  options: { limit?: number; ledger?: MemoryEventLedger; extractor?: ClaimExtractor } = {},
) {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const extractor = options.extractor ?? extractClaimsForEvent;
  const limit = Math.max(1, Math.min(10, Math.floor(options.limit ?? 2)));
  const now = new Date();
  ledger.recoverStaleStateJobs({ before: new Date(now.getTime() - 120_000).toISOString() });
  const outcomes: StateProcessingOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const job = ledger.claimNextStateJob();
    if (!job) break;
    outcomes.push(await processClaimedStateJob(ledger, job, extractor));
  }
  return { processed: outcomes.length, outcomes, stats: ledger.stats() };
}
