import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type Doc = {
  id: string;
  content?: string | null;
  createdAt?: string;
  metadata?: Record<string, unknown> | null;
};

// The day's actual material, not a semantic guess at it. The night
// editor reconciles what the day wrote — so hand it exactly that,
// newest first, plus the previous briefing so each night ADVANCES the
// story instead of repeating it.
export default defineTool({
  description:
    "Everything captured in the last N hours (default 36), newest first, with type and told-time — plus the previous briefing. The night editor's primary source: reconcile THIS, use search_memories only for follow-up questions it raises.",
  inputSchema: z.object({
    space: z.enum(SPACES).default("personal").describe("The space to read"),
    hours: z.number().min(1).max(168).default(36).describe("Look-back window in hours"),
  }),
  async execute({ space, hours }) {
    const res = await sm<{ memories?: Doc[] }>("/v3/documents/list", {
      containerTags: [spaceTag(space)],
      limit: 500,
      sort: "createdAt",
      order: "desc",
    });
    const since = Date.now() - hours * 3_600_000;
    const all = res.memories ?? [];

    const hydrate = async (d: Doc) => {
      const full = await sm<{ content?: string | null }>(
        `/v3/documents/${d.id}`,
        undefined,
        "GET",
      ).catch(() => null);
      return (full?.content ?? d.content ?? "").split("\n\n(answers:")[0].trim();
    };

    const recentDocs = all
      .filter((d) => d.metadata?.type !== "briefing")
      .filter((d) => d.createdAt && new Date(d.createdAt).getTime() >= since)
      .slice(0, 30);
    const recent = await Promise.all(
      recentDocs.map(async (d) => ({
        text: await hydrate(d),
        type: (d.metadata?.type as string) ?? "memory",
        told: d.createdAt?.slice(0, 16).replace("T", " "),
        ...(typeof d.metadata?.due === "string" ? { due: d.metadata.due } : {}),
      })),
    );

    const prevDoc = all.find((d) => d.metadata?.type === "briefing");
    const previousBriefing = prevDoc
      ? { written: prevDoc.createdAt?.slice(0, 16).replace("T", " "), content: await hydrate(prevDoc) }
      : null;

    return { count: recent.length, recent: recent.filter((r) => r.text), previousBriefing };
  },
});
