// Phase 7 deterministic replay: attention policy, guarded rollout, durable
// cooldowns, and deletion-aware audit traces. No dev server or model needed.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attentionAuditPayload,
  attentionMode,
  decideAttention,
  formatAttentionDecision,
} from "../lib/memory/attention-engine.ts";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";

const AT = "2026-07-14T12:00:00.000Z";
const directory = mkdtempSync(join(tmpdir(), "recall-memory-attention-"));
const databasePath = join(directory, "memory.sqlite");
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
  console.log(`✅  ${message}`);
};

function item(overrides = {}) {
  return {
    id: "item",
    source: "belief",
    priority: "P3",
    text: "memory item",
    whyIncluded: "relevant to the current turn",
    allowedUse: "assert",
    confidence: "direct",
    sensitivity: "normal",
    validTime: null,
    evidenceEventIds: [],
    score: 100,
    metadata: {},
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    contractVersion: 1,
    compilerVersion: "context-v2",
    compiledAt: AT,
    space: "eval",
    working: { query: "", recentTurns: [], selectedMemory: null },
    safety: [],
    obligations: [],
    activeThreads: [],
    continuityViews: [],
    currentBeliefs: [],
    historicalEvidence: [],
    prospective: [],
    uncertainty: [],
    budget: {
      maxTokens: 1600,
      usedTokens: 10,
      omittedItems: 0,
      overBudgetForRequiredContext: false,
    },
    degradedSources: [],
    agentText: "context",
    ...overrides,
  };
}

function moment(overrides = {}) {
  return {
    id: "decision-1",
    userId: "fixture-user",
    space: "eval",
    sessionId: "session-1",
    kind: "user_turn",
    query: "Vienna came up again",
    recentTurns: [],
    at: AT,
    ...overrides,
  };
}

function prospective(match = "exact", overrides = {}) {
  return item({
    id: "prospective-vienna",
    source: "prospective",
    priority: "P2",
    text: "When Vienna returned, the user asked Recall to: mention pricing",
    confidence: "direct",
    metadata: {
      match,
      matchScore: match === "exact" ? 1 : 0.8,
      topic: "Vienna",
      firePolicy: "once",
    },
    ...overrides,
  });
}

function decide({ mode = "guarded", ctx = context(), now = moment(), supplement = {}, history = [] } = {}) {
  return decideAttention({ mode, context: ctx, moment: now, supplement, history });
}

