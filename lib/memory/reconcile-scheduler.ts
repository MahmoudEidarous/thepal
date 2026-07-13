import { getMemoryEventLedger } from "./event-ledger";
import { reconcileCaptureJobs } from "./reconciler";

type SchedulerGlobal = typeof globalThis & {
  __recallMemoryReconcileTimer?: ReturnType<typeof setTimeout>;
};

// Recall is a local long-lived Node process. A tiny in-process scheduler gives
// failed Supermemory mirrors another chance, while the SQLite job row makes the
// work survive restarts. The foundation status endpoint can also run it by hand.
export function scheduleMemoryReconciliation(delayMs = 1500) {
  const schedulerGlobal = globalThis as SchedulerGlobal;
  if (schedulerGlobal.__recallMemoryReconcileTimer) return;
  const timer = setTimeout(async () => {
    schedulerGlobal.__recallMemoryReconcileTimer = undefined;
    try {
      await reconcileCaptureJobs({ limit: 2 });
    } finally {
      const stats = getMemoryEventLedger().stats();
      if (stats.jobs.pending > 0) scheduleMemoryReconciliation(5000);
    }
  }, Math.max(0, delayMs));
  timer.unref?.();
  schedulerGlobal.__recallMemoryReconcileTimer = timer;
}
