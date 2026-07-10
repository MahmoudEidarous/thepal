import { smPost, smRequest, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

type SearchResponse = {
  results?: Array<{ id: string; memory?: string; chunk?: string; similarity?: number }>;
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
    });
    // The engine's threshold is loose; keep only confident matches so the
    // approval modal never offers to forget something unrelated.
    const matches = (found.results ?? []).filter(
      (r) => r.id && (r.memory ?? r.chunk) && (r.similarity ?? 0) >= 0.62,
    );

    if (body.dryRun !== false) {
      return Response.json({
        count: matches.length,
        memories: matches.map((m) => m.memory ?? m.chunk),
      });
    }

    let forgotten = 0;
    for (const m of matches) {
      await smRequest("DELETE", "/v4/memories", {
        id: m.id,
        containerTag: tag,
        reason: `user asked to forget: ${query}`,
      });
      forgotten++;
    }
    return Response.json({
      count: forgotten,
      memories: matches.map((m) => m.memory ?? m.chunk),
    });
  } catch (err) {
    return apiError(err);
  }
}
