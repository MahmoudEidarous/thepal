import { buildRoutineView } from "@/lib/memory/continuity-projectors";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    return Response.json({
      routines: buildRoutineView(getMemoryEventLedger(), "local-user", space),
    });
  } catch (error) {
    return apiError(error);
  }
}
