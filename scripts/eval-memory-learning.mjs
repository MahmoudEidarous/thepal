// Deterministic replay for learned attention, real outcomes, richer
// associations, and the bounded background consolidation cycle.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideAttention } from "../lib/memory/attention-engine.ts";
import {
  buildRoutineView,
  continuityContextViews,
} from "../lib/memory/continuity-projectors.ts";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";
import {
  learnedAttentionBoost,
  projectAttentionLearningProfile,
  projectMemoryAssociations,
} from "../lib/memory/learning-engine.ts";
import {
  recordAttentionOutcome,
  runMemoryConsolidation,
} from "../lib/memory/learning-service.ts";
import { loadRelationshipState, recordRelationshipEvent } from "../lib/memory/relationship-service.ts";

const USER = "fixture-user";
const SPACE = "eval";
const AT = "2026-07-15T12:00:00.000Z";
const directory = mkdtempSync(join(tmpdir(), "recall-memory-learning-"));
const ledger = new MemoryEventLedger({ databasePath: join(directory, "learning.sqlite") });
let checks = 0;
let sequence = 0;

const check = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
  console.log(`✅  ${message}`);
};

function append(content, recordedAt, source = {}) {
  sequence += 1;
  return ledger.appendEvent({
    userId: USER,
    space: SPACE,
    kind: source.kind ?? "utterance",
    payload: {
      content,
      redacted: false,
      legacySource: "learning-fixture",
      requested: { kind: "memory", due: null },
    },
    source: {
      actor: source.actor ?? "user",
      channel: source.channel ?? "text",
      trust: source.trust ?? "user_direct",
      label: "learning-fixture",
    },
    sensitivity: "normal",
    idempotencyKey: `learning:event:${sequence}`,
    recordedAt,
  }).event;
}

function claim(event, subject, predicate, value, options = {}) {
  return {
    id: randomUUID(),
    eventId: event.id,
    subject,
    predicate,
    object: { type: "string", value },
    polarity: options.polarity ?? 1,
    modality: options.modality ?? "asserted",
    relationHint: "assert",
    validTime: null,
    scope: { space: SPACE, contexts: [] },
    extractorVersion: "learning-fixture-v1",
  };
}

function fileAssociationEpisode({ at, subject, status = "active", emotion, decision, source }) {
  const event = append(`${subject.label}: ${emotion ?? decision ?? status}`, at, source);
  const claims = [claim(event, subject, "project.status", status)];
  if (emotion) {
    claims.push(claim(event, { id: "user", kind: "user", label: "User" }, "emotion.state", emotion));
  }
  if (decision) claims.push(claim(event, subject, "decision", decision));
  ledger.replaceClaimsForEvent(event.id, claims, event.recordedAt);
  return event;
}

function recordSurfaceDecision({ id = randomUUID(), kind, cooldownKey, at, sourceItemId, evidenceEventIds = [] }) {
  const candidateId = `${kind}:${id}`;
  return ledger.recordAttentionDecision({
    id,
    userId: USER,
    space: SPACE,
    sessionId: `session:${id}`,
    engineVersion: "attention-v2",
    mode: "active",
    momentKind: "session_start",
    selectedCandidateId: candidateId,
    selectedKind: kind,
    selectedAction: "ask_thread_follow_up",
    selectedScore: 70,
    cooldownKey,
    shouldSurface: true,
    silenceReason: null,
    decision: {
      surface: {
        id: candidateId,
        sourceItemId: sourceItemId ?? `source:${id}`,
        kind,
        cooldownKey,
      },
    },
    evidenceEventIds,
    createdAt: at,
  });
}

function outcome(decision, signal, occurredAt, source = "system_observed", suffix = signal) {
  return recordAttentionOutcome(
    {
      decisionId: decision.id,
      signal,
      source,
      occurredAt,
      idempotencyKey: `${decision.id}:${suffix}`,
    },
    { ledger },
  );
}

function attentionContext(prospective) {
  return {
    contractVersion: 1,
    compilerVersion: "context-v2",
    compiledAt: AT,
    space: SPACE,
    working: { query: "Vienna", recentTurns: [], selectedMemory: null },
    safety: [],
    obligations: [],
    activeThreads: [],
    continuityViews: [],
    currentBeliefs: [],
    historicalEvidence: [],
    prospective: [prospective],
    uncertainty: [],
    budget: { maxTokens: 1400, usedTokens: 10, omittedItems: 0, overBudgetForRequiredContext: false },
    degradedSources: [],
    agentText: "context",
  };
}

