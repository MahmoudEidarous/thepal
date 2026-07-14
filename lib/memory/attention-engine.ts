import { createHash } from "node:crypto";
import type {
  CompiledContext,
  ContextItem,
  WorkingTurn,
} from "./context-compiler";
import type { ReturningMemory } from "./continuity-projectors";
import type { MemorySpace, Sensitivity, TrustTier } from "./contracts";

export const ATTENTION_ENGINE_VERSION = "attention-v1" as const;

export type AttentionMode = "shadow" | "guarded" | "active";
export type AttentionMomentKind = "session_start" | "user_turn" | "lull";
export type AttentionCandidateKind =
  | "prospective"
  | "obligation"
  | "thread_follow_up"
  | "anniversary"
  | "humor_callback"
  | "truth_change"
  | "uncertainty"
  | "repair";
export type AttentionCandidateClass = "required" | "proactive";
export type AttentionAction =
  | "deliver_forward_intention"
  | "mention_obligation"
  | "ask_thread_follow_up"
  | "offer_returning_past"
  | "use_shared_callback"
  | "apply_current_truth"
  | "ask_for_clarification"
  | "repair_relationship";
export type AttentionGateName =
  | "user_permission"
  | "memory_space"
  | "source_grounding"
  | "sensitivity"
  | "boundary"
  | "interruptibility"
  | "repair_priority"
  | "cooldown";

export type AttentionRepair = {
  reason: string;
  instruction: string;
  evidenceEventIds?: string[];
  relationshipEventIds?: string[];
};

export type AttentionMoment = {
  id: string;
  userId: string;
  space: MemorySpace;
  sessionId: string;
  kind: AttentionMomentKind;
  query: string;
  recentTurns: WorkingTurn[];
  at: string;
  explicitSilence?: boolean;
  focusMode?: boolean;
  repair?: AttentionRepair | null;
};

export type AttentionChange = {
  id: string;
  currentText: string;
  previousText: string;
  recordedAt: string;
  trust: TrustTier;
  sensitivity: Sensitivity;
  evidenceEventIds: string[];
};

export type AttentionSupplement = {
  anniversaries?: Array<ReturningMemory & {
    trust?: TrustTier | null;
    sensitivity?: Sensitivity;
    evidenceEventIds?: string[];
  }>;
  changes?: AttentionChange[];
  callbacks?: Array<{
    id: string;
    reference: string;
    theme: string;
    confidence: "direct";
    sensitivity: Sensitivity;
    evidenceEventIds: string[];
    relationshipEventIds: string[];
    lastUsedAt: string | null;
  }>;
};

export type AttentionHistoryItem = {
  candidateId: string;
  cooldownKey: string;
  kind: AttentionCandidateKind;
  surfacedAt: string;
};

export type AttentionMomentSignals = {
  crisis: boolean;
  serious: boolean;
  goodbye: boolean;
  midThought: boolean;
  taskFocused: boolean;
  explicitInvitation: boolean;
  lull: boolean;
  cognitiveLoad: "low" | "normal" | "high";
};

export type AttentionFactors = {
  helpfulness: number;
  urgency: number;
  actionability: number;
  relationalValue: number;
  repairValue: number;
  interruptionCost: number;
  repetitionCost: number;
  uncertaintyCost: number;
  sensitivityRisk: number;
  userLoad: number;
};

export type AttentionGate = {
  name: AttentionGateName;
  passed: boolean;
  reason: string;
};

export type AttentionCandidate = {
  id: string;
  sourceItemId: string;
  kind: AttentionCandidateKind;
  class: AttentionCandidateClass;
  action: AttentionAction;
  text: string;
  instruction: string;
  whyNow: string;
  cooldownKey: string;
  threshold: number;
  score: number;
  relevance: number;
  sensitivity: Sensitivity;
  confidence: ContextItem["confidence"];
  evidenceEventIds: string[];
  relationshipEventIds: string[];
  factors: AttentionFactors;
  gates: AttentionGate[];
  eligible: boolean;
  blockedBy: string[];
  metadata: Record<string, string | number | boolean | null>;
};

