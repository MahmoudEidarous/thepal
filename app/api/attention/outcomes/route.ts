import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { recordAttentionOutcome } from "@/lib/memory/learning-service";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = recordAttentionOutcome(body);
    return Response.json({
      outcome: result.outcome,
      learning: {
        projectorVersion: result.profile.projectorVersion,
        totalOutcomes: result.profile.totalOutcomes,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const outcomes = getMemoryEventLedger().listAttentionOutcomes({ space, limit: 200 });
    return Response.json({
      outcomes,
      privacy: "Outcome rows contain decision IDs and bounded signals—never transcripts or memory text.",
    });
  } catch (error) {
    return apiError(error);
  }
}
