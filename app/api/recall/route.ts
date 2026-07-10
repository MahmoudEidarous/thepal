import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

// Proactive recall: debounced client calls land here while the user types.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (q.length < 3) {
      return Response.json({ results: [] });
    }
    const limit = Math.min(8, Math.max(1, Number(body.limit) || 4));
    const found = await supermemory.search.memories({
      q,
      containerTag: spaceTag(asSpace(body.space)),
      limit,
      threshold: 0.55,
    });
    return Response.json(found);
  } catch (err) {
    return apiError(err);
  }
}