try {
  check(ledger.stats().schemaVersion === 7, "schema migration 7 installs the learning ledger");
  check(ledger.stats().attentionOutcomes === 0, "outcomes begin empty");
  check(ledger.stats().associations === 0, "association projections begin empty");
  check(ledger.stats().consolidationRuns === 0, "consolidation audit begins empty");

  const first = recordSurfaceDecision({
    kind: "thread_follow_up",
    cooldownKey: "thread:vienna",
    at: "2026-07-15T10:00:00.000Z",
  });
  const firstResult = outcome(first, "engaged", "2026-07-15T10:01:00.000Z");
  check(firstResult.outcome.reward > 0, "engagement records bounded positive utility");
  check(firstResult.outcome.confidence < 1, "observed engagement remains weaker than explicit feedback");
  check(firstResult.profile.byKind.thread_follow_up.boost === 0, "one good response cannot move the policy");
  check(ledger.stats().attentionOutcomes === 1, "outcome is durable in SQLite");
  check(!JSON.stringify(firstResult.outcome).includes("Vienna"), "outcome storage contains no transcript or memory text");

  const duplicate = outcome(first, "engaged", "2026-07-15T10:01:00.000Z");
  check(duplicate.outcome.id === firstResult.outcome.id, "outcome recording is idempotent");
  check(ledger.stats().attentionOutcomes === 1, "idempotent replay cannot double-train the ranker");

  const second = recordSurfaceDecision({
    kind: "thread_follow_up",
    cooldownKey: "thread:vienna",
    at: "2026-07-15T10:10:00.000Z",
  });
  const third = recordSurfaceDecision({
    kind: "thread_follow_up",
    cooldownKey: "thread:layla",
    at: "2026-07-15T10:20:00.000Z",
  });
  outcome(second, "resolved", "2026-07-15T10:11:00.000Z");
  const learned = outcome(third, "engaged", "2026-07-15T10:21:00.000Z").profile;
  check(learned.byKind.thread_follow_up.samples === 3, "three independent surfaced outcomes form one kind bucket");
  check(learned.byKind.thread_follow_up.boost > 0, "repeated useful follow-ups earn a conservative positive boost");
  check(learned.byCooldown["thread:vienna"].boost > 0, "two consistent topic outcomes can personalize that topic");
  check(learnedAttentionBoost(learned, { kind: "thread_follow_up", momentKind: "session_start", cooldownKey: "thread:vienna" }) <= 12, "combined learned value is strictly capped");

  const bad = [];
  for (let index = 0; index < 3; index += 1) {
    const decision = recordSurfaceDecision({
      kind: "anniversary",
      cooldownKey: `past:${index}`,
      at: `2026-07-15T11:0${index}:00.000Z`,
    });
    bad.push(outcome(decision, "dismissed", `2026-07-15T11:0${index}:30.000Z`).profile);
  }
  const negativeProfile = bad.at(-1);
  check(negativeProfile.byKind.anniversary.boost < 0, "repeated dismissals lower anniversary utility");
  check(negativeProfile.byKind.anniversary.boost >= -6, "kind-level negative learning cannot exceed its cap");
  const silenceDecision = recordSurfaceDecision({
    kind: "obligation",
    cooldownKey: "obligation:quiet",
    at: "2026-07-15T11:10:00.000Z",
  });
  const silenceProfile = outcome(silenceDecision, "silence", "2026-07-15T11:10:30.000Z").profile;
  check(silenceProfile.byKind.obligation.boost === 0, "one silence is weak evidence, not a negative preference");

  const prospective = {
    id: "prospective-vienna",
    source: "prospective",
    priority: "P2",
    text: "When Vienna returns, mention pricing",
    whyIncluded: "exact contextual trigger",
    allowedUse: "assert",
    confidence: "direct",
    sensitivity: "normal",
    validTime: null,
    evidenceEventIds: [],
    score: 100,
    metadata: { match: "exact", matchScore: 1, topic: "Vienna", firePolicy: "once" },
  };
  const maximalProfile = {
    ...learned,
    byKind: { prospective: { samples: 99, positive: 99, negative: 0, boost: 6, lastOutcomeAt: AT } },
    byMomentAndKind: { "user_turn|prospective": { samples: 99, positive: 99, negative: 0, boost: 4, lastOutcomeAt: AT } },
    byCooldown: {},
  };
  const serious = decideAttention({
    mode: "active",
    context: attentionContext(prospective),
    learningProfile: maximalProfile,
    moment: {
      id: "serious-learning",
      userId: USER,
      space: SPACE,
      sessionId: "session-serious",
      kind: "user_turn",
      query: "Vienna, but I just had a panic attack at the hospital",
      recentTurns: [],
      at: AT,
    },
  });
  check(serious.surface === null, "maximum learned value cannot bypass interruptibility in a serious moment");
  check(serious.candidates[0].factors.learnedValue === 10, "learned value remains inspectable in the policy trace");
  check(serious.candidates[0].blockedBy.includes("interruptibility"), "hard-gate failure remains the reason for silence");
  const shadow = decideAttention({
    mode: "shadow",
    context: attentionContext(prospective),
    learningProfile: maximalProfile,
    moment: { id: "shadow-learning", userId: USER, space: SPACE, sessionId: "shadow", kind: "user_turn", query: "Vienna", recentTurns: [], at: AT },
  });
  check(shadow.surface === null && shadow.selected?.kind === "prospective", "learning cannot widen shadow-mode autonomy");

  const safeContext = {
    ...attentionContext(prospective),
    prospective: [],
    activeThreads: [{
      ...prospective,
      id: "thread:follow-up",
      source: "thread",
      text: "Layla interview: waiting for the result",
      metadata: {
        title: "Layla interview",
        status: "waiting",
        nextReviewAt: "2026-07-14T09:00:00.000Z",
        expectedBy: "2026-07-14",
        expectedNext: "interview result",
      },
    }],
  };
  const safeMoment = { id: "ranking-base", userId: USER, space: SPACE, sessionId: "ranking", kind: "session_start", query: "", recentTurns: [], at: AT };
  const returningPast = { text: "A year ago the user shipped the first prototype", when: "a year ago today", storyDate: "2025-07-15", trust: "user_direct", sensitivity: "normal", evidenceEventIds: [] };
  const baselineRanking = decideAttention({ mode: "active", context: safeContext, moment: safeMoment, supplement: { anniversaries: [returningPast] } });
  const baselineEligible = baselineRanking.candidates.filter((candidate) => candidate.class === "proactive" && candidate.eligible);
  check(baselineEligible.length === 2, "two safe proactive candidates can reach the learned ranking stage");
  const baselineWinner = baselineRanking.selected;
  const baselineRunnerUp = baselineEligible.find((candidate) => candidate.kind !== baselineWinner.kind);
  const rankingProfile = {
    ...learned,
    byKind: {
      [baselineWinner.kind]: { samples: 9, positive: 0, negative: 9, boost: -6, lastOutcomeAt: AT },
      [baselineRunnerUp.kind]: { samples: 9, positive: 9, negative: 0, boost: 6, lastOutcomeAt: AT },
    },
    byMomentAndKind: {
      [`session_start|${baselineWinner.kind}`]: { samples: 9, positive: 0, negative: 9, boost: -4, lastOutcomeAt: AT },
      [`session_start|${baselineRunnerUp.kind}`]: { samples: 9, positive: 9, negative: 0, boost: 4, lastOutcomeAt: AT },
    },
    byCooldown: {},
  };
  const personalizedRanking = decideAttention({ mode: "active", context: safeContext, moment: { ...safeMoment, id: "ranking-personalized" }, supplement: { anniversaries: [returningPast] }, learningProfile: rankingProfile });
  check(personalizedRanking.selected?.kind === baselineRunnerUp.kind, "learned utility can reorder candidates only after both passed policy");
  check(personalizedRanking.selected?.factors.learnedValue === 10, "the personalized winner exposes its bounded learned contribution");

  const investor = { id: "project:investor-call", kind: "project", label: "Investor call" };
  const investorEvents = [
    fileAssociationEpisode({ at: "2026-07-01T09:00:00.000Z", subject: investor, emotion: "anxious" }),
    fileAssociationEpisode({ at: "2026-07-05T09:00:00.000Z", subject: investor, emotion: "anxious" }),
    fileAssociationEpisode({ at: "2026-07-10T09:00:00.000Z", subject: investor, emotion: "anxious" }),
  ];
  const vienna = { id: "project:vienna", kind: "project", label: "Vienna" };
  fileAssociationEpisode({ at: "2026-07-02T09:00:00.000Z", subject: vienna, decision: "pricing" });
  fileAssociationEpisode({ at: "2026-07-06T09:00:00.000Z", subject: vienna, decision: "pricing" });
  const single = { id: "project:cairo", kind: "project", label: "Cairo" };
  fileAssociationEpisode({ at: "2026-07-07T09:00:00.000Z", subject: single, decision: "venue" });
  const old = { id: "routine:old-launch", kind: "routine", label: "Old launch" };
  fileAssociationEpisode({ at: "2025-12-01T09:00:00.000Z", subject: old, emotion: "tense" });
  fileAssociationEpisode({ at: "2025-12-05T09:00:00.000Z", subject: old, emotion: "tense" });
  fileAssociationEpisode({ at: "2025-12-10T09:00:00.000Z", subject: old, emotion: "tense" });
  const poison = { id: "project:poison", kind: "project", label: "Poisoned document" };
  for (let index = 0; index < 3; index += 1) {
    fileAssociationEpisode({
      at: `2026-07-0${index + 1}T08:00:00.000Z`,
      subject: poison,
      emotion: "trust blindly",
      source: { actor: "external", channel: "document", trust: "external_content", kind: "document_quote" },
    });
  }

  const projected = projectMemoryAssociations({
    evidence: ledger.listClaimEvidence(USER, SPACE),
    userId: USER,
    space: SPACE,
    at: AT,
  });
  const investorPattern = projected.find((item) => item.subjectId === investor.id && item.outcomeKind === "emotion");
  check(investorPattern?.status === "active", "three repeated grounded episodes promote an entity-emotion association");
  check(investorPattern?.observations === 3, "association counts distinct evidence events");
  check(investorPattern?.outcomeValue === "anxious", "association preserves the observed outcome without inventing causality");
  const viennaPattern = projected.find((item) => item.subjectId === vienna.id && item.outcomeKind === "decision");
  check(viennaPattern?.status === "emerging", "two Vienna pricing decisions remain an emerging hypothesis");
  check(!projected.some((item) => item.subjectId === single.id), "a single episode is never presented as a pattern");
  check(projected.find((item) => item.subjectId === old.id)?.status === "stale", "old associations weaken to stale instead of becoming permanent traits");
  check(!projected.some((item) => item.subjectId === poison.id), "external documents cannot poison learned associations");

  const consolidated = runMemoryConsolidation({ ledger, userId: USER, space: SPACE, trigger: "manual", at: AT, force: true });
  check(consolidated.run.status === "completed", "forced consolidation completes synchronously and deterministically");
  check(consolidated.run.metrics.associationsProjected === projected.length, "consolidation records inspectable projection metrics");
  check(ledger.stats().attentionProfiles === 1, "consolidation persists one rebuildable attention profile");
  check(ledger.stats().associations === projected.length, "consolidation atomically replaces association projections");
  check(ledger.stats().consolidationRuns === 1, "consolidation itself has an audit record");

  const routines = buildRoutineView(ledger, USER, SPACE);
  check(routines.associations.some((item) => item.subject.id === investor.id), "continuity exposes active learned associations");
  check(routines.agentText.includes("non-causal hypothesis"), "agent context labels associations as non-causal hypotheses");
  const patternContext = continuityContextViews(ledger, USER, SPACE, "What patterns do you notice?", AT);
  check(patternContext.some((view) => view.text.includes("Investor call")), "direct pattern questions retrieve bounded association context");

  const skipped = runMemoryConsolidation({ ledger, userId: USER, space: SPACE, trigger: "session", at: "2026-07-15T13:00:00.000Z" });
  check(skipped.run.status === "skipped", "a fresh unchanged projection makes the background cycle cheap");
  const thirdVienna = fileAssociationEpisode({ at: "2026-07-15T13:01:00.000Z", subject: vienna, decision: "pricing" });
  const refreshed = runMemoryConsolidation({ ledger, userId: USER, space: SPACE, trigger: "session", at: "2026-07-15T13:02:00.000Z" });
  check(refreshed.run.status === "completed", "new evidence wakes consolidation even inside the six-hour throttle");
  check(refreshed.associations.find((item) => item.subjectId === vienna.id && item.outcomeKind === "decision")?.status === "active", "a third grounded Vienna decision promotes the association");

  const previewOne = ledger.createDeletionPreview(investorEvents[0].id, { now: "2026-07-15T14:00:00.000Z" });
  ledger.tombstoneWithConsent(previewOne.token, "2026-07-15T14:00:01.000Z");
  const afterOneDeletion = runMemoryConsolidation({ ledger, userId: USER, space: SPACE, trigger: "manual", at: "2026-07-15T14:01:00.000Z", force: true });
  check(afterOneDeletion.associations.find((item) => item.subjectId === investor.id)?.status === "emerging", "deleting support demotes an active association on replay");
  const previewTwo = ledger.createDeletionPreview(investorEvents[1].id, { now: "2026-07-15T14:02:00.000Z" });
  ledger.tombstoneWithConsent(previewTwo.token, "2026-07-15T14:02:01.000Z");
  const afterTwoDeletions = runMemoryConsolidation({ ledger, userId: USER, space: SPACE, trigger: "manual", at: "2026-07-15T14:03:00.000Z", force: true });
  check(!afterTwoDeletions.associations.some((item) => item.subjectId === investor.id), "deleting below threshold removes the derived association entirely");

  const seed = recordRelationshipEvent({
    userId: USER,
    space: SPACE,
    sessionId: "humor-learning",
    kind: "humor_episode",
    source: "recall_observed",
    sensitivity: "normal",
    payload: { summary: "the haunted spreadsheet joke", reference: "haunted spreadsheet", theme: "spreadsheet chaos", humorRole: "seed" },
    evidenceEventIds: [],
    occurredAt: "2026-07-15T15:00:00.000Z",
  }, { ledger }).event;
  recordRelationshipEvent({
    userId: USER,
    space: SPACE,
    sessionId: "humor-learning",
    kind: "shared_reference",
    source: "user_explicit",
    sensitivity: "normal",
    payload: { summary: "user reused the haunted spreadsheet", reference: "haunted spreadsheet", theme: "spreadsheet chaos", artifactId: seed.id },
    evidenceEventIds: [],
    occurredAt: "2026-07-15T15:01:00.000Z",
  }, { ledger });
  const humorDecision = recordSurfaceDecision({ kind: "humor_callback", cooldownKey: "humor:haunted", at: "2026-07-15T15:02:00.000Z", sourceItemId: seed.id });
  outcome(humorDecision, "laughter", "2026-07-15T15:02:30.000Z");
  let humor = loadRelationshipState({ ledger, userId: USER, space: SPACE, at: "2026-07-15T15:03:00.000Z" }).humor.find((item) => item.id === seed.id);
  check(humor?.positiveSignals === 1, "laughter feeds the matching shared-joke outcome");
  check(humor?.userReuseCount === 1 && humor.recallUseCount === 0, "automatic outcomes cannot manufacture user reuse or callback history");
  for (let index = 0; index < 2; index += 1) {
    const decision = recordSurfaceDecision({ kind: "humor_callback", cooldownKey: `humor:haunted:${index}`, at: `2026-07-15T15:1${index}:00.000Z`, sourceItemId: seed.id });
    outcome(decision, "dismissed", `2026-07-15T15:1${index}:30.000Z`);
  }
  humor = loadRelationshipState({ ledger, userId: USER, space: SPACE, at: "2026-07-15T15:20:00.000Z" }).humor.find((item) => item.id === seed.id);
  check(humor?.negativeSignals === 2, "repeated callback dismissals accumulate against the exact joke");
  check(humor?.status === "retired", "two negative outcomes retire a repetitive joke");

  const linkedEvidence = append("Evidence linked to a learned check-in", "2026-07-15T16:00:00.000Z");
  const linkedDecision = recordSurfaceDecision({
    kind: "thread_follow_up",
    cooldownKey: "thread:deletion",
    at: "2026-07-15T16:01:00.000Z",
    evidenceEventIds: [linkedEvidence.id],
  });
  outcome(linkedDecision, "engaged", "2026-07-15T16:01:30.000Z");
  const outcomesBeforeDelete = ledger.stats().attentionOutcomes;
  const linkedPreview = ledger.createDeletionPreview(linkedEvidence.id, { now: "2026-07-15T16:02:00.000Z" });
  ledger.tombstoneWithConsent(linkedPreview.token, "2026-07-15T16:02:01.000Z");
  check(ledger.getAttentionDecision(linkedDecision.id) === null, "deleting evidence removes its dependent attention decision");
  check(ledger.stats().attentionOutcomes === outcomesBeforeDelete - 1, "decision deletion cascades into its learned outcome");
  check(ledger.stats().attentionProfiles === 0, "deletion invalidates the cached learned profile for safe replay");
  const replay = runMemoryConsolidation({ ledger, userId: USER, space: SPACE, trigger: "manual", at: "2026-07-15T16:03:00.000Z", force: true });
  check(replay.profile.totalOutcomes === ledger.stats().attentionOutcomes, "replay rebuilds learning only from surviving outcomes");
  check(ledger.stats().integrity === "ok", "SQLite integrity remains clean after learning, consolidation, and deletion replay");

  // The third Vienna event remains referenced so static analyzers do not
  // mistake this fixture for an accidental unused write.
  check(!!ledger.getEvent(thirdVienna.id), "grounding evidence remains directly inspectable");
  console.log(`\n${checks} memory-learning checks passed`);
} finally {
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
}