export type AttentionDecision = {
  contractVersion: 1;
  engineVersion: typeof ATTENTION_ENGINE_VERSION;
  id: string;
  mode: AttentionMode;
  decidedAt: string;
  moment: {
    id: string;
    kind: AttentionMomentKind;
    sessionId: string;
    signals: AttentionMomentSignals;
  };
  candidates: AttentionCandidate[];
  required: AttentionCandidate[];
  selected: AttentionCandidate | null;
  surface: AttentionCandidate | null;
  proactiveAction: "speak" | "stay_silent";
  silenceReason: string | null;
  candidateLimit: 1;
};

type CandidateDraft = Omit<
  AttentionCandidate,
  "score" | "gates" | "eligible" | "blockedBy"
>;

const STOP = new Set(
  "a an and are as at be but by did do does for from had has have how i in is it me my of on or our that the this to was we were what when where which who why with you your".split(" "),
);

const CRISIS = /\b(suicid|kill myself|hurt myself|self harm|overdose|can'?t go on|immediate danger|emergency right now)\b/i;
const SERIOUS = /\b(died|death|grief|funeral|cancer|hospital|surgery|panic attack|terrified|abuse|assault|fired today|breakup|broke up)\b/i;
const GOODBYE = /\b(goodbye|good night|goodnight|gotta go|have to run|talk later|bye)\b/i;
const MID_THOUGHT = /(?:—|-|\.\.\.)\s*$|\b(wait|hold on|one sec|give me a second|let me think)\b/i;
const INVITATION = /\b(what am i forgetting|anything coming up|remind me|what should i remember|what needs my attention|catch me up|what did i miss)\b/i;
const TASK_FOCUS = /\b(write|build|fix|debug|calculate|translate|summarize|research|step by step|how do i|give me the|show me the)\b/i;
const SILENCE_REQUEST = /\b(don'?t interrupt|do not interrupt|no reminders|don'?t remind me|do not remind me|don'?t bring anything up|leave me alone|need quiet|stay quiet|not now|never mind)\b/i;
const PROSPECTIVE_MANAGEMENT = /\b(what|which|list|show).{0,40}\b(remind|prospective|waiting)|\b(cancel|snooze|resolve|handled|already did|already done|not now|never mind|don'?t remind|do not remind)\b/i;
const BOUNDARY_LANGUAGE = /\b(do not mention|don'?t mention|never mention|don'?t bring up|do not bring up|keep .* private|off limits)\b/i;

function clean(value: string, limit = 1_000) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string) {
  return `${prefix}:${hash(value).slice(0, 20)}`;
}

function words(value: string) {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token && !STOP.has(token) && (token.length > 2 || /^\d+$/.test(token))),
  );
}

