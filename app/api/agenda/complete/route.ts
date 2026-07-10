import { supermemory, smRequest, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";
import { openCommitments } from "@/lib/ledger";

// Done things stay done: closing a commitment PATCHes its metadata to
// status=done (the ledger forgets nothing) and writes a dated
// completion event so "when did I finish X?" has an answer.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const q = typeof body.q === "string" ? body.q.trim().toLowerCase() : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (!q && !id) {
      return Response.json({ error: "q or id required" }, { status: 400 });
    }
    const tag = spaceTag(asSpace(body.space));
    const open = await openCommitments(tag);
    if (!open.length) {
      return Response.json({ error: "no open commitments" }, { status: 404 });
    }

    let match = id ? open.find((c) => c.id === id) : undefined;
    if (!match && q) {
      // best token-overlap match — commitments are short, this is enough
      const qTokens = new Set(q.split(/\W+/).filter((t: string) => t.length > 2));
      const scored = open
        .map((c) => {
          const tokens = c.content.toLowerCase().split(/\W+/);
          const hits = tokens.filter((t) => qTokens.has(t)).length;
          return { c, score: hits };
        })
        .sort((a, b) => b.score - a.score);
      if (scored[0].score > 0) match = scored[0].c;
    }
    if (!match) {
      return Response.json(
        { error: "no open commitment matches that", open: open.map((c) => c.content) },
        { status: 404 },
      );
    }
    const today = localToday();
    await smRequest("PATCH", `/v3/documents/${match.id}`, {
      metadata: { ...match.metadata, status: "done", completedAt: today },
    });
    await supermemory.add({
      content: `Done: ${match.content} (completed ${today})`,
      containerTag: tag,
      metadata: {
        source: "recall-ledger",
        type: "event",
        provenance: "stated",
        storyDate: today,
        salience: 0.55,
      },
    });
    return Response.json({ completed: match.content, due: match.due, on: today });
  } catch (err) {
    return apiError(err);
  }
}
