import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type ForgetPreview = {
  wouldForget?: Array<{ id: string; memory: string }>;
  matches?: Array<{ id: string; memory: string }>;
};

export default defineTool({
  description:
    "Dry-run preview of forgetting: shows which memories WOULD be deleted for a topic. Never deletes anything. Always call this first when the user asks to forget something.",
  inputSchema: z.object({
    about: z.string().min(2).describe("Topic or description of what to forget"),
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  async execute({ about, space }) {
    const res = await sm<ForgetPreview>("/v4/memories/forget-matching", {
      query: about,
      containerTag: spaceTag(space),
      dryRun: true,
    });
    const matches = res.wouldForget ?? res.matches ?? [];
    return {
      count: matches.length,
      memories: matches.map((m) => m.memory),
    };
  },
});
