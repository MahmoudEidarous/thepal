import { spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";
import { openCommitments } from "@/lib/ledger";

// Open commitments, dated, overdue flagged — the agenda the agent
// opens the conversation with.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    const today = localToday();
    const commitments = (await openCommitments(tag))
      .map((c) => ({
        id: c.id,
        content: c.content,
        due: c.due,
        overdue: !!c.due && c.due < today,
        dueToday: c.due === today,
      }))
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    return Response.json({ today, commitments });
  } catch (err) {
    return apiError(err);
  }
}
