import { fusedRecall } from "@/lib/fusion";
import { retrieveApplicableBeliefs } from "@/lib/memory/belief-retrieval";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

// Proactive recall: the voice agent's search_memories and the typing
// debounce both land here. One vague question fans out into parallel
// probes + metadata-routed lists, fused by rank — see lib/fusion.ts.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (q.length < 3) {
      return Response.json({ results: [] });
    }
    const limit = Math.min(8, Math.max(1, Number(body.limit) || 4));
    const space = asSpace(body.space);
    const [results, beliefs] = await Promise.all([
      fusedRecall({ q, space, limit }),
      Promise.resolve(retrieveApplicableBeliefs(q, space, { limit: 4 })),
    ]);
    return Response.json({ beliefs, results });
  } catch (err) {
    return apiError(err);
  }
}
