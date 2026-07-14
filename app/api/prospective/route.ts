import { invalidateCorpus } from "@/lib/fusion";
import {
  createProspectiveTrigger,
  matchProspectiveTrigger,
  prospectiveTriggers,
  updateProspectiveTrigger,
} from "@/lib/prospective";
import { spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";

// Context-triggered intentions: list, create, deterministically match,
// and move through their explicit lifecycle. Route handlers are dynamic
// by default in Next 16; every read must reflect lifecycle PATCHes now.

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const includeClosed = url.searchParams.get("closed") === "true";
    const triggers = await prospectiveTriggers(spaceTag(space), {
      includeClosed,
      includeSnoozed: true,
    });
    return Response.json({ triggers });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const space = asSpace(body.space);
    const tag = spaceTag(space);
    const operation = typeof body.operation === "string" ? body.operation : "";

    if (operation === "create") {
      const topic = typeof body.topic === "string" ? body.topic : "";
      const action = typeof body.action === "string" ? body.action : "";
      if (!topic.trim() || !action.trim()) {
        return Response.json({ error: "topic and action required" }, { status: 400 });
      }
      const result = await createProspectiveTrigger({
        tag,
        topic,
        action,
        source: typeof body.source === "string" ? body.source : "recall-app",
        idempotencyKey:
          request.headers.get("Idempotency-Key") ??
          (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined),
        deferProcessing: body.deferProcessing === true,
      });
      invalidateCorpus(space);
      return Response.json(result);
    }

    if (operation === "match") {
      const context = typeof body.context === "string" ? body.context.trim() : "";
      if (!context) return Response.json({ match: null });
      const seen = Array.isArray(body.seen)
        ? body.seen.filter((id: unknown): id is string => typeof id === "string").slice(0, 50)
        : [];
      const match = await matchProspectiveTrigger({ tag, context, seen });
      return Response.json({ match });
    }

    if (["fire", "resolve", "cancel", "snooze"].includes(operation)) {
      const result = await updateProspectiveTrigger({
        tag,
        id: typeof body.id === "string" ? body.id : undefined,
        about: typeof body.about === "string" ? body.about : undefined,
        operation: operation as "fire" | "resolve" | "cancel" | "snooze",
        until: typeof body.until === "string" ? body.until : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        idempotencyKey:
          request.headers.get("Idempotency-Key") ??
          (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined),
        deferProcessing: body.deferProcessing === true,
      });
      if (!result) {
        return Response.json({ error: "no open prospective memory matches that" }, { status: 404 });
      }
      invalidateCorpus(space);
      return Response.json(result);
    }

    return Response.json({ error: "unknown operation" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
