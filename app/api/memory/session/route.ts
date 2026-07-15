import {
  createSessionHandoff,
  materializeContinuityKernel,
  type SessionLine,
} from "@/lib/memory/continuity-kernel";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import type { SessionPresenceSummary } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

function lines(value: unknown): SessionLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (line): line is SessionLine =>
        !!line &&
        typeof line === "object" &&
        ((line as { role?: unknown }).role === "user" ||
          (line as { role?: unknown }).role === "agent") &&
        typeof (line as { text?: unknown }).text === "string",
    )
    .slice(-40)
    .map((line) => ({ role: line.role, text: line.text.slice(0, 2_000) }));
}

function presence(value: unknown): SessionPresenceSummary | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.act !== "string" || typeof input.plannedOpening !== "string") return null;
  return {
    act: input.act.slice(0, 80),
    plannedOpening: input.plannedOpening.slice(0, 400),
    spokenOpening: typeof input.spokenOpening === "string" ? input.spokenOpening.slice(0, 400) : null,
    candidateKind: typeof input.candidateKind === "string" ? input.candidateKind.slice(0, 80) : null,
    decisionId: typeof input.decisionId === "string" ? input.decisionId.slice(0, 160) : null,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const startedAt = typeof body.startedAt === "string" ? body.startedAt : "";
    if (!sessionId || sessionId.length > 160) throw new Error("session handoff: sessionId is required");
    if (!Number.isFinite(Date.parse(startedAt))) {
      throw new Error("session handoff: startedAt must be a valid instant");
    }
    const space = asSpace(body.space);
    const handoff = createSessionHandoff({
      space,
      sessionId,
      startedAt,
      endedAt:
        typeof body.endedAt === "string" && Number.isFinite(Date.parse(body.endedAt))
          ? body.endedAt
          : undefined,
      lines: lines(body.lines),
      presence: presence(body.presence),
    });
    const materialized = materializeContinuityKernel({ space, force: true });
    return Response.json({ handoff, kernel: materialized.kernel, rebuilt: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const ledger = getMemoryEventLedger();
    const requestedLimit = Number(url.searchParams.get("limit") ?? 20);
    return Response.json({
      handoffs: ledger.listSessionHandoffs({
        space,
        meaningfulOnly: url.searchParams.get("meaningful") === "true",
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 20,
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
