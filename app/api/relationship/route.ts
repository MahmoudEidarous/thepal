import { RelationshipEventInputSchema } from "@/lib/memory/contracts";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import {
  deleteRelationshipEventAndRebuild,
  loadRelationshipState,
  recordRelationshipEvent,
} from "@/lib/memory/relationship-service";
import { apiError, asSpace } from "@/lib/validate";
import { ZodError } from "zod";

export const runtime = "nodejs";

function invalid(error: ZodError) {
  return Response.json(
    {
      error: "invalid relationship event",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    },
    { status: 400 },
  );
}
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const ledger = getMemoryEventLedger();
    const state = loadRelationshipState({ ledger, space });
    const includeEvents = url.searchParams.get("events") === "true";
    return Response.json({
      state,
      ...(includeEvents
        ? { events: ledger.listRelationshipEvents({ space, limit: 2_000 }) }
        : {}),
      authority:
        "Relationship memory records Recall↔user interactions only. It never becomes a user fact or overrides an explicit boundary.",
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = RelationshipEventInputSchema.parse({
      ...body,
      userId: "local-user",
      space: asSpace(body.space),
    });
    const result = recordRelationshipEvent(input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return invalid(error);
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.id !== "string") {
      return Response.json({ error: "relationship event id required" }, { status: 400 });
    }
    const result = deleteRelationshipEventAndRebuild({
      id: body.id,
      space: asSpace(body.space),
    });
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
