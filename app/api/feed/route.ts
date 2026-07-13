import { supermemory, spaceTag, smPost } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";

export const runtime = "nodejs";

type EntriesResponse = {
  memoryEntries: Array<{
    id: string;
    memory: string;
    version: number;
    isLatest: boolean;
    isForgotten: boolean;
    isStatic: boolean;
    isInference: boolean;
    createdAt: string;
    updatedAt: string;
    memoryRelations: Record<string, string>;
    history: Array<{ id: string; memory: string; version: number; createdAt: string }>;
  }>;
};

// One poll feeds the whole live panel: extracted memories (with supersede
// history) plus documents still moving through the pipeline.
export async function GET(request: Request) {
  try {
    // The feed already polls while Recall is open, making it a reliable,
    // zero-extra-request heartbeat for canonical events awaiting a mirror.
    scheduleMemoryReconciliation(250);
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));

    const [entriesRes, docsRes] = await Promise.all([
      smPost<EntriesResponse>("/v4/memories/list", { containerTags: [tag], limit: 50 }),
      supermemory.documents.list({ containerTags: [tag], limit: 12, sort: "createdAt", order: "desc" }),
    ]);

    const entries = (entriesRes.memoryEntries ?? [])
      .filter((e) => e.isLatest && !e.isForgotten)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

    const docs = (docsRes as { memories?: Array<{ id: string; status?: string | null; title?: string | null; content?: string | null; createdAt?: string }> }).memories ?? [];
    const processing = docs.filter((d) => d.status && !["done", "failed"].includes(d.status));
    const failed = docs.filter((d) => d.status === "failed");

    return Response.json({ entries, processing, failed });
  } catch (err) {
    return apiError(err);
  }
}
