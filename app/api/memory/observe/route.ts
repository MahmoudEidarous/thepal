import { observeUserTurn, sanitizeObservationTurns } from "@/lib/memory/turn-observer";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { captureEvidence } from "@/lib/memory/write-broker";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

function safeIdPart(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return cleaned || fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text : "";
    const recentTurns = sanitizeObservationTurns(body.recentTurns);
    const observation = await observeUserTurn({ text, recentTurns });
    if (!observation.capture || !observation.content) {
      return Response.json({ captured: false, reason: observation.reason });
    }

    const sessionId = safeIdPart(body.sessionId, "session");
    const turn = Number.isInteger(body.turn) && body.turn >= 0 ? body.turn : 0;
    const idempotencyKey = `voice-turn:${sessionId}:${turn}`;
    let captured = captureEvidence({
      content: observation.content,
      space: asSpace(body.space),
      source: "recall-voice-observer",
      kind: observation.kind,
      userId: "local-user",
      idempotencyKey,
    });
    let supplemented = false;
    // If the speaking model won the race with a shorter interpretation, do
    // not overwrite it and do not discard the transcript. Append the exact
    // evidence bundle as an extension. Identical observer retries remain
    // idempotent and create nothing new.
    if (captured.receipt.duplicate && captured.safeContent !== observation.content) {
      captured = captureEvidence({
        content: observation.content,
        space: asSpace(body.space),
        source: "recall-voice-observer",
        kind: observation.kind,
        userId: "local-user",
        idempotencyKey: `${idempotencyKey}:observer`,
      });
      supplemented = true;
    }

    // The voice reply never waits for enrichment, Supermemory mirroring, or
    // projections. SQLite evidence is durable before this response; the
    // existing reconciler finishes the richer memory in the background.
    scheduleMemoryReconciliation(0);
    return Response.json(
      {
        captured: true,
        eventId: captured.receipt.eventId,
        text: captured.safeContent,
        kind: observation.kind,
        reason: observation.reason,
        fallback: observation.fallback,
        supplemented,
      },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
