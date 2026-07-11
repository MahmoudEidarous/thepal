import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type Doc = {
  id: string;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
};

// The open ledger, read straight off the write-time labels. The list
// endpoint truncates content, so open items are fetched whole.
export default defineTool({
  description:
    "Read the user's open commitment ledger: what they owe, with due dates, overdue flagged. Sorted nearest-due first.",
  inputSchema: z.object({
    space: z.enum(SPACES).default("personal").describe("The space to read"),
  }),
  async execute({ space }) {
    const res = await sm<{ memories?: Doc[] }>("/v3/documents/list", {
      containerTags: [spaceTag(space)],
      limit: 500,
      sort: "createdAt",
      order: "desc",
    });
    const today = new Date().toLocaleDateString("en-CA");
    const openDocs = (res.memories ?? []).filter(
      (d) => d.metadata?.type === "commitment" && d.metadata?.status === "open",
    );
    const open = await Promise.all(
      openDocs.map(async (d) => {
        const full = await sm<{ content?: string | null }>(
          `/v3/documents/${d.id}`,
          undefined,
          "GET",
        ).catch(() => null);
        const due =
          typeof d.metadata?.due === "string" ? (d.metadata.due as string) : null;
        return {
          content: (full?.content ?? d.content ?? "").split("\n\n(answers:")[0].trim(),
          due,
          overdue: !!due && due < today,
          dueToday: due === today,
        };
      }),
    );
    return {
      today,
      open: open
        .filter((c) => c.content)
        .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    };
  },
});
