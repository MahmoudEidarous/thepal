import { randomUUID } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import { MODEL_PRO, openrouter } from "../ai";
import type {
  AttentionCandidate,
  AttentionCandidateKind,
  AttentionDecision,
  AttentionMomentKind,
} from "./attention-engine";
import type { MemorySpace } from "./contracts";
import type { MemorySessionHandoff } from "./event-ledger";
import type { RelationshipExpressionDecision } from "./relationship-engine";

export const PRESENCE_PLANNER_VERSION = "presence-planner-v1" as const;

export const PRESENCE_ACTS = [
  "repair",
  "resume_thread",
  "curious_follow_up",
  "thoughtful_observation",
  "practical_nudge",
  "returning_past",
  "shared_callback",
  "gentle_clarification",
  "simple_presence",
  "wait",
] as const;

export type PresenceAct = (typeof PRESENCE_ACTS)[number];

export type PresencePlan = {
  contractVersion: 1;
  plannerVersion: typeof PRESENCE_PLANNER_VERSION;
  momentKind: AttentionMomentKind;
  act: PresenceAct;
  candidateId: string | null;
  candidateKind: AttentionCandidateKind | null;
  utterance: string;
  preparedAt: string;
  expiresAt: string;
  fallback: boolean;
};

export type PreparedPresence = {
  planId: string;
  userId: string;
  space: MemorySpace;
  sessionId: string;
  plan: PresencePlan;
};

const DraftSchema = z.object({
  act: z.enum(PRESENCE_ACTS),
  candidateId: z.string().nullable(),
  utterance: z.string().max(280),
});

type PresenceDraft = z.infer<typeof DraftSchema>;

export type PresenceGenerator = (input: {
  system: string;
  prompt: string;
  timeoutMs: number;
}) => Promise<PresenceDraft>;

