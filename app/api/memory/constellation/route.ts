import { buildConstellation } from "@/lib/memory/continuity-projectors";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const period = url.searchParams.get("period") === "month" ? "month" : "week";
    const requestedAt = url.searchParams.get("at");
    const at = requestedAt && Number.isFinite(Date.parse(requestedAt))
      ? new Date(requestedAt).toISOString()
      : new Date().toISOString();
    return Response.json({
      constellation: buildConstellation(getMemoryEventLedger(), "local-user", space, period, at),
    });
  } catch (error) {
    return apiError(error);
  }
}
