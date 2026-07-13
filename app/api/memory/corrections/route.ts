import { ZodError } from "zod";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { processCaptureJob } from "@/lib/memory/reconciler";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { correctEvidence } from "@/lib/memory/write-broker";
import { apiError } from "@/lib/validate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetEventId = typeof body.targetEventId === "string" ? body.targetEventId : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!targetEventId || !content) {
      return Response.json({ error: "targetEventId and content required" }, { status: 400 });
    }
    const ledger = getMemoryEventLedger();
    const target = ledger.getEvent(targetEventId);
    if (!target || target.tombstonedAt) {
      return Response.json({ error: "correction target not found" }, { status: 404 });
    }
    if (body.dryRun === true) {
      return Response.json({
        target: {
          eventId: target.id,
          excerpt: target.payload.content.slice(0, 200),
          recordedAt: target.recordedAt,
        },
        affectedClaims: ledger.listClaimsForEvent(target.id).length,
      });
    }

    const corrected = correctEvidence({
      targetEventId,
      content,
      source: typeof body.source === "string" ? body.source : "recall-app#correction",
      userId: "local-user",
      idempotencyKey:
        request.headers.get("Idempotency-Key") ??
        (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined),
    });
    scheduleMemoryReconciliation(100);
    const mirrored = await processCaptureJob(corrected.receipt.jobId);
    const response = {
      status: mirrored.state,
      targetEventId,
      correctionEventId: corrected.event.id,
      receipt: corrected.receipt,
      ...(mirrored.state === "succeeded" ? { capture: mirrored.response } : {}),
    };
    if (mirrored.state === "dead") return Response.json(response, { status: 500 });
    if (mirrored.state === "pending" || mirrored.state === "busy") {
      return Response.json(response, { status: 202 });
    }
    return Response.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? "invalid correction" }, { status: 400 });
    }
    return apiError(error);
  }
}
