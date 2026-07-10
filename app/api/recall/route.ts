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
    const found = await supermemory.search.memories({
      q,
      containerTag: spaceTag(asSpace(body.space)),
      limit: 4,
      threshold: 0.55,
    });
    return Response.json(found);
  } catch (err) {
    return apiError(err);
  }
}
