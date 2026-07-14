import type {
  LedgerStats,
  MemoryJob,
  MemoryStateJob,
} from "./event-ledger";

export type MemoryHealthStatus = "healthy" | "catching_up" | "action_required";

export type MemoryHealthIssue = {
  code:
    | "database_integrity"
    | "semantic_mirror_failed"
    | "projection_failed"
    | "deletion_propagation_failed"
    | "pipeline_backlog";
  severity: "notice" | "warning" | "critical";
  count: number;
  summary: string;
  recovery: string;
};

export type MemoryHealthReport = {
  contractVersion: 1;
  status: MemoryHealthStatus;
  releaseReady: boolean;
  canonicalStore: "healthy" | "failed";
  backlog: {
    mirrorPending: number;
    projectionPending: number;
    deletionPending: number;
    mirrorDead: number;
    projectionDead: number;
    deletionDead: number;
  };
  issues: MemoryHealthIssue[];
};

export function assessMemoryHealth(input: {
  stats: LedgerStats;
  pendingStateJobs?: MemoryStateJob[];
  deadJobs?: MemoryJob[];
  deadStateJobs?: MemoryStateJob[];
}): MemoryHealthReport {
  const deadJobs = input.deadJobs ?? [];
  const pendingStateJobs = input.pendingStateJobs ?? [];
  const deadStateJobs = input.deadStateJobs ?? [];
  const integrityHealthy = input.stats.integrity === "ok";
  const projectionDead = deadStateJobs.filter((job) => job.kind === "extract_and_project").length;
  const deletionDead = deadStateJobs.filter((job) => job.kind === "purge_mirror").length;
  const unclassifiedStateDead = Math.max(
    0,
    input.stats.stateJobs.dead - projectionDead - deletionDead,
  );
  const mirrorDead = Math.max(input.stats.jobs.dead, deadJobs.length);
  const knownProjectionPending = pendingStateJobs.filter(
    (job) => job.kind === "extract_and_project",
  ).length;
  const deletionPending = pendingStateJobs.filter((job) => job.kind === "purge_mirror").length;
  const unclassifiedStatePending = Math.max(
    0,
    input.stats.stateJobs.pending +
      input.stats.stateJobs.processing -
      knownProjectionPending -
      deletionPending,
  );
  const issues: MemoryHealthIssue[] = [];

  if (!integrityHealthy) {
    issues.push({
      code: "database_integrity",
      severity: "critical",
      count: 1,
      summary: "The canonical SQLite ledger did not pass its integrity check.",
      recovery: "Stop memory writes, preserve the database, and restore or repair it before serving memory.",
    });
  }
  if (mirrorDead > 0) {
    issues.push({
      code: "semantic_mirror_failed",
      severity: "warning",
      count: mirrorDead,
      summary: "Canonical evidence is safe, but some events did not reach the semantic mirror.",
      recovery: "Restore Supermemory connectivity, then retry dead foundation jobs.",
    });
  }
  if (projectionDead + unclassifiedStateDead > 0) {
    issues.push({
      code: "projection_failed",
      severity: "critical",
      count: projectionDead + unclassifiedStateDead,
      summary: "Some canonical evidence has not been compiled into current truth and continuity state.",
      recovery: "Retry dead state jobs; reproject only if a normal retry cannot rebuild the derived state.",
    });
  }
  if (deletionDead > 0) {
    issues.push({
      code: "deletion_propagation_failed",
      severity: "critical",
      count: deletionDead,
      summary: "Canonical deletion completed, but provider mirror deletion still needs confirmation.",
      recovery: "Restore Supermemory connectivity and retry the dead purge jobs before release.",
    });
  }

  const pending = input.stats.jobs.pending +
    input.stats.jobs.processing +
    input.stats.stateJobs.pending +
    input.stats.stateJobs.processing;
  if (pending > 0) {
    issues.push({
      code: "pipeline_backlog",
      severity: "notice",
      count: pending,
      summary: "Accepted memory work is still being mirrored or projected.",
      recovery: "Allow reconciliation to finish; investigate only if the backlog does not drain.",
    });
  }

  const actionRequired = issues.some(
    (issue) => issue.severity === "critical" || issue.severity === "warning",
  );
  return {
    contractVersion: 1,
    status: actionRequired ? "action_required" : pending > 0 ? "catching_up" : "healthy",
    releaseReady: integrityHealthy && !actionRequired && pending === 0,
    canonicalStore: integrityHealthy ? "healthy" : "failed",
    backlog: {
      mirrorPending: input.stats.jobs.pending + input.stats.jobs.processing,
      projectionPending: knownProjectionPending + unclassifiedStatePending,
      deletionPending,
      mirrorDead,
      projectionDead: projectionDead + unclassifiedStateDead,
      deletionDead,
    },
    issues,
  };
}
