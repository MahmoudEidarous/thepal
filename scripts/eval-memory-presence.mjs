import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAttentionChoice,
  formatAttentionDecision,
} from "../lib/memory/attention-engine.ts";
import { createSessionHandoff } from "../lib/memory/continuity-kernel.ts";
import { CaptureEvidencePayloadSchema } from "../lib/memory/contracts.ts";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";
import {
  buildPresencePrompt,
  composePresencePlan,
  eligiblePresenceCandidates,
  formatPresenceDirective,
  storePreparedPresence,
  takePreparedPresence,
  validatePresenceDraft,
} from "../lib/memory/presence-planner.ts";

const AT = "2026-07-15T18:00:00.000Z";
let checks = 0;

function check(condition, label) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`✅  ${label}`);
}

function candidate(overrides) {
  return {
    id: "thread:vienna",
    sourceItemId: "vienna-thread",
    kind: "thread_follow_up",
    class: "proactive",
    action: "ask_thread_follow_up",
    text: "Vienna pricing is still unresolved",
    instruction: "Ask one specific question about whether pricing was settled.",
    whyNow: "the expected pricing discussion should have happened",
    cooldownKey: "vienna-cooldown",
    threshold: 48,
    score: 72,
    relevance: 0.8,
    sensitivity: "normal",
    confidence: "direct",
    evidenceEventIds: ["event-vienna"],
    relationshipEventIds: [],
    factors: {
      helpfulness: 15,
      urgency: 20,
      actionability: 16,
      relationalValue: 15,
      repairValue: 0,
      interruptionCost: 4,
      repetitionCost: 0,
      uncertaintyCost: 0,
      sensitivityRisk: 0,
      userLoad: 2,
    },
    gates: [],
    eligible: true,
    blockedBy: [],
    metadata: { title: "Vienna pricing", expectedNext: "pricing decision" },
    ...overrides,
  };
}

function decision(overrides = {}) {
  const thread = candidate({});
  const obligation = candidate({
    id: "obligation:invoice",
    sourceItemId: "invoice",
    kind: "obligation",
    action: "mention_obligation",
    text: "The Vienna invoice is due today",
    instruction: "Mention it briefly without coaching.",
    score: 66,
    cooldownKey: "invoice-cooldown",
  });
  const blocked = candidate({
    id: "anniversary:private",
    sourceItemId: "private",
    kind: "anniversary",
    action: "offer_returning_past",
    text: "A restricted anniversary",
    eligible: false,
    blockedBy: ["sensitivity"],
  });
  return {
    contractVersion: 1,
    engineVersion: "attention-v2",
    id: "decision-presence",
    mode: "active",
    decidedAt: AT,
    moment: {
      id: "decision-presence",
      kind: "session_start",
      sessionId: "presence-session",
      signals: {
        crisis: false,
        serious: false,
        goodbye: false,
        midThought: false,
        taskFocused: false,
        explicitInvitation: false,
        lull: true,
        cognitiveLoad: "low",
      },
    },
    candidates: [thread, obligation, blocked],
    required: [],
    selected: thread,
    surface: thread,
    proactiveAction: "speak",
    silenceReason: null,
    candidateLimit: 1,
    ...overrides,
  };
}

const relationship = {
  contractVersion: 1,
  engineVersion: "relationship-expression-v1",
  personaVersion: "recall-persona-v1",
  mode: "active",
  repairPriority: false,
  humor: {
    mode: "situational",
    artifactId: null,
    instruction: "Humor is optional and must be fresh.",
  },
  dialect: { directness: 1, teasing: 1 },
  boundaries: [],
  proceduralRules: [],
  instruction: "Warm, quick, candid, curious, and witty; never service theater.",
};

function handoff(opening = "Did Vienna pricing ever stop moving?") {
  return {
    id: "handoff-1",
    userId: "presence-user",
    space: "eval",
    sessionId: "old-session",
    startedAt: "2026-07-14T18:00:00.000Z",
    endedAt: "2026-07-14T18:10:00.000Z",
    meaningfulScore: 3,
    meaningful: true,
    summary: {
      turnCount: 4,
      userTurnCount: 2,
      topics: ["Vienna"],
      recentUserStatements: ["Pricing is still unresolved"],
      lastAgentStatement: "Tell me how it lands.",
      unresolvedConversation: null,
      meaningfulReasons: ["multiple user turns"],
      presence: {
        act: "resume_thread",
        plannedOpening: opening,
        spokenOpening: opening,
        candidateKind: "thread_follow_up",
        decisionId: "old-decision",
      },
    },
    evidenceEventIds: ["event-vienna"],
    relationshipEventIds: [],
    createdAt: "2026-07-14T18:10:00.000Z",
    updatedAt: "2026-07-14T18:10:00.000Z",
  };
}

