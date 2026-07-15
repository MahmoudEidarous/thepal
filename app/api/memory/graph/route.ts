import { createHash } from "node:crypto";
import { buildLifeGraph, type LifeGraphLens, type SemanticMemorySuggestion } from "@/lib/memory/life-graph";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

const LENSES = new Set<LifeGraphLens>(["current", "history", "all"]);
const SEMANTIC_BUDGET_MS = 900;

function semanticId(seed: string) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 20);
}

async function semanticNeighborhood(
  query: string,
  tag: string,
  requestSignal: AbortSignal,
): Promise<SemanticMemorySuggestion[]> {
  if (!query.trim()) return [];
  const result = await supermemory.search.memories(
    {
      q: query.trim(),
      containerTag: tag,
      searchMode: "memories",
      limit: 5,
      rerank: false,
      rewriteQuery: false,
      include: { relatedMemories: true },
    },
    {
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(SEMANTIC_BUDGET_MS)]),
      timeout: SEMANTIC_BUDGET_MS,
      maxRetries: 0,
    },
  );

  const roots: SemanticMemorySuggestion[] = [];
  const neighbors: SemanticMemorySuggestion[] = [];
  for (const item of result.results) {
    if (!item.memory?.trim()) continue;
    roots.push({
      id: item.id,
      memory: item.memory.trim(),
      similarity: item.similarity,
      updatedAt: item.updatedAt,
      relation: "result",
    });
    for (const related of item.context?.related?.slice(0, 2) ?? []) {
      const id = semanticId(`${item.id}:${related.relation}:${related.memory}`);
      neighbors.push({
        id,
        memory: related.memory.trim(),
        similarity: Math.max(0.35, item.similarity * 0.82),
        updatedAt: related.updatedAt,
        relation: related.relation,
        parentId: item.id,
      });
    }
  }
  return [...roots, ...neighbors];
}

export async function GET(request: Request) {
  try {
    scheduleMemoryReconciliation(250);
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const focus = url.searchParams.get("focus")?.trim().slice(0, 200) || null;
    const requestedLens = url.searchParams.get("lens") as LifeGraphLens | null;
    if (requestedLens && !LENSES.has(requestedLens)) {
      return Response.json({ error: "invalid graph lens" }, { status: 400 });
    }

    const ledger = getMemoryEventLedger();
    const userId = "local-user";
    const [semantic, events, claimEvidence, beliefs, threads, prospective] = await Promise.all([
      focus
        ? semanticNeighborhood(focus, spaceTag(space), request.signal).catch(() => [])
        : Promise.resolve([]),
      Promise.resolve(ledger.listActiveEvents(userId, space)),
      Promise.resolve(ledger.listClaimEvidence(userId, space)),
      Promise.resolve(ledger.listBeliefs({ userId, space, limit: 5_000 })),
      Promise.resolve(ledger.listThreads({ userId, space, limit: 5_000 })),
      Promise.resolve(
        ledger.listProspective({
          userId,
          space,
          includeClosed: true,
          includeSnoozed: true,
          limit: 500,
        }),
      ),
    ]);

    const graph = buildLifeGraph({
      userId,
      space,
      focus,
      lens: requestedLens ?? "current",
      beliefs,
      threads,
      events,
      claimEvidence,
      prospective,
      semantic,
      limit: Number(url.searchParams.get("limit") ?? 48),
    });
    return Response.json(graph, {
      headers: { "Cache-Control": "private, max-age=3, stale-while-revalidate=12" },
    });
  } catch (error) {
    return apiError(error);
  }
}
