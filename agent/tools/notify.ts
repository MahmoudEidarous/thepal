import { defineTool } from "eve/tools";
import { z } from "zod";
import { execFile } from "node:child_process";

// A native desktop notification — the agent's only way to reach the
// user when the app is closed. Interrupting a human is expensive:
// schedules that use this are budgeted to one per run.
export default defineTool({
  description:
    "Send ONE native desktop notification to the user. It interrupts a human — use at most once per run, only for something that genuinely deserves attention now.",
  inputSchema: z.object({
    message: z
      .string()
      .min(4)
      .max(140)
      .describe("One short, warm, specific sentence — a friend's tap on the shoulder"),
  }),
  async execute({ message }) {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "osascript",
        [
          "-e",
          `display notification ${JSON.stringify(message)} with title "the Pal" sound name "Glass"`,
        ],
        (err) => (err ? reject(err) : resolve()),
      );
    });
    return { notified: true };
  },
});