const choices = eligiblePresenceCandidates(decision());
check(choices.length === 2, "only eligible proactive candidates reach model judgment");
check(!choices.some((item) => item.id === "anniversary:private"), "a blocked memory cannot enter the planner choice set");

const prompt = buildPresencePrompt({
  momentKind: "session_start",
  decision: decision(),
  relationship,
  handoffs: [handoff()],
  greetingName: "Mahmoud",
  at: AT,
});
check(prompt.prompt.includes("thread:vienna"), "the planner receives grounded eligible candidates");
check(prompt.prompt.includes("obligation:invoice"), "the planner can compare more than one safe possibility");
check(!prompt.prompt.includes("A restricted anniversary"), "blocked content is absent from the model prompt");
check(prompt.prompt.includes("Recent openings to avoid"), "recent presence acts become anti-repetition context");
check(prompt.prompt.includes("Did Vienna pricing ever stop moving?"), "the last opening is supplied only as an avoid example");
check(prompt.prompt.includes("name=Mahmoud"), "a known name may shape a natural greeting");
check(prompt.system.includes("choose no candidate"), "silence or a no-memory greeting remains an explicit model option");
check(prompt.system.includes("A statement, reaction"), "the planner is not forced to ask a question");

const planned = await composePresencePlan(
  {
    momentKind: "session_start",
    decision: decision(),
    relationship,
    handoffs: [],
    at: AT,
  },
  async () => ({
    act: "thoughtful_observation",
    candidateId: "thread:vienna",
    utterance: "Vienna pricing has acquired a suspicious number of plot twists.",
  }),
);
check(!planned.fallback, "a valid model plan is accepted");
check(planned.candidateId === "thread:vienna", "the accepted plan keeps its grounded candidate");
check(planned.candidateKind === "thread_follow_up", "candidate provenance survives planning");
check(planned.act === "thoughtful_observation", "continuity can be a statement instead of a question");
check(!planned.utterance.includes("memory"), "the spoken line never demonstrates memory machinery");

const quietStart = validatePresenceDraft({
  draft: { act: "simple_presence", candidateId: null, utterance: "Hey. You look like you arrived with a story." },
  momentKind: "session_start",
  decision: decision(),
  handoffs: [],
  at: AT,
});
check(quietStart?.act === "simple_presence", "the model may decline all memories at session start");
check(quietStart?.candidateId === null, "a simple greeting carries no hidden memory candidate");

const quietLull = validatePresenceDraft({
  draft: { act: "wait", candidateId: null, utterance: "" },
  momentKind: "lull",
  decision: decision({ moment: { ...decision().moment, kind: "lull" } }),
  handoffs: [],
  at: AT,
});
check(quietLull?.act === "wait", "a lull can deliberately remain silent");
check(quietLull?.utterance === "", "planned silence cannot smuggle in a spoken filler");
check(formatPresenceDirective(quietLull).includes("Call skip_turn"), "planned silence maps to ElevenLabs skip_turn");
check(formatPresenceDirective(planned).includes("second topic"), "a speaking plan forbids a second remembered topic");

const invalidCandidate = await composePresencePlan(
  { momentKind: "session_start", decision: decision(), relationship, handoffs: [], at: AT },
  async () => ({ act: "returning_past", candidateId: "anniversary:private", utterance: "Remember this private thing?" }),
);
check(invalidCandidate.fallback, "a model cannot rescue a policy-blocked candidate");
check(invalidCandidate.candidateId === null, "invalid model selection falls back without personal content");

const mismatchedAct = await composePresencePlan(
  { momentKind: "session_start", decision: decision(), relationship, handoffs: [], at: AT },
  async () => ({ act: "shared_callback", candidateId: "thread:vienna", utterance: "Vienna did the thing." }),
);
check(mismatchedAct.fallback, "an act incompatible with its candidate is rejected");

const mechanical = await composePresencePlan(
  { momentKind: "session_start", decision: decision(), relationship, handoffs: [], at: AT },
  async () => ({ act: "simple_presence", candidateId: null, utterance: "I searched your memories. What's new?" }),
);
check(mechanical.fallback, "memory theater and generic chatbot rituals are rejected");
check(mechanical.utterance === "Hey.", "invalid wording degrades to a minimal non-claiming greeting");

const repetitive = await composePresencePlan(
  { momentKind: "session_start", decision: decision(), relationship, handoffs: [handoff()], at: AT },
  async () => ({ act: "resume_thread", candidateId: "thread:vienna", utterance: "Did Vienna pricing ever stop moving?" }),
);
check(repetitive.fallback, "a near-duplicate recent opener is rejected");

