import { smPost, smRequest, spaceTag, supermemory } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { rebuildBeliefs } from "@/lib/memory/belief-projector";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { processStateJob } from "@/lib/memory/state-reconciler";

export const runtime = "nodejs";

type SearchResponse = {
  results?: Array<{
    id: string;
    memory?: string;
    chunk?: string;
    similarity?: number;
    documents?: Array<{ id?: string }>;
  }>;
};

// Backs the voice agent's preview_forget / execute_forget client tools.
// The engine forgets one memory at a time (DELETE /v4/memories, a soft
// forget with a stored reason), so: preview = semantic search for the
// topic; execute = forget each match. dryRun defaults to true so a bare
// call can never delete anything; the destructive path additionally sits
// behind an on-screen approval in the UI.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      return Response.json({ error: "query required" }, { status: 400 });
    }
    const tag = spaceTag(asSpace(body.space));
    const found = await smPost<SearchResponse>("/v4/search", {
      q: query,
      containerTag: tag,
      limit: 8,
      threshold: 0.5,
      include: { documents: true },
    });
    // The engine's threshold is loose; keep only confident matches so the
    // approval modal never offers to forget something unrelated.
    const matches = (found.results ?? []).filter(
      (r) => r.id && (r.memory ?? r.chunk) && (r.similarity ?? 0) >= 0.62,
    );

    const canonical = new Map<string, { documentId: string; eventId: string }>();
    for (const match of matches) {
      const documentId = match.documents?.[0]?.id;
      if (!documentId) continue;
      const document = (await supermemory.documents.get(documentId).catch(() => null)) as {
        metadata?: Record<string, unknown> | null;
      } | null;
      const eventId = document?.metadata?.canonicalEventId;
      if (typeof eventId === "string") canonical.set(eventId, { documentId, eventId });
    }

    if (body.dryRun !== false) {
      return Response.json({
        count: matches.length,
        memories: matches.map((m) => m.memory ?? m.chunk),
        canonicalEvents: [...canonical.keys()],
      });
    }

    let forgotten = 0;
    let purgePending = 0;
    const deletedDocuments = new Set<string>();
    const rebuildSpaces = new Set<"personal" | "work" | "health" | "eval">();
    const ledger = getMemoryEventLedger();
    for (const item of canonical.values()) {
      const preview = ledger.createDeletionPreview(item.eventId);
      const deleted = ledger.tombstoneWithConsent(preview.token);
      rebuildSpaces.add(deleted.event.space);
      deletedDocuments.add(item.documentId);
      if (deleted.purgeJob) {
        const purge = await processStateJob(deleted.purgeJob.id, { ledger });
        if (purge.state === "pending" || purge.state === "dead") purgePending += 1;
      }
      forgotten += 1;
    }
    for (const space of rebuildSpaces) rebuildBeliefs(ledger, "local-user", space);

    for (const m of matches) {
      const documentId = m.documents?.[0]?.id;
      if (documentId && deletedDocuments.has(documentId)) continue;
      await smRequest("DELETE", "/v4/memories", {
        id: m.id,
        containerTag: tag,
        reason: `user asked to forget: ${query}`,
      });
      forgotten++;
    }
    if (purgePending) scheduleMemoryReconciliation();
    return Response.json({
      count: forgotten,
      purgePending,
      memories: matches.map((m) => m.memory ?? m.chunk),
    });
  } catch (err) {
    return apiError(err);
  }
}
