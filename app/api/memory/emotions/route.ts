import { buildEmotionalArc } from "@/lib/memory/continuity-projectors";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const about = url.searchParams.get("about")?.trim().slice(0, 120);
    return Response.json({
      emotionalArc: buildEmotionalArc(getMemoryEventLedger(), "local-user", space, about),
    });
  } catch (error) {
    return apiError(error);
  }
}
