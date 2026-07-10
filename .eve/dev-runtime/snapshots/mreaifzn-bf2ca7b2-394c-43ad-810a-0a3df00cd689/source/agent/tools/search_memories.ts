import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type SearchResponse = {
  results?: Array<{
    id: string;
    memory?: string;
    chunk?: string;
    similarity: number;
    updatedAt?: string;
    version?: number;
  }>;
};

export default defineTool({
  description:
    "Search the user's memories semantically. Use before answering anything about the user's life, plans, preferences, or past.",
  inputSchema: z.object({
    query: z.string().min(2).describe("What to look for, phrased as a question or topic"),
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  async execute({ query, space }) {
    const res = await sm<SearchResponse>("/v4/search", {
      q: query,
      containerTag: spaceTag(space),
      limit: 6,
    });
    return (res.results ?? []).map((r) => ({
      memory: r.memory ?? r.chunk ?? "",
      similarity: Math.round((r.similarity ?? 0) * 100) / 100,
      updatedAt: r.updatedAt,
      version: r.version,
    }));
  },
});
