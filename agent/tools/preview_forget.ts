import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type SearchResponse = {
  results?: Array<{ id: string; memory?: string; chunk?: string; similarity?: number }>;
};

export default defineTool({
  description:
    "Dry-run preview of forgetting: shows which memories WOULD be deleted for a topic. Never deletes anything. Always call this first when the user asks to forget something.",
  inputSchema: z.object({
    about: z.string().min(2).describe("Topic or description of what to forget"),
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  async execute({ about, space }) {
    const found = await sm<SearchResponse>("/v4/search", {
      q: about,
      containerTag: spaceTag(space),
      limit: 8,
      threshold: 0.5,
    });
    const matches = (found.results ?? []).filter(
      (r) => r.id && (r.memory ?? r.chunk) && (r.similarity ?? 0) >= 0.62,
    );
    return {
      count: matches.length,
      memories: matches.map((m) => m.memory ?? m.chunk),
    };
  },
});
