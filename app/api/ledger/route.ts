import { spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";
import { allCommitments } from "@/lib/ledger";

// Both sides of the ledger for the UI: open promises (dated, overdue
// flagged) and the done archive.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    const today = localToday();
    const all = await allCommitments(tag);
    const open = all
      .filter((c) => c.status === "open")
      .map((c) => ({ ...c, overdue: !!c.due && c.due < today, dueToday: c.due === today }))
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    const done = all
      .filter((c) => c.status === "done")
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return Response.json({ today, open, done });
  } catch (err) {
    return apiError(err);
  }
}
