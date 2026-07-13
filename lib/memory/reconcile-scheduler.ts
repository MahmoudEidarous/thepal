import { getMemoryEventLedger } from "./event-ledger";
import { reconcileCaptureJobs } from "./reconciler";
import { reconcileStateJobs } from "./state-reconciler";

type SchedulerGlobal = typeof globalThis & {
  __recallMemoryReconcileTimer?: ReturnType<typeof setTimeout>;
};

// Recall is a local long-lived Node process. A tiny in-process scheduler gives
// failed mirrors and derived-state work another chance, while SQLite job rows
// make both survive restarts. The foundation endpoint can also run them by hand.
export function scheduleMemoryReconciliation(delayMs = 1500) {
  const schedulerGlobal = globalThis as SchedulerGlobal;
  if (schedulerGlobal.__recallMemoryReconcileTimer) return;
  const timer = setTimeout(async () => {
    schedulerGlobal.__recallMemoryReconcileTimer = undefined;
    try {
      await Promise.all([
        reconcileCaptureJobs({ limit: 2 }),
        reconcileStateJobs({ limit: 2 }),
      ]);
    } finally {
      const stats = getMemoryEventLedger().stats();
      if (stats.jobs.pending > 0 || stats.stateJobs.pending > 0) {
        scheduleMemoryReconciliation(5000);
      }
    }
  }, Math.max(0, delayMs));
  timer.unref?.();
  schedulerGlobal.__recallMemoryReconcileTimer = timer;
}