function relevance(left: string, right: string) {
  const a = words(left);
  const b = words(right);
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

function parseInstant(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursBetween(earlier: string, later: string) {
  return (Date.parse(later) - Date.parse(earlier)) / 3_600_000;
}

function factorScore(factors: AttentionFactors) {
  return (
    factors.helpfulness +
    factors.urgency +
    factors.actionability +
    factors.relationalValue +
    factors.repairValue -
    factors.interruptionCost -
    factors.repetitionCost -
    factors.uncertaintyCost -
    factors.sensitivityRisk -
    factors.userLoad
  );
}

function draft(
  input: Omit<CandidateDraft, "cooldownKey" | "relationshipEventIds"> & {
    cooldownSeed: string;
    relationshipEventIds?: string[];
  },
): CandidateDraft {
  const { cooldownSeed, ...candidate } = input;
  return {
    ...candidate,
    relationshipEventIds: candidate.relationshipEventIds ?? [],
    cooldownKey: hash(`${candidate.kind}|${cooldownSeed}`).slice(0, 32),
  };
}

function gate(name: AttentionGateName, passed: boolean, reason: string): AttentionGate {
  return { name, passed, reason };
}

function cooldownHours(kind: AttentionCandidateKind) {
  const values: Record<AttentionCandidateKind, number> = {
    prospective: 12,
    obligation: 20,
    thread_follow_up: 72,
    anniversary: 20,
    humor_callback: 336,
    truth_change: 1,
    uncertainty: 1,
    repair: 0,
  };
  return values[kind];
}

function boundaryBlocks(candidate: CandidateDraft, safety: ContextItem[]) {
  return safety.some(
    (item) =>
      BOUNDARY_LANGUAGE.test(item.text) &&
      relevance(candidate.text, item.text) > 0,
  );
}

function classifyMoment(moment: AttentionMoment): AttentionMomentSignals {
  const query = clean(moment.query, 2_000);
  const previousUser = [...moment.recentTurns]
    .reverse()
    .find((turn) => turn.role === "user")?.text ?? "";
  const short = query.split(/\s+/).filter(Boolean).length <= 4;
  const repeatedShort = short && previousUser.split(/\s+/).filter(Boolean).length <= 4;
  const explicitInvitation = INVITATION.test(query);
  const taskFocused = TASK_FOCUS.test(query) && !explicitInvitation;
  const serious = SERIOUS.test(query);
  const crisis = CRISIS.test(query);
  const midThought = MID_THOUGHT.test(query);
  const lull =
    moment.kind === "lull" ||
    moment.kind === "session_start" ||
    /^(hi|hey|hello|hmm|mm|idk|not much|nothing much)[.!? ]*$/i.test(query) ||
    repeatedShort;
  const cognitiveLoad =
    crisis || serious || query.length > 500
      ? "high"
      : taskFocused || query.length > 220
        ? "normal"
        : "low";
  return {
    crisis,
    serious,
    goodbye: GOODBYE.test(query),
    midThought,
    taskFocused,
    explicitInvitation,
    lull,
    cognitiveLoad,
  };
}

function userAllows(moment: AttentionMoment, signals: AttentionMomentSignals) {
  return !moment.explicitSilence && !SILENCE_REQUEST.test(moment.query) && !signals.goodbye;
}

function interruptionAllowed(
  candidate: CandidateDraft,
  moment: AttentionMoment,
  signals: AttentionMomentSignals,
) {
  if (candidate.class === "required") return true;
  if (signals.crisis || signals.serious || signals.midThought) return false;
  if (moment.focusMode) return false;
  if (candidate.kind === "prospective" && PROSPECTIVE_MANAGEMENT.test(moment.query)) return false;
  if (signals.taskFocused && !signals.explicitInvitation && candidate.relevance < 0.5) return false;
  if (candidate.kind === "anniversary") {
    return signals.lull || signals.explicitInvitation || candidate.relevance >= 0.5;
  }
  if (candidate.kind === "humor_callback") {
    return signals.lull || signals.explicitInvitation || candidate.relevance >= 0.5;
  }
  return true;
}

function isGrounded(candidate: CandidateDraft) {
  if (candidate.kind === "repair") return true;
  if (candidate.kind === "prospective" || candidate.kind === "obligation") {
    return candidate.confidence === "direct";
  }
  if (candidate.class === "proactive") {
    return candidate.confidence === "direct" || candidate.confidence === "strong";
  }
  return candidate.confidence !== "tentative";
}

function sensitivityAllows(candidate: CandidateDraft) {
  if (candidate.kind === "repair") return true;
  if (candidate.sensitivity === "restricted") return false;
  if (candidate.sensitivity === "sensitive") {
    return (
      candidate.kind === "prospective" &&
      candidate.metadata.match === "exact" &&
      candidate.relevance >= 0.5
    );
  }
  return true;
}

function cooldownAllows(
  candidate: CandidateDraft,
  history: AttentionHistoryItem[],
  at: string,
) {
  if (candidate.class === "required" || candidate.kind === "repair") return true;
  const window = cooldownHours(candidate.kind);
  return !history.some(
    (item) =>
      (item.candidateId === candidate.id || item.cooldownKey === candidate.cooldownKey) &&
      hoursBetween(item.surfacedAt, at) >= 0 &&
      hoursBetween(item.surfacedAt, at) < window,
  );
}

function gatesFor(
  candidate: CandidateDraft,
  context: CompiledContext,
  moment: AttentionMoment,
  signals: AttentionMomentSignals,
  history: AttentionHistoryItem[],
) {
  const boundaryBlocked = boundaryBlocks(candidate, context.safety);
  const repairPending = !!moment.repair;
  return [
    gate(
      "user_permission",
      candidate.class === "required" || userAllows(moment, signals),
      candidate.class === "required"
        ? "response correctness is still required"
        : userAllows(moment, signals)
          ? "the user has not requested silence"
          : "the user requested quiet or is leaving",
    ),
    gate("memory_space", context.space === moment.space, "candidate came from the current memory space"),
    gate(
      "source_grounding",
      isGrounded(candidate),
      isGrounded(candidate)
        ? "evidence clears the action's confidence floor"
        : "evidence is too tentative for proactive use",
    ),
    gate(
      "sensitivity",
      sensitivityAllows(candidate),
      sensitivityAllows(candidate)
        ? "sensitivity policy permits this use"
        : "sensitive or restricted evidence cannot be surfaced this way",
    ),
    gate(
      "boundary",
      !boundaryBlocked,
      boundaryBlocked ? "an explicit pinned boundary covers this topic" : "no pinned boundary blocks this topic",
    ),
    gate(
      "interruptibility",
      interruptionAllowed(candidate, moment, signals),
      interruptionAllowed(candidate, moment, signals)
        ? "the present moment can carry this action"
        : "the current turn is serious, focused, unfinished, or unrelated",
    ),
    gate(
      "repair_priority",
      !repairPending || candidate.kind === "repair",
      repairPending && candidate.kind !== "repair"
        ? "relationship repair outranks every proactive aside"
        : "no unresolved repair displaces this action",
    ),
    gate(
      "cooldown",
      cooldownAllows(candidate, history, moment.at),
      cooldownAllows(candidate, history, moment.at)
        ? "candidate and topic are outside their cooldown"
        : "this candidate or topic surfaced too recently",
    ),
  ];
}

function userLoad(signals: AttentionMomentSignals) {
  return signals.cognitiveLoad === "high" ? 24 : signals.cognitiveLoad === "normal" ? 8 : 2;
}

function prospectives(context: CompiledContext, moment: AttentionMoment, signals: AttentionMomentSignals) {
  return context.prospective.map((item): CandidateDraft => {
    const match = item.metadata.match === "exact" ? "exact" : "fuzzy";
    const rel = match === "exact" ? 1 : Number(item.metadata.matchScore ?? 0.72);
    const factors: AttentionFactors = {
      helpfulness: 24,
      urgency: 16,
      actionability: 26,
      relationalValue: 12,
      repairValue: 0,
      interruptionCost: signals.lull ? 2 : 6,
      repetitionCost: 0,
      uncertaintyCost: match === "exact" ? 0 : 8,
      sensitivityRisk: item.sensitivity === "normal" ? 0 : match === "exact" ? 6 : 18,
      userLoad: userLoad(signals),
    };
    return draft({
      id: `prospective:${item.id}`,
      sourceItemId: item.id,
      kind: "prospective",
      class: "proactive",
      action: "deliver_forward_intention",
      text: item.text,
      instruction: `Call manage_prospective_memory with id=${item.id} and action=fire. Only after it succeeds, deliver the requested reminder once in one natural line and say the user asked for it when this topic returned.`,
      whyNow: item.whyIncluded,
      cooldownSeed: String(item.metadata.topic ?? item.id),
      threshold: match === "exact" ? 58 : 62,
      relevance: rel,
      sensitivity: item.sensitivity,
      confidence: item.confidence,
      evidenceEventIds: item.evidenceEventIds,
      factors,
      metadata: { ...item.metadata, match },
    });
  });
}

function obligations(context: CompiledContext, moment: AttentionMoment, signals: AttentionMomentSignals) {
  return context.obligations.map((item): CandidateDraft => {
    const rel = relevance(moment.query, item.text);
    const due = parseInstant(item.metadata.due);
    const days = due === null ? null : Math.floor((due - Date.parse(moment.at)) / 86_400_000);
    const overdue = item.metadata.overdue === true || (days !== null && days < 0);
    const urgency = overdue ? 26 : days !== null && days <= 1 ? 22 : days !== null && days <= 7 ? 14 : 2;
    const factors: AttentionFactors = {
      helpfulness: 18,
      urgency,
      actionability: 18,
      relationalValue: 5,
      repairValue: 0,
      interruptionCost: rel >= 0.5 || signals.explicitInvitation ? 3 : signals.lull ? 7 : 14,
      repetitionCost: 0,
      uncertaintyCost: 0,
      sensitivityRisk: item.sensitivity === "normal" ? 0 : 20,
      userLoad: userLoad(signals),
    };
    return draft({
      id: `obligation:${item.id}`,
      sourceItemId: item.id,
      kind: "obligation",
      class: "proactive",
      action: "mention_obligation",
      text: item.text,
      instruction: "Mention the obligation briefly and concretely. Do not turn it into productivity coaching; allow an easy move-on.",
      whyNow: item.whyIncluded,
      cooldownSeed: item.id,
      threshold: 58,
      relevance: rel,
      sensitivity: item.sensitivity,
      confidence: item.confidence,
      evidenceEventIds: item.evidenceEventIds,
      factors,
      metadata: { ...item.metadata, daysUntilDue: days },
    });
  });
}

function threads(context: CompiledContext, moment: AttentionMoment, signals: AttentionMomentSignals) {
  return context.activeThreads.map((item): CandidateDraft => {
    const rel = relevance(moment.query, `${item.text} ${String(item.metadata.title ?? "")}`);
    const title = clean(String(item.metadata.title ?? "this situation"), 220);
    const expectedNext = clean(String(item.metadata.expectedNext ?? ""), 500);
    const reviewAt = parseInstant(item.metadata.nextReviewAt);
    const reviewDue = reviewAt !== null && reviewAt <= Date.parse(moment.at);
    const expectedAt = parseInstant(item.metadata.expectedBy);
    const expectedPassed = expectedAt !== null && expectedAt <= Date.parse(moment.at);
    const factors: AttentionFactors = {
      helpfulness: 15,
      urgency: expectedPassed ? 20 : reviewDue ? 16 : rel >= 0.5 ? 8 : 0,
      actionability: expectedPassed || reviewDue ? 16 : 7,
      relationalValue: 15,
      repairValue: 0,
      interruptionCost: rel >= 0.5 || signals.explicitInvitation ? 4 : signals.lull ? 10 : 18,
      repetitionCost: 0,
      uncertaintyCost: item.confidence === "strong" || item.confidence === "direct" ? 0 : 18,
      sensitivityRisk: item.sensitivity === "normal" ? 0 : 22,
      userLoad: userLoad(signals),
    };
    return draft({
      id: `thread:${item.id}`,
      sourceItemId: item.id,
      kind: "thread_follow_up",
      class: "proactive",
      action: "ask_thread_follow_up",
      text: item.text,
      instruction: expectedNext
        ? `Ask one specific, grounded question about ${JSON.stringify(expectedNext)} in ${JSON.stringify(title)}. Never ask a generic ‘any updates?’ and never imply resolution.`
        : `Ask one specific, grounded question about ${JSON.stringify(title)}. Never ask a generic ‘any updates?’ and never imply resolution.`,
      whyNow: expectedPassed
        ? "the expected development should already have happened"
        : reviewDue
          ? "the thread reached its deterministic review time"
          : item.whyIncluded,
      cooldownSeed: String(item.metadata.title ?? item.id),
      threshold: 48,
      relevance: rel,
      sensitivity: item.sensitivity,
      confidence: item.confidence,
      evidenceEventIds: item.evidenceEventIds,
      factors,
      metadata: { ...item.metadata, reviewDue, expectedPassed },
    });
  });
}

function anniversaries(
  supplement: AttentionSupplement,
  moment: AttentionMoment,
  signals: AttentionMomentSignals,
) {
  return (supplement.anniversaries ?? []).map((item, index): CandidateDraft => {
    const rel = relevance(moment.query, item.text);
    const trust = item.trust ?? null;
    const grounded = trust === "user_direct" || trust === "user_approved";
    const factors: AttentionFactors = {
      helpfulness: signals.explicitInvitation ? 18 : 8,
      urgency: 8,
      actionability: 5,
      relationalValue: signals.lull || moment.kind === "session_start" ? 34 : 20,
      repairValue: 0,
      interruptionCost: signals.lull ? 4 : rel >= 0.5 ? 7 : 18,
      repetitionCost: 0,
      uncertaintyCost: grounded ? 0 : 30,
      sensitivityRisk: item.sensitivity === "normal" || !item.sensitivity ? 0 : 28,
      userLoad: userLoad(signals),
    };
    return draft({
      id: stableId("anniversary", `${item.storyDate}|${item.text}|${index}`),
      sourceItemId: item.evidenceEventIds?.[0] ?? stableId("returning-past", item.storyDate),
      kind: "anniversary",
      class: "proactive",
      action: "offer_returning_past",
      text: `${item.when}: ${item.text}`,
      instruction: "Offer the returning memory lightly in one line, without forcing reflection. If the user moves on, let it go immediately.",
      whyNow: item.when,
      cooldownSeed: item.storyDate,
      threshold: 48,
      relevance: rel,
      sensitivity: item.sensitivity ?? "normal",
      confidence: grounded ? "direct" : "tentative",
      evidenceEventIds: item.evidenceEventIds ?? [],
      factors,
      metadata: { storyDate: item.storyDate, when: item.when, trust: trust ?? "unclassified" },
    });
  });
}

function humorCallbacks(
  supplement: AttentionSupplement,
  moment: AttentionMoment,
  signals: AttentionMomentSignals,
) {
  return (supplement.callbacks ?? [])
    .map((item): CandidateDraft | null => {
      const rel = relevance(moment.query, `${item.theme} ${item.reference}`);
      if (!moment.query.trim() || rel === 0) return null;
      const factors: AttentionFactors = {
        helpfulness: 5,
        urgency: 0,
        actionability: 2,
        relationalValue: 45,
        repairValue: 0,
        interruptionCost: rel >= 0.5 ? 4 : signals.lull ? 10 : 22,
        repetitionCost: 0,
        uncertaintyCost: 0,
        sensitivityRisk: item.sensitivity === "normal" ? 0 : 40,
        userLoad: userLoad(signals),
      };
      return draft({
        id: `humor-callback:${item.id}`,
        sourceItemId: item.id,
        kind: "humor_callback",
        class: "proactive",
        action: "use_shared_callback",
        text: `${item.theme}: ${item.reference}`,
        instruction: `Only if a fresh connection is obvious, call record_relationship_event with kind=humor_callback, artifact_id=${item.id}, reference="${clean(item.reference, 220)}", theme="${clean(item.theme, 160)}", and a factual summary; then use the shared reference at most once. Never repeat the original successful wording verbatim. If the connection is weak, use no joke and do not record a callback.`,
        whyNow: "the current turn naturally touches a shared reference the user previously reused",
        cooldownSeed: item.id,
        threshold: 44,
        relevance: rel,
        sensitivity: item.sensitivity,
        confidence: item.confidence,
        evidenceEventIds: item.evidenceEventIds,
        relationshipEventIds: item.relationshipEventIds,
        factors,
        metadata: {
          artifactId: item.id,
          theme: item.theme,
          lastUsedAt: item.lastUsedAt,
        },
      });
    })
    .filter((item): item is CandidateDraft => !!item);
}

function truthChanges(supplement: AttentionSupplement, moment: AttentionMoment, signals: AttentionMomentSignals) {
  return (supplement.changes ?? [])
    .map((item): CandidateDraft | null => {
      const rel = relevance(moment.query, `${item.currentText} ${item.previousText}`);
      if (!moment.query.trim() || rel === 0) return null;
      const factors: AttentionFactors = {
        helpfulness: 28,
        urgency: 10,
        actionability: 18,
        relationalValue: 4,
        repairValue: 8,
        interruptionCost: 0,
        repetitionCost: 0,
        uncertaintyCost: item.trust === "user_direct" || item.trust === "user_approved" ? 0 : 25,
        sensitivityRisk: item.sensitivity === "restricted" ? 25 : 0,
        userLoad: signals.cognitiveLoad === "high" ? 4 : 0,
      };
      return draft({
        id: `truth-change:${item.id}`,
        sourceItemId: item.id,
        kind: "truth_change",
        class: "required",
        action: "apply_current_truth",
        text: item.currentText,
        instruction: `Use the current applicable truth. Mention that it changed only if the change itself helps answer; never resurrect the superseded version as current. Previous evidence: ${item.previousText}`,
        whyNow: "the current turn touches a fact that changed",
        cooldownSeed: item.id,
        threshold: 45,
        relevance: rel,
        sensitivity: item.sensitivity,
        confidence: item.trust === "user_direct" || item.trust === "user_approved" ? "direct" : "tentative",
        evidenceEventIds: item.evidenceEventIds,
        factors,
        metadata: { recordedAt: item.recordedAt, trust: item.trust },
      });
    })
    .filter((item): item is CandidateDraft => !!item);
}

function uncertainties(context: CompiledContext, moment: AttentionMoment, signals: AttentionMomentSignals) {
  return context.uncertainty
    .map((item): CandidateDraft | null => {
      const rel = relevance(moment.query, item.text);
      if (!moment.query.trim() || rel === 0) return null;
      const factors: AttentionFactors = {
        helpfulness: 26,
        urgency: 8,
        actionability: 17,
        relationalValue: 4,
        repairValue: 8,
        interruptionCost: 0,
        repetitionCost: 0,
        uncertaintyCost: 5,
        sensitivityRisk: item.sensitivity === "restricted" ? 25 : 0,
        userLoad: signals.cognitiveLoad === "high" ? 4 : 0,
      };
      return draft({
        id: `uncertainty:${item.id}`,
        sourceItemId: item.id,
        kind: "uncertainty",
        class: "required",
        action: "ask_for_clarification",
        text: item.text,
        instruction: "Do not choose a side or average conflicting evidence. State the uncertainty briefly and ask one concrete clarification only if the answer depends on it.",
        whyNow: "the answer depends on unresolved current evidence",
        cooldownSeed: item.id,
        threshold: 42,
        relevance: rel,
        sensitivity: item.sensitivity,
        confidence: item.confidence,
        evidenceEventIds: item.evidenceEventIds,
        factors,
        metadata: { ...item.metadata },
      });
    })
    .filter((item): item is CandidateDraft => !!item);
}

function repair(moment: AttentionMoment): CandidateDraft[] {
  if (!moment.repair) return [];
  const factors: AttentionFactors = {
    helpfulness: 25,
    urgency: 25,
    actionability: 20,
    relationalValue: 10,
    repairValue: 40,
    interruptionCost: 0,
    repetitionCost: 0,
    uncertaintyCost: 0,
    sensitivityRisk: 0,
    userLoad: 0,
  };
  return [
    draft({
      id: stableId("repair", `${moment.sessionId}|${moment.repair.reason}`),
      sourceItemId: stableId("repair-state", moment.repair.reason),
      kind: "repair",
      class: "required",
      action: "repair_relationship",
      text: clean(moment.repair.reason, 500),
      instruction: clean(moment.repair.instruction, 800),
      whyNow: "Recall has an unresolved mistake or rupture to own before continuing",
      cooldownSeed: moment.repair.reason,
      threshold: 0,
      relevance: 1,
      sensitivity: "normal",
      confidence: "direct",
      evidenceEventIds: moment.repair.evidenceEventIds ?? [],
      relationshipEventIds: moment.repair.relationshipEventIds ?? [],
      factors,
      metadata: {},
    }),
  ];
}

function rolloutAllows(mode: AttentionMode, candidate: AttentionCandidate) {
  if (mode === "shadow") return false;
  if (mode === "active") return true;
  return candidate.kind === "prospective" && candidate.metadata.match === "exact";
}

function sortCandidates(left: AttentionCandidate, right: AttentionCandidate) {
  return right.score - left.score || right.relevance - left.relevance || left.id.localeCompare(right.id);
}

export function attentionMode(value = process.env.RECALL_ATTENTION_MODE): AttentionMode {
  return value === "shadow" || value === "active" || value === "guarded" ? value : "guarded";
}

export function decideAttention(
  input: {
    mode?: AttentionMode;
    moment: AttentionMoment;
    context: CompiledContext;
    supplement?: AttentionSupplement;
    history?: AttentionHistoryItem[];
  },
): AttentionDecision {
  const mode = input.mode ?? attentionMode();
  const supplement = input.supplement ?? {};
  const history = input.history ?? [];
  const signals = classifyMoment(input.moment);
  const drafts = [
    ...repair(input.moment),
    ...truthChanges(supplement, input.moment, signals),
    ...uncertainties(input.context, input.moment, signals),
    ...prospectives(input.context, input.moment, signals),
    ...obligations(input.context, input.moment, signals),
    ...threads(input.context, input.moment, signals),
    ...humorCallbacks(supplement, input.moment, signals),
    ...anniversaries(supplement, input.moment, signals),
  ];
  const candidates = drafts
    .map((candidate): AttentionCandidate => {
      const gates = gatesFor(candidate, input.context, input.moment, signals, history);
      const repeated = gates.some((item) => item.name === "cooldown" && !item.passed);
      const factors = {
        ...candidate.factors,
        repetitionCost: repeated ? Math.max(30, candidate.factors.repetitionCost) : candidate.factors.repetitionCost,
      };
      const score = factorScore(factors);
      const blockedBy = gates.filter((item) => !item.passed).map((item) => item.name);
      return {
        ...candidate,
        factors,
        score,
        gates,
        eligible: blockedBy.length === 0 && score >= candidate.threshold,
        blockedBy,
      };
    })
    .sort(sortCandidates);
  const required = candidates
    .filter((candidate) => candidate.class === "required" && candidate.eligible)
    .slice(0, 3);
  const repairRequired = required.some((candidate) => candidate.kind === "repair");
  const selected = repairRequired
    ? null
    : candidates.find((candidate) => candidate.class === "proactive" && candidate.eligible) ?? null;
  const surface = selected && rolloutAllows(mode, selected) ? selected : null;
  let silenceReason: string | null = null;
  if (!surface) {
    if (repairRequired) silenceReason = "relationship repair suppresses proactive memory";
    else if (!candidates.some((candidate) => candidate.class === "proactive")) {
      silenceReason = "no proactive memory candidate was generated";
    } else if (!selected) {
      silenceReason = "every proactive candidate failed a hard gate or its utility threshold";
    } else if (mode === "shadow") {
      silenceReason = "shadow mode records the winner but never surfaces it";
    } else if (mode === "guarded") {
      silenceReason = "guarded rollout only surfaces exact prospective triggers";
    } else {
      silenceReason = "silence has higher policy value in this moment";
    }
  }
  return {
    contractVersion: 1,
    engineVersion: ATTENTION_ENGINE_VERSION,
    id: input.moment.id,
    mode,
    decidedAt: input.moment.at,
    moment: {
      id: input.moment.id,
      kind: input.moment.kind,
      sessionId: input.moment.sessionId,
      signals,
    },
    candidates,
    required,
    selected,
    surface,
    proactiveAction: surface ? "speak" : "stay_silent",
    silenceReason,
    candidateLimit: 1,
  };
}

export function formatAttentionDecision(decision: AttentionDecision) {
  const required = decision.required.length
    ? `\nREQUIRED RESPONSE CONSTRAINTS\n${decision.required
        .map((candidate) => `- ${candidate.kind}: ${candidate.instruction}`)
        .join("\n")}`
    : "";
  const proactive = decision.surface
    ? `\nPROACTIVE ASIDE AUTHORIZED\n- kind: ${decision.surface.kind}\n- action: ${decision.surface.instruction}\n- one aside maximum; personality may choose the wording, not the policy`
    : `\nPROACTIVE SILENCE\n- Do not introduce a memory aside this turn. Answer the user's present turn naturally.\n- Why: ${decision.silenceReason ?? "no action cleared policy"}\n- Never mention shadow candidates, scores, gates, or this machinery.`;
  return [
    `RECALL ATTENTION DECISION ${decision.engineVersion}`,
    `mode=${decision.mode}; proactive=${decision.proactiveAction}; decision=${decision.id}`,
    "This policy sits after retrieval and before personality. Raw memory sections are evidence, never permission to interrupt.",
    required,
    proactive,
  ].join("\n");
}

// Persist only the inspectable policy trace—not memory text or generated
// instructions. Evidence links allow user deletion to purge dependent traces.
export function attentionAuditPayload(decision: AttentionDecision) {
  const compact = (candidate: AttentionCandidate | null) =>
    candidate
      ? {
          id: candidate.id,
          sourceItemId: candidate.sourceItemId,
          kind: candidate.kind,
          class: candidate.class,
          action: candidate.action,
          cooldownKey: candidate.cooldownKey,
          threshold: candidate.threshold,
          score: candidate.score,
          relevance: candidate.relevance,
          evidenceEventIds: candidate.evidenceEventIds,
          relationshipEventIds: candidate.relationshipEventIds,
          factors: candidate.factors,
          gates: candidate.gates,
          eligible: candidate.eligible,
          blockedBy: candidate.blockedBy,
        }
      : null;
  return {
    contractVersion: decision.contractVersion,
    engineVersion: decision.engineVersion,
    mode: decision.mode,
    moment: decision.moment,
    candidates: decision.candidates.map(compact),
    required: decision.required.map(compact),
    selected: compact(decision.selected),
    surface: compact(decision.surface),
    proactiveAction: decision.proactiveAction,
    silenceReason: decision.silenceReason,
  };
}
