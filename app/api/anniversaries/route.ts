import { returningPast } from "@/lib/fusion";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";

// The returning past. Deterministic on-this-day matches over story-dates
// — a year ago today, six months, one month. Rides into every voice
// session as a dynamic variable; the agent turns one into an opening.
// ?today=YYYY-MM-DD overrides the clock for tests and demos.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const override = url.searchParams.get("today") ?? "";
    const today = /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : localToday();
    const anniversaries = await returningPast(space, today);
    return Response.json({ today, anniversaries });
  } catch (err) {
    return apiError(err);
  }
}
