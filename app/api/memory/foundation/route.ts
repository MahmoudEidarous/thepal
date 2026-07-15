import {
  getMemoryEventLedger,
  type MemoryJob,
  type MemoryStateJob,
} from "@/lib/memory/event-ledger";
import { reconcileCaptureJobs } from "@/lib/memory/reconciler";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { reconcileStateJobs } from "@/lib/memory/state-reconciler";
import { assessMemoryHealth } from "@/lib/memory/health";
import type { MemorySpace } from "@/lib/memory/contracts";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

const USER_SPACES: MemorySpace[] = ["personal", "work", "health"];

function publicStats(ledger = getMemoryEventLedger()) {
  const stats = ledger.stats();
  const queues = ledger.operationalQueueStats(USER_SPACES);
  const scopedStats = { ...stats, jobs: queues.jobs, stateJobs: queues.stateJobs };
  const pendingStateJobs = [
    ...ledger.listStateJobsForSpaces("pending", USER_SPACES, 500),
    ...ledger.listStateJobsForSpaces("processing", USER_SPACES, 500),
  ];
  const deadJobs = ledger.listJobsForSpaces("dead", USER_SPACES, 500);
  const deadStateJobs = ledger.listStateJobsForSpaces("dead", USER_SPACES, 500);
  return {
    storage: "local-sqlite",
    schemaVersion: stats.schemaVersion,
    integrity: stats.integrity,
    events: stats.events,
    jobs: queues.jobs,
    stateJobs: queues.stateJobs,
    claims: stats.claims,
    beliefs: stats.beliefs,
    threads: stats.threads,
    threadTransitions: stats.threadTransitions,
    prospective: stats.prospective,
    attentionDecisions: stats.attentionDecisions,
    relationshipEvents: stats.relationshipEvents,
    relationshipStates: stats.relationshipStates,
    mirrors: stats.mirrors,
    healthScope: USER_SPACES,
    health: assessMemoryHealth({
      stats: scopedStats,
      pendingStateJobs,
      deadJobs,
      deadStateJobs,
    }),
    evaluationQueues: ledger.operationalQueueStats(["eval"]),
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
      ...publicStats(ledger),
      pending: ledger.listJobsForSpaces("pending", USER_SPACES, 20).map(publicJob),
      dead: ledger.listJobsForSpaces("dead", USER_SPACES, 20).map(publicJob),
      statePending: ledger.listStateJobsForSpaces("pending", USER_SPACES, 20).map(publicStateJob),
      stateDead: ledger.listStateJobsForSpaces("dead", USER_SPACES, 20).map(publicStateJob),
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
    const requeued = body.retryDead === true
      ? ledger.requeueDeadJobsForSpaces(USER_SPACES, requested)
      : 0;
    const stateRequeued = body.retryDead === true
      ? ledger.requeueDeadStateJobsForSpaces(USER_SPACES, requested)
      : 0;
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
      stats: publicStats(ledger),
    });
  } catch (error) {
    return apiError(error);
  }
}
