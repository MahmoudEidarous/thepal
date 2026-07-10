import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { stripHints } from "@/lib/ledger";

type Doc = {
  id: string;
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

// Everything you've fed the brain, with its write-time envelope —
// type, provenance, salience, weight, dates, entities, hints.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    const docs = await supermemory.documents.list({
      containerTags: [tag],
      limit: 80,
      sort: "createdAt",
      order: "desc",
    });
    const all = (docs as { memories?: Doc[] }).memories ?? [];
    const captures = all
      .filter((d) => d.metadata?.type !== "briefing")
      .map((d) => ({
        id: d.id,
        createdAt: d.createdAt,
        status: d.status ?? null,
        text: stripHints(d.content ?? d.summary ?? d.title ?? ""),
        meta: (d.metadata ?? {}) as Record<string, unknown>,
      }))
      .filter((c) => c.text);
    return Response.json({ captures });
  } catch (err) {
    return apiError(err);
  }
}
