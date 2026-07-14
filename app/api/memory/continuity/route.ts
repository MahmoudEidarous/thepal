import {
  CONTINUITY_VIEWS,
  buildContinuityExperience,
  type ContinuityViewKind,
} from "@/lib/memory/continuity-view";
import { localToday } from "@/lib/envelope";
import { returningPast } from "@/lib/fusion";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

const VIEWS = new Set<string>(CONTINUITY_VIEWS);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedView = url.searchParams.get("view") ?? "overview";
    if (!VIEWS.has(requestedView)) {
      return Response.json({ error: "invalid continuity view" }, { status: 400 });
    }
    const view = requestedView as ContinuityViewKind;
    const about = url.searchParams.get("about")?.trim().slice(0, 120) ?? "";
    if (view === "dossier" && !about) {
      return Response.json({ error: "about is required for a dossier" }, { status: 400 });
    }
    const requestedAt = url.searchParams.get("at");
    const at = requestedAt && Number.isFinite(Date.parse(requestedAt))
      ? new Date(requestedAt).toISOString()
      : `${localToday()}T23:59:59.999Z`;
    const space = asSpace(url.searchParams.get("space"));
    const anniversarySupplements = view === "overview" || view === "anniversaries"
      ? await returningPast(space, at.slice(0, 10)).catch(() => [])
      : [];
    return Response.json(
      buildContinuityExperience({
        ledger: getMemoryEventLedger(),
        space,
        view,
        about,
        at,
        anniversarySupplements,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
