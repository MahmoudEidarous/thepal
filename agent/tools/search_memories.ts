import { defineTool } from "eve/tools";
import { z } from "zod";
import { SPACES } from "../lib/sm";
import { fusedRecall } from "../../lib/fusion";

// The same fused read path the voice uses — probes, temporal routing,
// near-dup collapse, told-timestamps. The night editor must not read
// through frosted glass: extraction drops specifics, and a search
// without dates can't tell which of two conflicting truths is current.
export default defineTool({
  description:
    "Search the user's memories semantically. Each result carries when the user told it — when two memories conflict or one reverses another, the LATEST telling is the current truth.",
  inputSchema: z.object({
    query: z.string().min(2).describe("What to look for, phrased as a question or topic"),
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  async execute({ query, space }) {
    const hits = await fusedRecall({ q: query, space, limit: 6 });
    return hits.map((h) => ({
      memory: h.memory,
      told: h.createdAt ? h.createdAt.slice(0, 16).replace("T", " ") : null,
    }));
  },
});