const tooLong = await composePresencePlan(
  { momentKind: "session_start", decision: decision(), relationship, handoffs: [], at: AT },
  async () => ({ act: "simple_presence", candidateId: null, utterance: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree" }),
);
check(tooLong.fallback, "spoken openings stay inside the short voice budget");

const selected = applyAttentionChoice(decision(), "obligation:invoice");
check(selected.surface?.id === "obligation:invoice", "model choice may reorder only already-eligible candidates");
check(selected.proactiveAction === "speak", "a valid chosen candidate authorizes one aside");
const refused = applyAttentionChoice(decision(), "anniversary:private");
check(refused.surface === null, "blocked model choices become silence");
check(refused.proactiveAction === "stay_silent", "policy failure cannot become a proactive action");
const declined = applyAttentionChoice(decision(), null);
check(declined.surface === null, "the planner may decline an otherwise eligible top candidate");
check(formatAttentionDecision(declined).includes("PROACTIVE SILENCE"), "planner silence remains legible to the agent policy layer");

const repairCandidate = candidate({
  id: "repair:one",
  sourceItemId: "rupture",
  kind: "repair",
  class: "required",
  action: "repair_relationship",
  instruction: "Own the incorrect date and correct it.",
});
const repairDecision = decision({ required: [repairCandidate] });
check(applyAttentionChoice(repairDecision, "thread:vienna").surface === null, "relationship repair suppresses every proactive memory");
const repairPlan = await composePresencePlan(
  { momentKind: "session_start", decision: repairDecision, relationship, handoffs: [], at: AT },
  async () => ({ act: "repair", candidateId: null, utterance: "I had that date wrong. That was mine—it's the twenty-fourth." }),
);
check(repairPlan.act === "repair" && !repairPlan.fallback, "a concise model-written repair may lead the next session");
const badRepair = await composePresencePlan(
  { momentKind: "session_start", decision: repairDecision, relationship, handoffs: [], at: AT },
  async () => ({ act: "simple_presence", candidateId: null, utterance: "Hey." }),
);
check(badRepair.fallback && badRepair.act === "repair", "a model cannot charm past an unresolved rupture");

const cached = storePreparedPresence({
  userId: "presence-user",
  space: "eval",
  sessionId: "cached-session",
  plan: planned,
});
check(!!takePreparedPresence(cached.planId), "a prepared opening can be consumed without another LLM call");
check(takePreparedPresence(cached.planId) === null, "prepared openings are one-shot and cannot leak into another session");

const directory = mkdtempSync(join(tmpdir(), "recall-presence-"));
const ledger = new MemoryEventLedger({ databasePath: join(directory, "memory.sqlite") });
try {
  const event = ledger.appendEvent({
    userId: "presence-user",
    space: "eval",
    kind: "utterance",
    payload: CaptureEvidencePayloadSchema.parse({
      content: "Vienna pricing is still unresolved.",
      redacted: false,
      legacySource: "presence-fixture",
      requested: { kind: "memory", due: null },
    }),
    source: { actor: "user", channel: "text", trust: "user_direct", label: "presence-fixture" },
    sensitivity: "normal",
    idempotencyKey: "presence:event",
    recordedAt: "2026-07-15T17:01:00.000Z",
  }).event;
  ledger.recordAttentionDecision({
    id: "presence-decision-linked",
    userId: "presence-user",
    space: "eval",
    sessionId: "presence-linked-session",
    engineVersion: "attention-v2",
    mode: "active",
    momentKind: "session_start",
    selectedCandidateId: "thread:vienna",
    selectedKind: "thread_follow_up",
    selectedAction: "ask_thread_follow_up",
    selectedScore: 72,
    cooldownKey: "vienna-cooldown",
    shouldSurface: true,
    silenceReason: null,
    decision: {},
    evidenceEventIds: [event.id],
    createdAt: AT,
  });
  const stored = createSessionHandoff({
    ledger,
    userId: "presence-user",
    space: "eval",
    sessionId: "presence-linked-session",
    startedAt: "2026-07-15T17:00:00.000Z",
    endedAt: "2026-07-15T17:10:00.000Z",
    lines: [
      { role: "agent", text: "Vienna pricing has acquired a suspicious number of plot twists." },
      { role: "user", text: "It really has. We finally settled it today." },
    ],
    presence: {
      act: "thoughtful_observation",
      plannedOpening: planned.utterance,
      spokenOpening: null,
      candidateKind: "thread_follow_up",
      decisionId: "presence-decision-linked",
    },
  });
  check(stored.summary.presence?.act === "thoughtful_observation", "the handoff remembers which continuity act was used");
  check(stored.summary.presence?.spokenOpening?.includes("plot twists"), "the handoff records the line actually spoken");
  check(stored.summary.presence?.decisionId === "presence-decision-linked", "the opening remains linked to its auditable attention decision");
  check(stored.evidenceEventIds.includes(event.id), "opening provenance joins the session handoff evidence graph");
  check(ledger.stats().integrity === "ok", "presence history preserves SQLite integrity");
} finally {
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
}

console.log(`\n${checks} memory-presence checks passed`);
