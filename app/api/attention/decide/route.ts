import {
  formatAttentionDecision,
  type AttentionMomentKind,
} from "@/lib/memory/attention-engine";
import { compileMemoryContextWithAttention } from "@/lib/memory/attention-service";
import type { WorkingTurn } from "@/lib/memory/context-compiler";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

function recentTurns(value: unknown): WorkingTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is { role: "user" | "agent"; text: string } =>
        !!turn &&
        typeof turn === "object" &&
        ((turn as { role?: unknown }).role === "user" ||
          (turn as { role?: unknown }).role === "agent") &&
        typeof (turn as { text?: unknown }).text === "string",
    )
    .slice(-8)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 2_000) }));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === "string"
      ? body.query
      : typeof body.q === "string"
        ? body.q
        : "";
    const momentKind: AttentionMomentKind =
      body.momentKind === "session_start" || body.momentKind === "lull"
        ? body.momentKind
        : "user_turn";
    const result = await compileMemoryContextWithAttention({
      query,
      space: asSpace(body.space),
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      momentKind,
      recentTurns: recentTurns(body.recentTurns),
      selectedMemory: typeof body.selectedMemory === "string" ? body.selectedMemory : null,
      seenProspective: Array.isArray(body.seenProspective)
        ? body.seenProspective.filter((id: unknown): id is string => typeof id === "string").slice(0, 50)
        : [],
      explicitSilence: body.explicitSilence === true,
      focusMode: body.focusMode === true,
      includeHistory: body.includeHistory === true,
      includeProspective: body.includeProspective !== false,
      includeObligations: body.includeObligations !== false,
      includeAnniversaries: body.includeAnniversaries !== false,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : 1_400,
    });
    return Response.json({
      compiledAt: result.compiledAt,
      compilerVersion: result.compilerVersion,
      attention: result.attention,
      attentionText: formatAttentionDecision(result.attention),
      agentText: result.agentText,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const space = asSpace(url.searchParams.get("space"));
    const requested = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(200, Math.floor(requested))) : 50;
    const decisions = getMemoryEventLedger().listAttentionDecisions({ space, limit });
    return Response.json({
      decisions,
      privacy: "Policy traces contain candidate IDs, factors, gates, and evidence links—never memory text.",
    });
  } catch (error) {
    return apiError(error);
  }
}
