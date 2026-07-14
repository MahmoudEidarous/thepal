import { rebuildBeliefs } from "@/lib/memory/belief-projector";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { processStateJob } from "@/lib/memory/state-reconciler";
import { rebuildThreads } from "@/lib/memory/thread-engine";
import { rebuildProspective } from "@/lib/memory/prospective-projector";
import { rebuildRelationshipState } from "@/lib/memory/relationship-service";
import { apiError } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return Response.json({ error: "deletion consent token required" }, { status: 400 });
    const ledger = getMemoryEventLedger();
    const deleted = ledger.tombstoneWithConsent(token);
    const projection = rebuildBeliefs(ledger, deleted.event.userId, deleted.event.space);
    const threadProjection = rebuildThreads(ledger, deleted.event.userId, deleted.event.space);
    const prospectiveProjection = rebuildProspective(
      ledger,
      deleted.event.userId,
      deleted.event.space,
    );
    const relationshipProjection = rebuildRelationshipState(
      ledger,
      deleted.event.userId,
      deleted.event.space,
    );
    let purge: Awaited<ReturnType<typeof processStateJob>> | null = null;
    if (deleted.purgeJob) {
      purge = await processStateJob(deleted.purgeJob.id, { ledger });
      if (purge.state === "pending" || purge.state === "dead") {
        scheduleMemoryReconciliation();
      }
    }
    return Response.json({
      eventId: deleted.event.id,
      deletedAt: deleted.event.tombstonedAt,
      claimsRemaining: ledger.listClaimsForEvent(deleted.event.id).length,
      beliefsRebuilt: projection.beliefs.length,
      threadsRebuilt: threadProjection.threads.length,
      prospectiveRebuilt: prospectiveProjection.triggers.length,
      relationshipItemsRebuilt:
        relationshipProjection.promises.length +
        relationshipProjection.boundaries.length +
        relationshipProjection.humor.length,
      purge: purge?.state ?? "not_needed",
    });
  } catch (error) {
    return apiError(error);
  }
}
