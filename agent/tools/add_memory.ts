import { defineTool } from "eve/tools";
import { z } from "zod";
import { sm, spaceTag, SPACES } from "../lib/sm";

type AddResponse = { id: string; status: string };

export default defineTool({
  description:
    "Save something to the user's memory: a fact, a decision made in conversation, a commitment (with due date), or a briefing (when dreaming). Write content as a clear standalone statement.",
  inputSchema: z.object({
    content: z.string().min(4).describe("The content to remember, self-contained"),
    space: z.enum(SPACES).describe("The active space from client context"),
    kind: z
      .enum(["memory", "decision", "commitment", "briefing"])
      .default("memory")
      .describe("What this is — commitments get tracked, briefings appear in the Dream panel"),
    due: z
      .string()
      .optional()
      .describe("For commitments: due date as YYYY-MM-DD if the user implied one"),
  }),
  async execute({ content, space, kind, due }) {
    const res = await sm<AddResponse>("/v3/documents", {
      content,
      containerTag: spaceTag(space),
      metadata: {
        source: "recall-agent",
        type: kind,
        ...(due ? { due } : {}),
        ...(kind === "commitment" ? { status: "open" } : {}),
      },
    });
    return { saved: true, id: res.id, kind };
  },
});