let ledger = new MemoryEventLedger({ databasePath });
try {
  check(ledger.stats().schemaVersion === 7, "schema migration 7 preserves the attention audit store");
  check(attentionMode(undefined) === "guarded", "attention defaults to the narrow guarded rollout");
  check(attentionMode("shadow") === "shadow", "shadow rollout is selectable");
  check(attentionMode("active") === "active", "active rollout is selectable");
  check(attentionMode("invalid") === "guarded", "invalid rollout configuration fails closed to guarded");

  const exact = decide({ ctx: context({ prospective: [prospective()] }) });
  check(exact.selected?.kind === "prospective", "exact prospective match wins policy selection");
  check(exact.surface?.sourceItemId === "prospective-vienna", "guarded rollout surfaces an exact prospective trigger");
  check(exact.proactiveAction === "speak", "authorized exact trigger produces one proactive action");
  check(exact.candidateLimit === 1, "the policy contract caps proactive output at one aside");
  check(exact.surface?.instruction.includes("manage_prospective_memory"), "prospective delivery requires lifecycle fire before speech");

  const fuzzyGuarded = decide({ ctx: context({ prospective: [prospective("fuzzy")] }) });
  check(fuzzyGuarded.selected?.kind === "prospective", "a strong fuzzy match remains visible to shadow evaluation");
  check(fuzzyGuarded.surface === null, "guarded rollout never surfaces a fuzzy prospective match");
  check(fuzzyGuarded.silenceReason?.includes("guarded"), "guarded suppression explains why silence won");
  const fuzzyActive = decide({ mode: "active", ctx: context({ prospective: [prospective("fuzzy")] }) });
  check(fuzzyActive.surface?.kind === "prospective", "active mode can surface a high-scoring guarded fuzzy match");

  const shadow = decide({ mode: "shadow", ctx: context({ prospective: [prospective()] }) });
  check(shadow.selected?.kind === "prospective", "shadow mode still records the policy winner");
  check(shadow.surface === null && shadow.proactiveAction === "stay_silent", "shadow mode never surfaces the winner");

  const overdueItem = item({
    id: "deck",
    source: "commitment",
    priority: "P2",
    text: "Send the Vienna pricing deck",
    metadata: { due: "2026-07-13", overdue: true },
  });
  const overdue = decide({
    mode: "active",
    ctx: context({ obligations: [overdueItem] }),
    now: moment({ kind: "session_start", query: "" }),
  });
  check(overdue.surface?.kind === "obligation", "an overdue obligation may surface at an interruptible session start");
  check(overdue.surface?.factors.urgency === 26, "overdue status produces an inspectable urgency contribution");

  const unrelatedTask = decide({
    mode: "active",
    ctx: context({ obligations: [overdueItem] }),
    now: moment({ query: "debug this TypeScript build" }),
  });
  check(unrelatedTask.surface === null, "an unrelated focused task suppresses an obligation aside");
  check(
    unrelatedTask.candidates[0].blockedBy.includes("interruptibility"),
    "task suppression is recorded as an interruptibility gate",
  );

  const serious = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ query: "Vienna came up while I was at the hospital after a panic attack" }),
  });
  check(serious.surface === null, "a serious moment suppresses even an exact prospective aside");
  const crisis = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ query: "Vienna, but I am in immediate danger right now" }),
  });
  check(crisis.surface === null && crisis.moment.signals.crisis, "crisis detection fails proactive memory closed");
  const midThought = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ query: "Vienna and then—" }),
  });
  check(midThought.surface === null && midThought.moment.signals.midThought, "an unfinished turn is not interrupted");
  const focusMode = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ focusMode: true }),
  });
  check(focusMode.surface === null, "explicit focus mode suppresses proactive memory");
  const silence = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ explicitSilence: true }),
  });
  check(silence.surface === null, "explicit silence preference suppresses proactive memory");
  const goodbye = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ query: "Vienna — anyway, gotta go" }),
  });
  check(goodbye.surface === null && goodbye.moment.signals.goodbye, "goodbye turns cannot acquire a memory aside");
  const notNow = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ query: "Vienna, but not now" }),
  });
  check(notNow.surface === null, "a prospective dismissal is handled as lifecycle intent, never delivery");
  const listForward = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ query: "what reminders are waiting about Vienna?" }),
  });
  check(listForward.surface === null, "asking to inspect forward memories cannot accidentally consume one");

  const restricted = decide({
    mode: "active",
    ctx: context({ prospective: [prospective("exact", { sensitivity: "restricted" })] }),
  });
  check(restricted.surface === null, "restricted memory never becomes a proactive aside");
  const sensitiveFuzzy = decide({
    mode: "active",
    ctx: context({ prospective: [prospective("fuzzy", { sensitivity: "sensitive" })] }),
  });
  check(sensitiveFuzzy.surface === null, "sensitive fuzzy evidence fails the sensitivity gate");
  const sensitiveExact = decide({
    mode: "active",
    ctx: context({ prospective: [prospective("exact", { sensitivity: "sensitive" })] }),
  });
  check(sensitiveExact.surface?.kind === "prospective", "a direct exact prospective request may carry its own sensitive topic");

  const bounded = decide({
    mode: "active",
    ctx: context({
      safety: [item({ source: "pin", priority: "P0", text: "Never mention Vienna pricing", allowedUse: "silent" })],
      prospective: [prospective()],
    }),
  });
  check(bounded.surface === null, "an explicit pinned topic boundary blocks a matching aside");
  check(bounded.candidates[0].blockedBy.includes("boundary"), "boundary suppression is inspectable in the trace");

  const anniversary = {
    text: "You were pitching the investor with Spotify still playing",
    when: "a year ago today",
    storyDate: "2025-07-14",
    trust: "user_direct",
    sensitivity: "normal",
    evidenceEventIds: [],
  };
  const returning = decide({
    mode: "active",
    now: moment({ kind: "session_start", query: "" }),
    supplement: { anniversaries: [anniversary] },
  });
  check(returning.surface?.kind === "anniversary", "a grounded returning memory can surface in an open session-start moment");
  const poisonedPast = decide({
    mode: "active",
    now: moment({ kind: "session_start", query: "" }),
    supplement: { anniversaries: [{ ...anniversary, trust: "external_content" }] },
  });
  check(poisonedPast.surface === null, "external content cannot become a proactive anniversary");
  check(poisonedPast.candidates[0].blockedBy.includes("source_grounding"), "poisoned returning past fails the grounding gate");
  const heavyPast = decide({
    mode: "active",
    now: moment({ kind: "session_start", query: "" }),
    supplement: { anniversaries: [{ ...anniversary, sensitivity: "sensitive" }] },
  });
  check(heavyPast.surface === null, "sensitive anniversaries stay quiet without a narrower consent design");

  const reviewedThread = item({
    id: "thread-layla",
    source: "thread",
    text: "Layla interview: waiting for the result",
    metadata: {
      title: "Layla interview",
      status: "waiting",
      nextReviewAt: "2026-07-13T12:00:00.000Z",
      expectedBy: "2026-07-13",
      expectedNext: "interview result",
    },
  });
  const followUp = decide({
    mode: "active",
    ctx: context({ activeThreads: [reviewedThread] }),
    now: moment({ kind: "session_start", query: "" }),
  });
  check(followUp.surface?.kind === "thread_follow_up", "a due grounded life-thread review can become one specific follow-up");
  check(followUp.surface?.instruction.includes("interview result"), "thread follow-up names the grounded expected development");
  const tentativeThread = decide({
    mode: "active",
    ctx: context({ activeThreads: [{ ...reviewedThread, confidence: "tentative" }] }),
    now: moment({ kind: "session_start", query: "" }),
  });
  check(tentativeThread.surface === null, "a tentative inferred thread cannot proactively question the user");

  const uncertain = decide({
    mode: "shadow",
    ctx: context({
      uncertainty: [item({ id: "vienna-date", source: "uncertainty", text: "Vienna call date is either July 24 or July 27", confidence: "conflicting", allowedUse: "ask" })],
    }),
    now: moment({ query: "when is the Vienna call?" }),
  });
  check(uncertain.required[0]?.kind === "uncertainty", "relevant conflict becomes a required response constraint");
  check(uncertain.surface === null, "truth constraints do not consume the proactive-aside slot");
  check(
    formatAttentionDecision(uncertain).includes("REQUIRED RESPONSE CONSTRAINTS"),
    "the agent packet makes required uncertainty behavior explicit",
  );

  const change = {
    id: "event-new",
    currentText: "The Vienna call moved to July 24",
    previousText: "The Vienna call was on July 27",
    recordedAt: "2026-07-14T09:00:00.000Z",
    trust: "user_direct",
    sensitivity: "normal",
    evidenceEventIds: [],
  };
  const changed = decide({ supplement: { changes: [change] }, now: moment({ query: "what day is the Vienna call?" }) });
  check(changed.required[0]?.kind === "truth_change", "a relevant supersession becomes a current-truth response constraint");
  const irrelevantChange = decide({ supplement: { changes: [change] }, now: moment({ query: "tell me about Layla" }) });
  check(!irrelevantChange.required.length, "an unrelated historical change stays out of the response");

  const repair = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    now: moment({ repair: { reason: "Recall stated the wrong date", instruction: "Own the wrong date, correct it, and apologize once." } }),
  });
  check(repair.required[0]?.kind === "repair", "an unresolved Recall mistake creates a required repair action");
  check(repair.surface === null, "relationship repair suppresses charm and proactive memory");
  check(
    repair.candidates.find((candidate) => candidate.kind === "prospective")?.blockedBy.includes("repair_priority"),
    "suppressed charm records repair priority as the reason",
  );

  const history = [{
    candidateId: exact.surface.id,
    cooldownKey: exact.surface.cooldownKey,
    kind: "prospective",
    surfacedAt: "2026-07-14T11:30:00.000Z",
  }];
  const cooled = decide({ mode: "active", ctx: context({ prospective: [prospective()] }), history });
  check(cooled.surface === null, "a recently surfaced candidate cannot nag again");
  const cooledCandidate = cooled.candidates.find((candidate) => candidate.kind === "prospective");
  check(cooledCandidate?.blockedBy.includes("cooldown"), "cooldown failure is explicit");
  check(cooledCandidate?.factors.repetitionCost === 30, "recent repetition pays a visible utility cost");
  const expiredCooldown = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()] }),
    history: [{ ...history[0], surfacedAt: "2026-07-13T20:00:00.000Z" }],
  });
  check(expiredCooldown.surface?.kind === "prospective", "a candidate may return after its deterministic cooldown expires");

  const oneAside = decide({
    mode: "active",
    ctx: context({ prospective: [prospective()], obligations: [overdueItem], activeThreads: [reviewedThread] }),
  });
  check(oneAside.surface?.kind === "prospective", "the strongest safe candidate wins across memory layers");
  check(oneAside.candidates.filter((candidate) => candidate.eligible && candidate.class === "proactive").length > 1, "other eligible candidates remain visible for shadow evaluation");
  check(oneAside.surface !== null && oneAside.candidateLimit === 1, "only one eligible proactive candidate is authorized");
  const score = oneAside.surface.factors;
  const recomputed = score.helpfulness + score.urgency + score.actionability + score.relationalValue + score.repairValue - score.interruptionCost - score.repetitionCost - score.uncertaintyCost - score.sensitivityRisk - score.userLoad + (score.learnedValue ?? 0);
  check(recomputed === oneAside.surface.score, "utility score exactly equals its positive value minus explicit costs");

  const empty = decide({ now: moment({ query: "hello" }) });
  check(empty.proactiveAction === "stay_silent" && empty.silenceReason?.includes("no proactive"), "no candidate produces explicit, explained silence");
  const formatted = formatAttentionDecision(empty);
  check(formatted.includes("PROACTIVE SILENCE"), "silence is compiled into an unambiguous agent policy packet");
  check(formatted.includes("Answer the user's present turn naturally"), "proactive silence is distinct from conversational dead air");
  const repeat = decide({ ctx: context({ prospective: [prospective()] }) });
  check(JSON.stringify(attentionAuditPayload(exact)) === JSON.stringify(attentionAuditPayload(repeat)), "identical inputs produce the same inspectable policy trace apart from no hidden randomness");
  check(!JSON.stringify(attentionAuditPayload(exact)).includes("mention pricing"), "durable audit payload excludes memory text and instructions");

  const evidence = ledger.appendEvent({
    userId: "fixture-user",
    space: "eval",
    kind: "utterance",
    payload: {
      content: "The Vienna call moved to July 24",
      redacted: false,
      legacySource: "attention-fixture",
      requested: { kind: "memory", due: null },
    },
    source: { actor: "user", channel: "text", trust: "user_direct", label: "attention-fixture" },
    sensitivity: "normal",
    idempotencyKey: "attention-evidence",
    recordedAt: "2026-07-14T09:00:00.000Z",
  }).event;
  const persistedDecision = decide({
    mode: "active",
    supplement: { changes: [{ ...change, id: evidence.id, evidenceEventIds: [evidence.id] }] },
    now: moment({ id: "decision-persisted", query: "what day is the Vienna call?" }),
  });
  ledger.recordAttentionDecision({
    id: persistedDecision.id,
    userId: "fixture-user",
    space: "eval",
    sessionId: persistedDecision.moment.sessionId,
    engineVersion: persistedDecision.engineVersion,
    mode: persistedDecision.mode,
    momentKind: persistedDecision.moment.kind,
    selectedCandidateId: persistedDecision.selected?.id ?? null,
    selectedKind: persistedDecision.selected?.kind ?? null,
    selectedAction: persistedDecision.selected?.action ?? null,
    selectedScore: persistedDecision.selected?.score ?? null,
    cooldownKey: persistedDecision.selected?.cooldownKey ?? null,
    shouldSurface: !!persistedDecision.surface,
    silenceReason: persistedDecision.silenceReason,
    decision: attentionAuditPayload(persistedDecision),
    evidenceEventIds: [evidence.id],
    createdAt: persistedDecision.decidedAt,
  });
  const records = ledger.listAttentionDecisions({ userId: "fixture-user", space: "eval" });
  check(records.length === 1, "attention decision is durably recorded in SQLite");
  check(records[0].evidenceEventIds.includes(evidence.id), "audit trace keeps a provenance link to canonical evidence");
  check(!JSON.stringify(records[0].decision).includes("Vienna call moved"), "persisted trace contains no copied memory content");
  check(ledger.stats().attentionDecisions === 1, "foundation stats expose attention audit health");
  const preview = ledger.createDeletionPreview(evidence.id, { now: "2026-07-14T12:00:00.000Z" });
  check(preview.affectedAttention === 1, "deletion preview reports dependent attention traces");
  ledger.tombstoneWithConsent(preview.token, "2026-07-14T12:05:00.000Z");
  check(ledger.stats().attentionDecisions === 0, "user deletion purges dependent attention traces transactionally");

  check(ledger.stats().integrity === "ok", "SQLite integrity remains clean after attention replay and deletion");

  console.log(`\n${checks} memory-attention checks passed`);
} finally {
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
}
