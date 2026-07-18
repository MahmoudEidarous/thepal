import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError } from "@/lib/validate";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ledger = getMemoryEventLedger();
    const stats = ledger.stats();
    return Response.json({
      status: "healthy",
      stats,
    });
  } catch (error) {
    return apiError(error);
  }
}
