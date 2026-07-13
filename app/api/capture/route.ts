import { ZodError } from "zod";
import { analyzeCapture, processLegacyCapture } from "@/lib/memory/capture-processor";
import { memoryFoundationMode } from "@/lib/memory/flags";
import { redactSecrets } from "@/lib/memory/redaction";
import { processCaptureJob } from "@/lib/memory/reconciler";
import { scheduleMemoryReconciliation } from "@/lib/memory/reconcile-scheduler";
import { captureEvidence } from "@/lib/memory/write-broker";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["memory", "decision", "commitment", "briefing"]);

function requestedKind(value: unknown): "memory" | "decision" | "commitment" | "briefing" {
  return typeof value === "string" && ALLOWED_KINDS.has(value)
    ? (value as "memory" | "decision" | "commitment" | "briefing")
    : "memory";
}
function provisionalEnvelope(input: {
  content: string;
  kind: "memory" | "decision" | "commitment" | "briefing";
  due?: string;
  redacted: boolean;
}) {
  return {
    text: input.content,
    type: input.kind,
    provenance: "stated",
    storyDate: null,
    due: input.kind === "commitment" ? (input.due ?? null) : null,
    valence: 0,
    intensity: 0,
    salience: input.kind === "commitment" ? 0.8 : 0.5,
    entities: [],
    hints: [],
    redacted: input.redacted,
    commitments: [],
    prospective: null,
    supersedes: null,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw = typeof body.content === "string" ? body.content.trim() : "";
    if (!raw) return Response.json({ error: "content required" }, { status: 400 });

    const space = asSpace(body.space);
    const source = typeof body.source === "string" ? body.source.trim().slice(0, 200) : "recall-app";
    const kind = requestedKind(body.kind);
    const due = typeof body.due === "string" ? body.due.trim().slice(0, 64) : undefined;
    const { text: safeContent, redacted: preRedacted } = redactSecrets(raw);

    // The existing eval contract stays side-effect free: analyze the exact
    // production path, but create neither a canonical event nor a mirror.
    if (body.dryRun === true) {
      const analysis = await analyzeCapture({
        content: safeContent,
        preRedacted,
        source,
        space,
        kind,
        due,
      });
      return Response.json({
        envelope: analysis.envelope,
        preRedacted,
        ...(analysis.conflict ? { conflict: analysis.conflict } : {}),
      });
    }

    const runLegacyCapture = async () => {
      const result = await processLegacyCapture({
        content: safeContent,
        preRedacted,
        source,
        space,
        kind,
        due,
      });
      return Response.json(result.response);
    };

    const foundationMode = memoryFoundationMode();
    if (foundationMode === "off") return runLegacyCapture();

    scheduleMemoryReconciliation(250);
    let captured: ReturnType<typeof captureEvidence>;
    try {
      captured = captureEvidence({
        content: raw,
        space,
        source,
        kind,
        due,
        userId: "local-user",
        idempotencyKey:
          request.headers.get("Idempotency-Key") ??
          (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined),
      });
    } catch (error) {
      // Shadow is the rollout escape hatch: preserve the old capture path if
      // the local ledger itself cannot open or commit. Required remains fail-closed.
      if (foundationMode === "shadow") return runLegacyCapture();
      throw error;
    }
    const processed = await processCaptureJob(captured.receipt.jobId);
    if (processed.state === "succeeded") {
      return Response.json({ ...processed.response, receipt: captured.receipt });
    }
    if (processed.state === "already_succeeded") {
      return Response.json({
        id: processed.externalId ?? captured.receipt.eventId,
        status: "done",
        receipt: captured.receipt,
        envelope: provisionalEnvelope({ content: captured.safeContent, kind, due, redacted: preRedacted }),
      });
    }

    scheduleMemoryReconciliation();
    return Response.json(
      {
        id: captured.receipt.eventId,
        status: processed.state,
        pending: processed.state !== "dead",
        canonicalOnly: true,
        receipt: captured.receipt,
        envelope: provisionalEnvelope({ content: captured.safeContent, kind, due, redacted: preRedacted }),
        message:
          processed.state === "dead"
            ? "Saved locally, but semantic indexing needs manual repair."
            : "Saved locally; semantic indexing will retry in the background.",
      },
      { status: processed.state === "dead" ? 500 : 202 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: error.issues[0]?.message ?? "invalid capture" }, { status: 400 });
    }
    return apiError(error);
  }
}
