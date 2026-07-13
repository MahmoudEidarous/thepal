import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    if (!eventId) return Response.json({ error: "eventId required" }, { status: 400 });
    const preview = getMemoryEventLedger().createDeletionPreview(eventId);
    return Response.json(preview);
  } catch (error) {
    return apiError(error);
  }
}
