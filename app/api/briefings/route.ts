import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const docs = await supermemory.documents.list({
      containerTags: [spaceTag(asSpace(url.searchParams.get("space")))],
      limit: 60,
      sort: "createdAt",
      order: "desc",
    });
    const all =
      (docs as { memories?: Array<{ id: string; content?: string | null; summary?: string | null; metadata?: Record<string, unknown> | null; createdAt?: string }> }).memories ?? [];
    const briefings = await Promise.all(
      all
        .filter((d) => d.metadata?.type === "briefing")
        .slice(0, 3)
        .map(async (d) => {
          const full = (await supermemory.documents.get(d.id)) as {
            content?: string | null;
            summary?: string | null;
          };
          return {
            id: d.id,
            content: full.content ?? full.summary ?? "",
            createdAt: d.createdAt,
          };
        }),
    );
    return Response.json({ briefings: briefings.filter((b) => b.content) });
  } catch (err) {
    return apiError(err);
  }
}
