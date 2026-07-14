import {
  getMemoryEventLedger,
  type MemoryJob,
  type MemoryStateJob,
} from "@/lib/memory/event-ledger";
import { reconcileCaptureJobs } from "@/lib/memory/reconciler";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { reconcileStateJobs } from "@/lib/memory/state-reconciler";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

function publicStats() {
  const stats = getMemoryEventLedger().stats();
  return {
    storage: "local-sqlite",
    schemaVersion: stats.schemaVersion,
    integrity: stats.integrity,
    events: stats.events,
    jobs: stats.jobs,
    stateJobs: stats.stateJobs,
    claims: stats.claims,
    beliefs: stats.beliefs,
    threads: stats.threads,
    threadTransitions: stats.threadTransitions,
    prospective: stats.prospective,
    attentionDecisions: stats.attentionDecisions,
    mirrors: stats.mirrors,
  };
}

function publicStateJob(job: MemoryStateJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    availableAt: job.availableAt,
  };
}

function publicJob(job: MemoryJob) {
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    availableAt: job.availableAt,
  };
}

export async function GET() {
  try {
    scheduleMemoryReconciliation(250);
    const ledger = getMemoryEventLedger();
    return Response.json({
      contractVersion: 1,
      ...publicStats(),
      pending: ledger.listJobs("pending", 20).map(publicJob),
      dead: ledger.listJobs("dead", 20).map(publicJob),
      statePending: ledger.listStateJobs("pending", 20).map(publicStateJob),
      stateDead: ledger.listStateJobs("dead", 20).map(publicStateJob),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requested = typeof body.limit === "number" ? body.limit : 2;
    const ledger = getMemoryEventLedger();
    const requeued = body.retryDead === true ? ledger.requeueDeadJobs(requested) : 0;
    const stateRequeued = body.retryDead === true ? ledger.requeueDeadStateJobs(requested) : 0;
    const reprojected = body.reproject === true
      ? ledger.requeueProjectionJobs({
          userId: "local-user",
          space: typeof body.space === "string" ? asSpace(body.space) : undefined,
        })
      : 0;
    const [result, stateResult] = await Promise.all([
      reconcileCaptureJobs({ limit: requested }),
      reconcileStateJobs({ limit: requested }),
    ]);
    if (
      reprojected > stateResult.processed ||
      requeued > result.processed ||
      stateRequeued > stateResult.processed
    ) {
      scheduleMemoryReconciliation(250);
    }
    return Response.json({
      requeued,
      stateRequeued,
      reprojected,
      processed: result.processed,
      outcomes: result.outcomes.map((outcome) => ({ state: outcome.state })),
      stateProcessed: stateResult.processed,
      stateOutcomes: stateResult.outcomes.map((outcome) => ({
        state: outcome.state,
        kind: outcome.kind,
      })),
      stats: publicStats(),
    });
  } catch (error) {
    return apiError(error);
  }
}
