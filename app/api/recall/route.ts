import { fusedRecall } from "@/lib/fusion";
import { apiError, asSpace } from "@/lib/validate";

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
    const results = await fusedRecall({ q, space: asSpace(body.space), limit });
    return Response.json({ results });
  } catch (err) {
    return apiError(err);
  }
}
