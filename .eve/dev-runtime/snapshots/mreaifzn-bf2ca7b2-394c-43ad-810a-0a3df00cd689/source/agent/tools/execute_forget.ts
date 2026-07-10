import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type ForgetResult = { forgotten?: unknown[]; count?: number };

export default defineTool({
  description:
    "Permanently forget memories matching a topic. Destructive — requires human approval. Only call after preview_forget and explicit user confirmation.",
  inputSchema: z.object({
    about: z.string().min(2).describe("Topic to forget, same phrasing as the preview"),
    space: z.enum(SPACES).describe("The active space from client context"),
  }),
  approval: always(),
  async execute({ about, space }) {
    const res = await sm<ForgetResult>("/v4/memories/forget-matching", {
      query: about,
      containerTag: spaceTag(space),
      dryRun: false,
      maxForget: 20,
    });
    return { forgotten: res.count ?? (res.forgotten?.length ?? 0) };
  },
});
