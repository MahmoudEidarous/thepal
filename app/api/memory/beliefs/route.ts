import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";
import type { Belief } from "@/lib/memory/contracts";

export const runtime = "nodejs";

const STATUSES = new Set<Belief["status"]>([
  "current",
  "historical",
  "conflicting",
  "unknown",
]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const requestedStatus = url.searchParams.get("status") as Belief["status"] | null;
    if (requestedStatus && !STATUSES.has(requestedStatus)) {
      return Response.json({ error: "invalid belief status" }, { status: 400 });
    }
    const ledger = getMemoryEventLedger();
    const beliefs = ledger.listBeliefs({
      userId: "local-user",
      space,
      status: requestedStatus ?? undefined,
      subjectId: url.searchParams.get("subjectId") ?? undefined,
      predicate: url.searchParams.get("predicate") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    return Response.json({
      space,
      count: beliefs.length,
      beliefs,
      relations: url.searchParams.get("relations") === "true"
        ? ledger.listClaimRelations("local-user", space)
        : undefined,
    });
  } catch (error) {
    return apiError(error);
  }
}
