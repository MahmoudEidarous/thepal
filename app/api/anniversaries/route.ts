import { buildAnniversaryView } from "@/lib/memory/continuity-projectors";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { buildContinuityExperience } from "@/lib/memory/continuity-view";
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
    const canonical = buildAnniversaryView(getMemoryEventLedger(), "local-user", space, today);
    const supplements = await returningPast(space, today).catch(() => []);
    const experience = buildContinuityExperience({
      ledger: getMemoryEventLedger(),
      space,
      view: "anniversaries",
      at: `${today}T23:59:59.999Z`,
      anniversarySupplements: supplements,
    });
    const view = experience.anniversaries ?? canonical;
    return Response.json({
      today,
      anniversaries: view.memories,
      agentText: view.agentText,
      projectorVersion: view.projectorVersion,
    });
  } catch (err) {
    return apiError(err);
  }
}
