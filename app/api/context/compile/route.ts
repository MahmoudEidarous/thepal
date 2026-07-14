import type { WorkingTurn } from "@/lib/memory/context-compiler";
import { compileMemoryContextWithAttention } from "@/lib/memory/attention-service";
import type { AttentionMomentKind } from "@/lib/memory/attention-engine";
import { formatKnowledgeRoute, routeKnowledgeTurn } from "@/lib/knowledge-router";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

function recentTurns(value: unknown): WorkingTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is { role: "user" | "agent"; text: string } =>
        !!turn &&
        typeof turn === "object" &&
        ((turn as { role?: unknown }).role === "user" || (turn as { role?: unknown }).role === "agent") &&
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
    const turns = recentTurns(body.recentTurns);
    const selectedMemory = typeof body.selectedMemory === "string" ? body.selectedMemory : null;
    const context = await compileMemoryContextWithAttention({
      query,
      space: asSpace(body.space),
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      momentKind,
      explicitSilence: body.explicitSilence === true,
      focusMode: body.focusMode === true,
      recentTurns: turns,
      selectedMemory,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
      seenProspective: Array.isArray(body.seenProspective)
        ? body.seenProspective.filter((id: unknown): id is string => typeof id === "string").slice(0, 50)
        : [],
      includeHistory: body.includeHistory !== false,
      includePins: body.includePins !== false,
      includeProspective: body.includeProspective !== false,
      includeObligations: body.includeObligations !== false,
      includeAnniversaries: body.includeAnniversaries !== false,
    });
    const degraded = new Set(context.degradedSources);
    const coverage = {
      selectedMemory: !!selectedMemory,
      canonicalItems:
        context.currentBeliefs.length + context.uncertainty.length + context.safety.length,
      threadItems: context.activeThreads.length,
      structuredItems: context.obligations.length + context.prospective.length,
      historicalItems: context.historicalEvidence.length,
      continuityItems: context.continuityViews.length,
      semanticHistoryChecked:
        body.includeHistory !== false && query.trim().length >= 3 && !degraded.has("semantic history"),
      commitmentsChecked:
        body.includeObligations !== false && !degraded.has("commitment ledger"),
      prospectiveChecked:
        body.includeProspective !== false && !!query.trim() && !degraded.has("prospective memory"),
      degradedSources: context.degradedSources,
    };
    const knowledgeRoute = routeKnowledgeTurn({
      query,
      recentTurns: turns,
      selectedMemory,
      coverage,
    });
    const routeText = formatKnowledgeRoute(knowledgeRoute);
    return Response.json({
      ...context,
      knowledgeRoute,
      knowledgeManifest: {
        contractVersion: 1,
        routerVersion: knowledgeRoute.routerVersion,
        currentTurn: true,
        coverage,
        requiredSources: knowledgeRoute.requiredSources,
      },
      agentText: [context.agentText, routeText].filter(Boolean).join("\n\n"),
    });
  } catch (error) {
    return apiError(error);
  }
}
