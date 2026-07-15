import {
  applyAttentionChoice,
  formatAttentionDecision,
  type AttentionMomentKind,
} from "@/lib/memory/attention-engine";
import {
  compileMemoryContextWithAttention,
  recordAttentionDecision,
} from "@/lib/memory/attention-service";
import type { WorkingTurn } from "@/lib/memory/context-compiler";
import { getMemoryEventLedger } from "@/lib/memory/event-ledger";
import {
  candidateForPresence,
  composePresencePlan,
  formatPresenceDirective,
  storePreparedPresence,
  takePreparedPresence,
  type PresencePlan,
} from "@/lib/memory/presence-planner";
import {
  decideRelationshipExpression,
  formatRelationshipExpression,
} from "@/lib/memory/relationship-engine";
import { apiError, asSpace } from "@/lib/validate";

export const runtime = "nodejs";

function turns(value: unknown): WorkingTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is WorkingTurn =>
        !!turn &&
        typeof turn === "object" &&
        ((turn as { role?: unknown }).role === "user" ||
          (turn as { role?: unknown }).role === "agent") &&
        typeof (turn as { text?: unknown }).text === "string",
    )
    .slice(-8)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 2_000) }));
}

function moment(value: unknown): AttentionMomentKind {
  return value === "lull" ? "lull" : "session_start";
}

function sessionId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 160 || !/^[a-zA-Z0-9:_-]+$/.test(id)) {
    throw new Error("presence plan: a valid sessionId is required");
  }
  return id;
}

async function compile(input: {
  space: ReturnType<typeof asSpace>;
  sessionId: string;
  momentKind: AttentionMomentKind;
  recentTurns: WorkingTurn[];
  at?: string;
}) {
  return compileMemoryContextWithAttention(
    {
      query: "",
      space: input.space,
      sessionId: input.sessionId,
      momentKind: input.momentKind,
      recentTurns: input.recentTurns,
      includeHistory: false,
      includeProspective: true,
      includeObligations: true,
      includeAnniversaries: true,
      maxTokens: 1_400,
      at: input.at,
    },
    {
      mode: "active",
      relationshipMode: "active",
      persistDecision: false,
    },
  );
}

function safeCurrentPlan(
  prepared: PresencePlan,
  compiled: Awaited<ReturnType<typeof compile>>,
): PresencePlan {
  const repairRequired = compiled.attention.required.some(
    (candidate) => candidate.kind === "repair",
  );
  if (repairRequired && prepared.act !== "repair") {
    return {
      ...prepared,
      act: "repair",
      candidateId: null,
      candidateKind: null,
      utterance: "Hey. I got something wrong last time. Let me fix it cleanly.",
      fallback: true,
    };
  }
  if (prepared.candidateId && !candidateForPresence(compiled.attention, prepared)) {
    return {
      ...prepared,
      act: prepared.momentKind === "lull" ? "wait" : "simple_presence",
      candidateId: null,
      candidateKind: null,
      utterance: prepared.momentKind === "lull" ? "" : "Hey.",
      fallback: true,
    };
  }
  return prepared;
}

function commit(
  compiled: Awaited<ReturnType<typeof compile>>,
  plan: PresencePlan,
) {
  const ledger = getMemoryEventLedger();
  const attention = applyAttentionChoice(
    compiled.attention,
    plan.candidateId,
    plan.act === "wait"
      ? "the presence planner chose to hold the silence"
      : "the presence planner chose a no-memory opening",
  );
  recordAttentionDecision(ledger, "local-user", compiled.space, attention);
  const relationship = decideRelationshipExpression({
    state: compiled.relationship.state,
    attention,
    mode: "active",
  });
  return {
    plan,
    opening: plan.utterance,
    attention,
    attentionText: formatAttentionDecision(attention),
    relationship,
    relationshipText: formatRelationshipExpression(relationship),
    presenceText: [
      formatPresenceDirective(plan),
      formatAttentionDecision(attention),
      formatRelationshipExpression(relationship),
    ].join("\n\n"),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action === "consume" || body.action === "plan_and_commit"
      ? body.action
      : "prepare";
    const space = asSpace(body.space);
    const id = sessionId(body.sessionId);
    const momentKind = moment(body.momentKind);
    const recentTurns = turns(body.recentTurns);

    if (action === "consume") {
      const planId = typeof body.planId === "string" ? body.planId : "";
      const prepared = takePreparedPresence(planId);
      if (
        !prepared ||
        prepared.userId !== "local-user" ||
        prepared.space !== space ||
        prepared.sessionId !== id ||
        prepared.plan.momentKind !== momentKind
      ) {
        return Response.json(
          { error: "prepared presence plan is missing, expired, or belongs to another session" },
          { status: 409 },
        );
      }
      const compiled = await compile({ space, sessionId: id, momentKind, recentTurns });
      return Response.json(commit(compiled, safeCurrentPlan(prepared.plan, compiled)));
    }

    const compiled = await compile({ space, sessionId: id, momentKind, recentTurns });
    const ledger = getMemoryEventLedger();
    const plan = await composePresencePlan({
      momentKind,
      decision: compiled.attention,
      relationship: compiled.relationship.expression,
      handoffs: ledger.listSessionHandoffs({ space, limit: 8 }),
      greetingName: typeof body.greetingName === "string" ? body.greetingName : null,
      timeoutMs: action === "plan_and_commit" ? 2_500 : 5_000,
    });
    if (action === "plan_and_commit") {
      return Response.json(commit(compiled, plan));
    }
    const prepared = storePreparedPresence({
      userId: "local-user",
      space,
      sessionId: id,
      plan,
    });
    return Response.json({
      planId: prepared.planId,
      sessionId: prepared.sessionId,
      plan: prepared.plan,
      opening: prepared.plan.utterance,
      expiresAt: prepared.plan.expiresAt,
    });
  } catch (error) {
    return apiError(error);
  }
}
