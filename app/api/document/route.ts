import { supermemory } from "@/lib/supermemory";
import { apiError } from "@/lib/validate";
import { rebuildBeliefs } from "@/lib/memory/belief-projector";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { processStateJob } from "@/lib/memory/state-reconciler";

export const runtime = "nodejs";

// Full document by id — the captures view expands with this (the
// stored content carries the embedded phrasing hints).
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return Response.json({ error: "id required" }, { status: 400 });
    }
    const doc = (await supermemory.documents.get(id)) as {
      content?: string | null;
      metadata?: Record<string, unknown> | null;
      createdAt?: string;
    };
    return Response.json({
      content: doc.content ?? "",
      metadata: doc.metadata ?? {},
      createdAt: doc.createdAt,
    });
  } catch (err) {
    return apiError(err);
  }
}

// Dismiss a document (e.g. a failed capture) from the feed.
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json().catch(() => ({}));
    if (typeof id !== "string" || !id) {
      return Response.json({ error: "id required" }, { status: 400 });
    }
    const document = (await supermemory.documents.get(id).catch(() => null)) as {
      metadata?: Record<string, unknown> | null;
    } | null;
    const eventId = document?.metadata?.canonicalEventId;
    if (typeof eventId === "string") {
      const ledger = getMemoryEventLedger();
      const preview = ledger.createDeletionPreview(eventId);
      const deleted = ledger.tombstoneWithConsent(preview.token);
      const projection = rebuildBeliefs(ledger, deleted.event.userId, deleted.event.space);
      const purge = deleted.purgeJob
        ? await processStateJob(deleted.purgeJob.id, { ledger })
        : null;
      if (purge?.state === "pending" || purge?.state === "dead") {
        scheduleMemoryReconciliation();
      }
      return Response.json({
        deleted: true,
        canonical: true,
        eventId,
        beliefsRebuilt: projection.beliefs.length,
        purge: purge?.state ?? "not_needed",
      });
    }
    await supermemory.documents.delete(id);
    return Response.json({ deleted: true, canonical: false });
  } catch (err) {
    return apiError(err);
  }
}