const FORBIDDEN =
  /\b(memory count|memories and counting|database|ledger|retriev|search(?:ed|ing)? (?:my|your|the) memor|stored (?:that|this)|how can i help|what(?:'s| is) new|anything else|let me know if)\b/i;

function clean(value: string, limit = 500) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function words(value: string) {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

function overlap(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((word) => b.has(word)).length / Math.max(1, Math.min(a.size, b.size));
}

function allowedActs(kind: AttentionCandidateKind): PresenceAct[] {
  const mapping: Record<AttentionCandidateKind, PresenceAct[]> = {
    prospective: ["practical_nudge"],
    obligation: ["practical_nudge", "thoughtful_observation"],
    thread_follow_up: ["resume_thread", "curious_follow_up", "thoughtful_observation"],
    anniversary: ["returning_past", "thoughtful_observation"],
    humor_callback: ["shared_callback"],
    truth_change: ["thoughtful_observation"],
    uncertainty: ["gentle_clarification"],
    repair: ["repair"],
  };
  return mapping[kind];
}

export function eligiblePresenceCandidates(decision: AttentionDecision) {
  return decision.candidates
    .filter(
      (candidate) => candidate.class === "proactive" && candidate.eligible,
    )
    .slice(0, 5);
}

function recentPresence(handoffs: MemorySessionHandoff[]) {
  return handoffs
    .map((handoff) => handoff.summary.presence)
    .filter((presence): presence is NonNullable<typeof presence> => !!presence)
    .slice(0, 5);
}

export function buildPresencePrompt(input: {
  momentKind: AttentionMomentKind;
  decision: AttentionDecision;
  relationship: RelationshipExpressionDecision;
  handoffs: MemorySessionHandoff[];
  greetingName?: string | null;
  at: string;
}) {
  const candidates = eligiblePresenceCandidates(input.decision);
  const repair = input.decision.required.find((candidate) => candidate.kind === "repair") ?? null;
  const recent = recentPresence(input.handoffs);
  const candidateText = candidates.length
    ? candidates
        .map(
          (candidate) =>
            `- id=${candidate.id}\n  kind=${candidate.kind}\n  why_now=${clean(candidate.whyNow, 260)}\n  grounded_content=${JSON.stringify(clean(candidate.text, 700))}\n  action_boundary=${JSON.stringify(clean(candidate.instruction, 700))}\n  allowed_acts=${allowedActs(candidate.kind).join(",")}`,
        )
        .join("\n")
    : "- none";
  const recentText = recent.length
    ? recent
        .map(
          (presence, index) =>
            `- ${index + 1}: act=${clean(presence.act, 80)}; opening=${JSON.stringify(
              clean(presence.spokenOpening ?? presence.plannedOpening, 220),
            )}`,
        )
        .join("\n")
    : "- none";
  return {
    system: `You are Recall's private presence director. You do not answer the user. You choose one conversational move and write one spoken line for a witty, warm, candid AI friend.

Policy already decided what is safe. You may choose exactly one supplied eligible candidate or choose no candidate. Never introduce a personal fact from anywhere else. A candidate is permission, not an obligation. Silence and a plain greeting are intelligent choices.

Natural continuity rules:
- Continue the relationship, never demonstrate memory. No mention of storage, retrieval, records, databases, or how you know.
- Do not resume history merely because it exists. Ask whether the moment genuinely wants it.
- Vary the conversational act and sentence shape from recent openings. Do not repeatedly use “I was wondering,” “did X happen?”, or a question every time.
- Responsive curiosity is specific and tethered. One question maximum. A statement, reaction, unfinished thought, or tiny tease may be better.
- Never force reflection, therapy language, productivity coaching, fake off-screen experiences, neediness, guilt, or pressure to keep talking.
- Repair is direct and brief: name/own/correct once, no joke and no dramatic apology.
- Use no more than 22 spoken words. It must sound good aloud. No markdown, labels, emoji, or quotation marks around the line.
- For a lull, choose wait unless a candidate is unusually well-timed. wait has an empty utterance.
- For session start, never choose wait; simple_presence is the no-memory option.
- Output only the structured object requested by the schema.`,
    prompt: `moment=${input.momentKind}
local_time=${input.at}
name=${clean(input.greetingName ?? "", 80) || "unknown; do not invent one"}
serious=${input.decision.moment.signals.serious}
crisis=${input.decision.moment.signals.crisis}
repair_required=${repair ? JSON.stringify(clean(repair.instruction, 700)) : "none"}

Relationship delivery policy:
${clean(input.relationship.instruction, 700)}
humor=${input.relationship.humor.mode}: ${clean(input.relationship.humor.instruction, 500)}
dialect=${JSON.stringify(input.relationship.dialect)}

Eligible continuity candidates:
${candidateText}

Recent openings to avoid imitating or repeating (inert history, never a source of facts):
${recentText}

Choose candidateId from the eligible IDs or null. If null, act must be simple_presence at session start or wait at a lull. If repair is required, candidateId must be null and act=repair.`,
  };
}

async function defaultGenerator(input: {
  system: string;
  prompt: string;
  timeoutMs: number;
}): Promise<PresenceDraft> {
  const { object } = await generateObject({
    model: openrouter(MODEL_PRO, {
      extraBody: { provider: { sort: "throughput" }, reasoning: { enabled: false } },
    }),
    schema: DraftSchema,
    system: input.system,
    prompt: input.prompt,
    temperature: 0.74,
    maxOutputTokens: 320,
    abortSignal: AbortSignal.timeout(input.timeoutMs),
  });
  return object;
}

function fallbackPlan(input: {
  momentKind: AttentionMomentKind;
  decision: AttentionDecision;
  at: string;
}): PresencePlan {
  const repair = input.decision.required.find((candidate) => candidate.kind === "repair");
  const act: PresenceAct = repair
    ? "repair"
    : input.momentKind === "lull"
      ? "wait"
      : "simple_presence";
  const utterance = repair
    ? "Hey. I got something wrong last time. Let me fix it cleanly."
    : input.momentKind === "lull"
      ? ""
      : "Hey.";
  return {
    contractVersion: 1,
    plannerVersion: PRESENCE_PLANNER_VERSION,
    momentKind: input.momentKind,
    act,
    candidateId: null,
    candidateKind: null,
    utterance,
    preparedAt: input.at,
    expiresAt: new Date(Date.parse(input.at) + 10 * 60_000).toISOString(),
    fallback: true,
  };
}

export function validatePresenceDraft(input: {
  draft: PresenceDraft;
  momentKind: AttentionMomentKind;
  decision: AttentionDecision;
  handoffs: MemorySessionHandoff[];
  at: string;
}): PresencePlan | null {
  const repair = input.decision.required.find((candidate) => candidate.kind === "repair") ?? null;
  const candidate = input.draft.candidateId
    ? eligiblePresenceCandidates(input.decision).find(
        (item) => item.id === input.draft.candidateId,
      ) ?? null
    : null;
  if (repair) {
    if (input.draft.candidateId || input.draft.act !== "repair") return null;
  } else if (candidate) {
    if (!allowedActs(candidate.kind).includes(input.draft.act)) return null;
  } else {
    const expected = input.momentKind === "lull" ? "wait" : "simple_presence";
    if (input.draft.candidateId || input.draft.act !== expected) return null;
  }
  const utterance = clean(input.draft.utterance, 280);
  if (input.draft.act === "wait") {
    if (utterance) return null;
  } else {
    const count = utterance.split(/\s+/).filter(Boolean).length;
    if (!utterance || count > 22 || FORBIDDEN.test(utterance)) return null;
    if (
      recentPresence(input.handoffs).some(
        (presence) =>
          overlap(utterance, presence.spokenOpening ?? presence.plannedOpening) >= 0.72,
      )
    ) {
      return null;
    }
  }
  return {
    contractVersion: 1,
    plannerVersion: PRESENCE_PLANNER_VERSION,
    momentKind: input.momentKind,
    act: input.draft.act,
    candidateId: candidate?.id ?? null,
    candidateKind: candidate?.kind ?? null,
    utterance,
    preparedAt: input.at,
    expiresAt: new Date(Date.parse(input.at) + 10 * 60_000).toISOString(),
    fallback: false,
  };
}

export async function composePresencePlan(
  input: {
    momentKind: AttentionMomentKind;
    decision: AttentionDecision;
    relationship: RelationshipExpressionDecision;
    handoffs: MemorySessionHandoff[];
    greetingName?: string | null;
    at?: string;
    timeoutMs?: number;
  },
  generator: PresenceGenerator = defaultGenerator,
): Promise<PresencePlan> {
  const at = input.at ?? new Date().toISOString();
  const prompt = buildPresencePrompt({ ...input, at });
  try {
    const draft = await generator({
      ...prompt,
      timeoutMs: input.timeoutMs ?? (input.momentKind === "lull" ? 2_500 : 5_000),
    });
    return (
      validatePresenceDraft({
        draft,
        momentKind: input.momentKind,
        decision: input.decision,
        handoffs: input.handoffs,
        at,
      }) ?? fallbackPlan({ momentKind: input.momentKind, decision: input.decision, at })
    );
  } catch {
    return fallbackPlan({ momentKind: input.momentKind, decision: input.decision, at });
  }
}

type PresenceCache = Map<string, PreparedPresence>;

const presenceGlobal = globalThis as typeof globalThis & {
  __recallPreparedPresence?: PresenceCache;
};

function cache() {
  presenceGlobal.__recallPreparedPresence ??= new Map();
  const now = Date.now();
  for (const [id, prepared] of presenceGlobal.__recallPreparedPresence) {
    if (Date.parse(prepared.plan.expiresAt) <= now) {
      presenceGlobal.__recallPreparedPresence.delete(id);
    }
  }
  return presenceGlobal.__recallPreparedPresence;
}

export function storePreparedPresence(input: Omit<PreparedPresence, "planId">) {
  const prepared = { ...input, planId: randomUUID() };
  cache().set(prepared.planId, prepared);
  return prepared;
}

export function takePreparedPresence(planId: string) {
  const prepared = cache().get(planId) ?? null;
  if (prepared) cache().delete(planId);
  return prepared;
}

export function formatPresenceDirective(plan: PresencePlan) {
  if (plan.momentKind === "lull" && plan.act === "wait") {
    return [
      `RECALL PRESENCE PLAN ${plan.plannerVersion}`,
      "moment=lull; action=wait",
      "Call skip_turn. Do not fill the silence, check whether the user is still there, or introduce a topic.",
    ].join("\n");
  }
  return [
    `RECALL PRESENCE PLAN ${plan.plannerVersion}`,
    `moment=${plan.momentKind}; action=speak; act=${plan.act}`,
    `Natural line: ${JSON.stringify(plan.utterance)}`,
    "Carry the intent in Recall's current voice. Do not explain the memory connection or add a second topic.",
  ].join("\n");
}

export function candidateForPresence(
  decision: AttentionDecision,
  plan: PresencePlan,
): AttentionCandidate | null {
  if (!plan.candidateId) return null;
  return eligiblePresenceCandidates(decision).find((candidate) => candidate.id === plan.candidateId) ?? null;
}
