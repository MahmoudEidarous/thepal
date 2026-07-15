import { randomUUID } from "node:crypto";
import {
  buildAnniversaryView,
  type ReturningMemory,
} from "./continuity-projectors";
import {
  attentionAuditPayload,
  attentionMode,
  decideAttention,
  formatAttentionDecision,
  type AttentionChange,
  type AttentionDecision,
  type AttentionHistoryItem,
  type AttentionMode,
  type AttentionMomentKind,
  type AttentionRepair,
} from "./attention-engine";
import type { CompileContextInput, CompiledContext } from "./context-compiler";
import {
  compileMemoryContext,
  type ContextCompilerDependencies,
} from "./context-service";
import {
  getMemoryEventLedger,
  type AttentionDecisionRecord,
  type MemoryEventLedger,
} from "./event-ledger";
import {
  activeRelationshipRepair,
  decideRelationshipExpression,
  eligibleRelationshipCallbacks,
  formatRelationshipExpression,
  relationshipMode,
  type RelationshipExpressionDecision,
  type RelationshipMode,
  type RelationshipState,
} from "./relationship-engine";
import { loadRelationshipState } from "./relationship-service";
import { readAttentionLearningProfile } from "./learning-service";

export type AttentionCompileInput = CompileContextInput & {
  seenProspective?: string[];
  includeHistory?: boolean;
  includePins?: boolean;
  includeProspective?: boolean;
  includeObligations?: boolean;
  includeAnniversaries?: boolean;
  sessionId?: string;
  momentKind?: AttentionMomentKind;
  explicitSilence?: boolean;
  focusMode?: boolean;
  repair?: AttentionRepair | null;
};

export type AttendedCompiledContext = CompiledContext & {
  attention: AttentionDecision;
  relationship: {
    state: RelationshipState;
    expression: RelationshipExpressionDecision;
  };
};

export type AttentionServiceDependencies = ContextCompilerDependencies & {
  getAnniversaries?: (
    space: CompileContextInput["space"],
    today: string,
  ) => Promise<ReturningMemory[]>;
  mode?: AttentionMode;
  relationshipMode?: RelationshipMode;
  persistDecision?: boolean;
};

function cleanIdentifier(value: string | undefined, fallback: string) {
  const cleaned = (value ?? "")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);
  return cleaned || fallback;
}

export function deriveAttentionChanges(
  ledger: MemoryEventLedger,
  userId: string,
  space: CompileContextInput["space"],
): AttentionChange[] {
  const claimEvidence = ledger.listClaimEvidence(userId, space);
  const claims = new Map(claimEvidence.map((entry) => [entry.claim.id, entry]));
  const events = new Map(ledger.listActiveEvents(userId, space).map((event) => [event.id, event]));
  const changes = new Map<string, AttentionChange>();
  for (const relation of ledger.listClaimRelations(userId, space)) {
    if (relation.relation !== "supersedes") continue;
    const currentClaim = claims.get(relation.fromClaimId);
    const previousClaim = claims.get(relation.toClaimId);
    if (!currentClaim || !previousClaim) continue;
    const current = events.get(currentClaim.claim.eventId);
    const previous = events.get(previousClaim.claim.eventId);
    if (!current || !previous || current.tombstonedAt || previous.tombstonedAt) continue;
    const existing = changes.get(current.id);
    const evidenceEventIds = [...new Set([
      ...(existing?.evidenceEventIds ?? []),
      current.id,
      previous.id,
    ])].sort();
    changes.set(current.id, {
      id: current.id,
      currentText: current.payload.content.slice(0, 800),
      previousText: previous.payload.content.slice(0, 800),
      recordedAt: current.recordedAt,
      trust: current.source.trust,
      sensitivity:
        current.sensitivity === "restricted" || previous.sensitivity === "restricted"
          ? "restricted"
          : current.sensitivity === "sensitive" || previous.sensitivity === "sensitive"
            ? "sensitive"
            : "normal",
      evidenceEventIds,
    });
  }
  return [...changes.values()]
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt) || left.id.localeCompare(right.id))
    .slice(0, 50);
}

function historyFrom(records: AttentionDecisionRecord[]): AttentionHistoryItem[] {
  return records
    .filter(
      (record): record is AttentionDecisionRecord & {
        selectedCandidateId: string;
        cooldownKey: string;
        selectedKind: AttentionHistoryItem["kind"];
      } =>
        record.shouldSurface &&
        !!record.selectedCandidateId &&
        !!record.cooldownKey &&
        [
          "prospective",
          "obligation",
          "thread_follow_up",
          "anniversary",
          "humor_callback",
          "truth_change",
          "uncertainty",
          "repair",
        ].includes(record.selectedKind ?? ""),
    )
    .map((record) => ({
      candidateId: record.selectedCandidateId,
      cooldownKey: record.cooldownKey,
      kind: record.selectedKind,
      surfacedAt: record.createdAt,
    }));
}

