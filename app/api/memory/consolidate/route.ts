import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { runMemoryConsolidation } from "@/lib/memory/learning-service";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = runMemoryConsolidation({
      space: asSpace(body.space),
      trigger:
        body.trigger === "manual" || body.trigger === "scheduled" || body.trigger === "outcome"
          ? body.trigger
          : "session",
      force: body.force === true,
    });
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const ledger = getMemoryEventLedger();
    return Response.json({
      profile: ledger.getAttentionProfile("local-user", space),
      associations: ledger.listAssociations({ space, includeStale: true, limit: 500 }),
      runs: ledger.listConsolidationRuns({ space, limit: 20 }),
    });
  } catch (error) {
    return apiError(error);
  }
}
