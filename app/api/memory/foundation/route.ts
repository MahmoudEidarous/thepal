import { getMemoryEventLedger, type MemoryJob } from "@/lib/memory/event-ledger";
import { reconcileCaptureJobs } from "@/lib/memory/reconciler";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { apiError } from "@/lib/validate";

export const runtime = "nodejs";

function publicStats() {
  const stats = getMemoryEventLedger().stats();
  return {
    storage: "local-sqlite",
    schemaVersion: stats.schemaVersion,
    integrity: stats.integrity,
    events: stats.events,
    jobs: stats.jobs,
    mirrors: stats.mirrors,
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
    const result = await reconcileCaptureJobs({ limit: requested });
    return Response.json({
      requeued,
      processed: result.processed,
      outcomes: result.outcomes.map((outcome) => ({ state: outcome.state })),
      stats: publicStats(),
    });
  } catch (error) {
    return apiError(error);
  }
}