function evidenceForDecision(decision: AttentionDecision, ledger: MemoryEventLedger) {
  const eventIds = new Set(decision.candidates.flatMap((candidate) => candidate.evidenceEventIds));
  return [...eventIds]
    .filter((eventId) => {
      const event = ledger.getEvent(eventId);
      return !!event && !event.tombstonedAt;
    })
    .sort();
}

function relationshipEvidenceForDecision(decision: AttentionDecision, ledger: MemoryEventLedger) {
  const relationshipEventIds = new Set(
    decision.candidates.flatMap((candidate) => candidate.relationshipEventIds),
  );
  return [...relationshipEventIds]
    .filter((eventId) => !!ledger.getRelationshipEvent(eventId))
    .sort();
}

export function recordAttentionDecision(
  ledger: MemoryEventLedger,
  userId: string,
  space: CompileContextInput["space"],
  decision: AttentionDecision,
) {
  const chosen = decision.surface ?? decision.selected;
  return ledger.recordAttentionDecision({
    id: decision.id,
    userId,
    space,
    sessionId: decision.moment.sessionId,
    engineVersion: decision.engineVersion,
    mode: decision.mode,
    momentKind: decision.moment.kind,
    selectedCandidateId: chosen?.id ?? null,
    selectedKind: chosen?.kind ?? null,
    selectedAction: chosen?.action ?? null,
    selectedScore: chosen?.score ?? null,
    cooldownKey: chosen?.cooldownKey ?? null,
    shouldSurface: !!decision.surface,
    silenceReason: decision.silenceReason,
    decision: attentionAuditPayload(decision),
    evidenceEventIds: evidenceForDecision(decision, ledger),
    relationshipEventIds: relationshipEvidenceForDecision(decision, ledger),
    createdAt: decision.decidedAt,
  });
}

export async function compileMemoryContextWithAttention(
  input: AttentionCompileInput,
  dependencies: AttentionServiceDependencies = {},
): Promise<AttendedCompiledContext> {
  const ledger = dependencies.ledger ?? getMemoryEventLedger();
  const userId = input.userId ?? "local-user";
  const at = input.at ?? new Date().toISOString();
  const sessionId = cleanIdentifier(input.sessionId, `session-${randomUUID()}`);
  const momentKind = input.momentKind ?? "user_turn";
  const context = await compileMemoryContext({ ...input, at, userId }, { ...dependencies, ledger });
  const relationshipState = loadRelationshipState({
    ledger,
    userId,
    space: input.space,
    at,
  });
  const today = input.at ? at.slice(0, 10) : new Date().toLocaleDateString("en-CA");
  const anniversaries = input.includeAnniversaries === false
    ? []
    : dependencies.getAnniversaries
      ? await dependencies.getAnniversaries(input.space, today).catch(() => [])
      : buildAnniversaryView(ledger, userId, input.space, today).memories;
  const since = new Date(Date.parse(at) - 7 * 86_400_000).toISOString();
  const history = historyFrom(
    ledger.listAttentionDecisions({
      userId,
      space: input.space,
      surfacedOnly: true,
      since,
      limit: 500,
    }),
  );
  const learningProfile = readAttentionLearningProfile({ ledger, userId, space: input.space, at });
  const decision = decideAttention({
    mode: dependencies.mode ?? attentionMode(),
    moment: {
      id: randomUUID(),
      userId,
      space: input.space,
      sessionId,
      kind: momentKind,
      query: input.query,
      recentTurns: input.recentTurns ?? [],
      at,
      explicitSilence: input.explicitSilence,
      focusMode: input.focusMode,
      repair: input.repair ?? activeRelationshipRepair(relationshipState),
    },
    context,
    supplement: {
      anniversaries,
      changes: deriveAttentionChanges(ledger, userId, input.space),
      callbacks: eligibleRelationshipCallbacks(relationshipState, at),
    },
    history,
    learningProfile,
  });
  if (dependencies.persistDecision !== false) {
    recordAttentionDecision(ledger, userId, input.space, decision);
  }
  const expression = decideRelationshipExpression({
    state: relationshipState,
    attention: decision,
    mode: dependencies.relationshipMode ?? relationshipMode(),
  });
  return {
    ...context,
    attention: decision,
    relationship: { state: relationshipState, expression },
    agentText: [
      context.agentText,
      formatAttentionDecision(decision),
      formatRelationshipExpression(expression),
    ].join("\n\n").slice(0, 24_000),
  };
}
