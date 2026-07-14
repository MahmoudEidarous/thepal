import { spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { localToday } from "@/lib/envelope";
import { openCommitments, setLedgerStatus } from "@/lib/ledger";
import { processCaptureJob } from "@/lib/memory/reconciler";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { captureEvidence } from "@/lib/memory/write-broker";

export const runtime = "nodejs";

// Done things stay done: closing a commitment PATCHes its metadata to
// status=done (the ledger forgets nothing) and writes a dated
// completion event so "when did I finish X?" has an answer.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const q = typeof body.q === "string" ? body.q.trim().toLowerCase() : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (!q && !id) {
      return Response.json({ error: "q or id required" }, { status: 400 });
    }
    const space = asSpace(body.space);
    const tag = spaceTag(space);
    const open = await openCommitments(tag);
    if (!open.length) {
      return Response.json({ error: "no open commitments" }, { status: 404 });
    }

    let match = id ? open.find((c) => c.id === id) : undefined;
    if (!match && q) {
      // best token-overlap match — commitments are short, this is enough
      const qTokens = new Set(q.split(/\W+/).filter((t: string) => t.length > 2));
      const scored = open
        .map((c) => {
          const tokens = c.content.toLowerCase().split(/\W+/);
          const hits = tokens.filter((t) => qTokens.has(t)).length;
          return { c, score: hits };
        })
        .sort((a, b) => b.score - a.score);
      if (scored[0].score > 0) match = scored[0].c;
    }
    if (!match) {
      return Response.json(
        { error: "no open commitment matches that", open: open.map((c) => c.content) },
        { status: 404 },
      );
    }
    const today = localToday();
    // done and cancelled both close the item; only the history differs —
    // finished things earn a Done event, scrapped plans a Cancelled one.
    // Neither is ever a deletion.
    const outcome = body.outcome === "cancelled" ? "cancelled" : "done";
    // setLedgerStatus handles the engine's sharp edges: settle races and
    // failed-immutable docs (which it rebirths rather than losing)
    await setLedgerStatus(tag, match.id, { status: outcome, completedAt: today });
    const completionContent =
      outcome === "done"
        ? `Done: ${match.content} (completed ${today})`
        : `Cancelled: ${match.content} (called off ${today})`;
    // Completion is user-confirmed evidence, not provider-only metadata.
    // Filing it through the canonical broker lets beliefs, threads, deletion,
    // replay, and the semantic mirror all observe the same lifecycle event.
    const completion = captureEvidence({
      content: completionContent,
      space,
      source: "recall-ledger#user-confirmed",
      kind: "memory",
      userId: "local-user",
      idempotencyKey: `ledger-completion:${match.id}:${outcome}:${today}`,
    });
    scheduleMemoryReconciliation(100);
    const mirrored = await processCaptureJob(completion.receipt.jobId);
    if (mirrored.state === "pending" || mirrored.state === "dead") {
      scheduleMemoryReconciliation();
    }
    return Response.json({
      completed: match.content,
      due: match.due,
      on: today,
      outcome,
      receipt: completion.receipt,
      memoryStatus: mirrored.state,
    });
  } catch (err) {
    return apiError(err);
  }
}
