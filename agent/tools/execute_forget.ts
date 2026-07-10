import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type SearchResponse = {
  results?: Array<{ id: string; memory?: string; chunk?: string; similarity?: number }>;
};

export default defineTool({
  description:
    "Permanently forget memories matching a topic. Destructive — requires human approval. Only call after preview_forget and explicit user confirmation.",
  inputSchema: z.object({
    about: z.string().min(2).describe("Topic to forget, same phrasing as the preview"),
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  approval: always(),
  async execute({ about, space }) {
    const tag = spaceTag(space);
    const found = await sm<SearchResponse>("/v4/search", {
      q: about,
      containerTag: tag,
      limit: 8,
      threshold: 0.5,
    });
    const matches = (found.results ?? []).filter(
      (r) => r.id && (r.memory ?? r.chunk) && (r.similarity ?? 0) >= 0.62,
    );
    for (const m of matches) {
      await sm(
        "/v4/memories",
        { id: m.id, containerTag: tag, reason: `user asked to forget: ${about}` },
        "DELETE",
      );
    }
    return { forgotten: matches.length };
  },
});
