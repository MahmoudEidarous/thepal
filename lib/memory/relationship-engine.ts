import { createHash } from "node:crypto";
import type { AttentionDecision, AttentionRepair } from "./attention-engine";
import type {
  DialectDimension,
  MemorySpace,
  RelationshipEvent,
  RelationshipSeverity,
  RuptureKind,
  Sensitivity,
} from "./contracts";

export const RECALL_PERSONA_VERSION = "recall-persona-v1" as const;
export const RELATIONSHIP_PROJECTOR_VERSION = "relationship-projector-v1" as const;
export const RELATIONSHIP_EXPRESSION_VERSION = "relationship-expression-v1" as const;

export type RelationshipMode = "shadow" | "guarded" | "active";
export type RelationshipConfidence = "none" | "tentative" | "strong" | "direct";

export type AgentPromiseState = {
  id: string;
  action: string;
  status: "open" | "kept" | "broken" | "cancelled";
  dueAt: string | null;
  openedAt: string;
  updatedAt: string;
  evidenceRelationshipEventIds: string[];
  evidenceEventIds: string[];
};

export type RelationshipBoundaryState = {
  id: string;
  rule: string;
  scope: string;
  status: "active" | "revoked";
  explicit: boolean;
  updatedAt: string;
  evidenceRelationshipEventIds: string[];
  evidenceEventIds: string[];
};

export type RuptureState = {
  status: "none" | "open" | "repairing" | "resolved";
  ruptureEventId: string | null;
  kind: RuptureKind | null;
  severity: RelationshipSeverity | null;
  summary: string | null;
  policyPatch: string | null;
  openedAt: string | null;
  updatedAt: string | null;
  evidenceRelationshipEventIds: string[];
  evidenceEventIds: string[];
};

export type DialectState = {
  dimension: DialectDimension;
  score: -2 | -1 | 0 | 1 | 2;
  confidence: RelationshipConfidence;
  explicitSignals: number;
  implicitSignals: number;
  evidenceRelationshipEventIds: string[];
};

export type HumorArtifactState = {
  id: string;
  reference: string;
  theme: string;
  status: "seed" | "shared" | "cooling" | "retired";
  userReuseCount: number;
  recallUseCount: number;
  positiveSignals: number;
  negativeSignals: number;
  lastUsedAt: string | null;
  cooldownUntil: string | null;
  sensitivity: Sensitivity;
  evidenceRelationshipEventIds: string[];
  evidenceEventIds: string[];
};

export type RelationshipState = {
  contractVersion: 1;
  projectorVersion: typeof RELATIONSHIP_PROJECTOR_VERSION;
  personaVersion: typeof RECALL_PERSONA_VERSION;
  userId: string;
  space: MemorySpace;
  projectedAt: string;
  promises: AgentPromiseState[];
  boundaries: RelationshipBoundaryState[];
  rupture: RuptureState;
  ruptures: RuptureState[];
  dialect: Record<DialectDimension, DialectState>;
  humor: HumorArtifactState[];
  proceduralRules: Array<{
    rule: string;
    sourceRelationshipEventId: string;
    reason: "boundary" | "accepted_repair";
  }>;
};

export type RelationshipCallbackCandidate = {
  id: string;
  reference: string;
  theme: string;
  confidence: "direct";
  sensitivity: Sensitivity;
  evidenceEventIds: string[];
  relationshipEventIds: string[];
  lastUsedAt: string | null;
};

export type RelationshipExpressionDecision = {
  contractVersion: 1;
  engineVersion: typeof RELATIONSHIP_EXPRESSION_VERSION;
  personaVersion: typeof RECALL_PERSONA_VERSION;
  mode: RelationshipMode;
  repairPriority: boolean;
  humor: {
    mode: "none" | "situational" | "callback";
    artifactId: string | null;
    instruction: string;
  };
  dialect: Partial<Record<DialectDimension, number>>;
  boundaries: string[];
  proceduralRules: string[];
  instruction: string;
};

const DIALECT_DIMENSIONS: DialectDimension[] = [
  "directness",
  "verbosity",
  "warmth",
  "teasing",
  "initiative",
];

function emptyRupture(): RuptureState {
  return {
    status: "none",
    ruptureEventId: null,
    kind: null,
    severity: null,
    summary: null,
    policyPatch: null,
    openedAt: null,
    updatedAt: null,
    evidenceRelationshipEventIds: [],
    evidenceEventIds: [],
  };
}

function clean(value: string, limit = 1_000) {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function append<T>(values: T[], value: T) {
  return values.includes(value) ? values : [...values, value];
}

function clampDialect(value: number): -2 | -1 | 0 | 1 | 2 {
  return Math.max(-2, Math.min(2, Math.round(value))) as -2 | -1 | 0 | 1 | 2;
}

function dialectConfidence(explicitSignals: number, implicitSignals: number): RelationshipConfidence {
  if (explicitSignals > 0) return "direct";
  if (implicitSignals >= 3) return "strong";
  if (implicitSignals > 0) return "tentative";
  return "none";
}

function isoAfterDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 86_400_000).toISOString();
}

function eventSort(left: RelationshipEvent, right: RelationshipEvent) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}

export function emptyRelationshipState(
  userId: string,
  space: MemorySpace,
  at = new Date().toISOString(),
): RelationshipState {
  const dialect = {} as Record<DialectDimension, DialectState>;
  for (const dimension of DIALECT_DIMENSIONS) {
    dialect[dimension] = {
      dimension,
      score: 0,
      confidence: "none",
      explicitSignals: 0,
      implicitSignals: 0,
      evidenceRelationshipEventIds: [],
    };
  }
  return {
    contractVersion: 1,
    projectorVersion: RELATIONSHIP_PROJECTOR_VERSION,
    personaVersion: RECALL_PERSONA_VERSION,
    userId,
    space,
    projectedAt: at,
    promises: [],
    boundaries: [],
    rupture: emptyRupture(),
    ruptures: [],
    dialect,
    humor: [],
    proceduralRules: [],
  };
}

export function projectRelationshipState(
  events: RelationshipEvent[],
  userId: string,
  space: MemorySpace,
  at = new Date().toISOString(),
): RelationshipState {
  if (events.some((event) => event.userId !== userId || event.space !== space)) {
    throw new Error("relationship projector crossed a user or memory space");
  }
  const state = emptyRelationshipState(userId, space, at);
  const promises = new Map<string, AgentPromiseState>();
  const boundaries = new Map<string, RelationshipBoundaryState>();
  const humor = new Map<string, HumorArtifactState>();
  const ruptures = new Map<string, RuptureState>();
  const dialectTotals = new Map<DialectDimension, { weighted: number; explicit: number; implicit: number }>();

  for (const event of [...events].sort(eventSort)) {
    const payload = event.payload;
    if (event.kind === "agent_promise") {
      const id = event.id;
      promises.set(id, {
        id,
        action: clean(payload.action ?? payload.summary),
        status: "open",
        dueAt: payload.dueAt,
        openedAt: event.occurredAt,
        updatedAt: event.occurredAt,
        evidenceRelationshipEventIds: [event.id],
        evidenceEventIds: [...event.evidenceEventIds],
      });
    }
    if (event.kind === "promise_outcome") {
      const target = payload.targetId
        ? promises.get(payload.targetId)
        : [...promises.values()].reverse().find((promise) => promise.status === "open");
      if (target && payload.promiseOutcome) {
        target.status = payload.promiseOutcome === "kept"
          ? "kept"
          : payload.promiseOutcome === "broken"
            ? "broken"
            : "cancelled";
        target.updatedAt = event.occurredAt;
        target.evidenceRelationshipEventIds = append(target.evidenceRelationshipEventIds, event.id);
        target.evidenceEventIds = [...new Set([...target.evidenceEventIds, ...event.evidenceEventIds])];
        if (payload.promiseOutcome === "broken") {
          ruptures.set(event.id, {
            status: "open",
            ruptureEventId: event.id,
            kind: "broken_promise",
            severity: payload.severity ?? "medium",
            summary: clean(payload.summary),
            policyPatch: payload.policyPatch,
            openedAt: event.occurredAt,
            updatedAt: event.occurredAt,
            evidenceRelationshipEventIds: [event.id],
            evidenceEventIds: [...event.evidenceEventIds],
          });
        }
      }
    }
    if (event.kind === "boundary") {
      const key = payload.targetId ?? createHash("sha256").update(`${payload.scope ?? "all"}|${payload.rule ?? payload.summary}`).digest("hex").slice(0, 32);
      boundaries.set(key, {
        id: key,
        rule: clean(payload.rule ?? payload.summary),
        scope: clean(payload.scope ?? "all contexts", 500),
        status: payload.boundaryStatus ?? "active",
        explicit: payload.explicit || event.source === "user_explicit",
        updatedAt: event.occurredAt,
        evidenceRelationshipEventIds: [event.id],
        evidenceEventIds: [...event.evidenceEventIds],
      });
    }
    if (event.kind === "recall_mistake" || event.kind === "rupture") {
      ruptures.set(event.id, {
        status: "open",
        ruptureEventId: event.id,
        kind: payload.ruptureKind ?? (event.kind === "recall_mistake" ? "memory_error" : "misunderstanding"),
        severity: payload.severity ?? "medium",
        summary: clean(payload.summary),
        policyPatch: payload.policyPatch,
        openedAt: event.occurredAt,
        updatedAt: event.occurredAt,
        evidenceRelationshipEventIds: [event.id],
        evidenceEventIds: [...event.evidenceEventIds],
      });
    }
    if (event.kind === "repair_attempt") {
      const targetId = payload.targetId ?? [...ruptures.keys()].at(-1) ?? null;
      const rupture = targetId ? ruptures.get(targetId) : null;
      if (rupture && (rupture.status === "open" || rupture.status === "repairing")) {
        rupture.status = "repairing";
        rupture.updatedAt = event.occurredAt;
        rupture.evidenceRelationshipEventIds = append(rupture.evidenceRelationshipEventIds, event.id);
        rupture.evidenceEventIds = [...new Set([...rupture.evidenceEventIds, ...event.evidenceEventIds])];
        if (payload.policyPatch) rupture.policyPatch = payload.policyPatch;
      }
    }
    if (event.kind === "repair_outcome") {
      const targetId = payload.targetId ?? [...ruptures.keys()].at(-1) ?? null;
      const rupture = targetId ? ruptures.get(targetId) : null;
      if (rupture) {
        const resolved = payload.repairOutcome === "accepted" || payload.repairOutcome === "resolved";
        rupture.status = resolved ? "resolved" : "open";
        rupture.updatedAt = event.occurredAt;
        rupture.evidenceRelationshipEventIds = append(rupture.evidenceRelationshipEventIds, event.id);
        rupture.evidenceEventIds = [...new Set([...rupture.evidenceEventIds, ...event.evidenceEventIds])];
        if (payload.policyPatch) rupture.policyPatch = payload.policyPatch;
        if (resolved && rupture.policyPatch) {
          state.proceduralRules.push({
            rule: clean(rupture.policyPatch),
            sourceRelationshipEventId: event.id,
            reason: "accepted_repair",
          });
        }
      }
    }
    if (event.kind === "interaction_feedback" && payload.dimension && payload.direction) {
      const current = dialectTotals.get(payload.dimension) ?? { weighted: 0, explicit: 0, implicit: 0 };
      const explicit = payload.explicit || event.source === "user_explicit";
      current.weighted += payload.direction * (explicit ? 2 : 1);
      current.explicit += explicit ? 1 : 0;
      current.implicit += explicit ? 0 : 1;
      dialectTotals.set(payload.dimension, current);
      const dimension = state.dialect[payload.dimension];
      dimension.evidenceRelationshipEventIds = append(dimension.evidenceRelationshipEventIds, event.id);
    }
    if (event.kind === "interaction_feedback" && payload.targetId && payload.outcome) {
      const artifact = humor.get(payload.targetId);
      if (artifact) {
        artifact.evidenceRelationshipEventIds = append(
          artifact.evidenceRelationshipEventIds,
          event.id,
        );
        if (payload.outcome === "positive") artifact.positiveSignals += 1;
        if (payload.outcome === "negative") artifact.negativeSignals += 1;
        if (artifact.negativeSignals >= 2) artifact.status = "retired";
        else if (payload.outcome === "negative") artifact.status = "cooling";
        else if (artifact.userReuseCount > 0) artifact.status = "shared";
      }
    }
    if (event.kind === "humor_episode" || event.kind === "shared_reference") {
      const artifactId = payload.artifactId ?? event.id;
      const artifact = humor.get(artifactId) ?? {
        id: artifactId,
        reference: clean(payload.reference ?? payload.summary, 500),
        theme: clean(payload.theme ?? payload.reference ?? payload.summary, 300),
        status: "seed" as const,
        userReuseCount: 0,
        recallUseCount: 0,
        positiveSignals: 0,
        negativeSignals: 0,
        lastUsedAt: null,
        cooldownUntil: null,
        sensitivity: event.sensitivity,
        evidenceRelationshipEventIds: [],
        evidenceEventIds: [],
      };
      artifact.reference = clean(payload.reference ?? artifact.reference, 500);
      artifact.theme = clean(payload.theme ?? artifact.theme, 300);
      artifact.sensitivity = event.sensitivity === "restricted" || artifact.sensitivity === "restricted"
        ? "restricted"
        : event.sensitivity === "sensitive" || artifact.sensitivity === "sensitive"
          ? "sensitive"
          : "normal";
      artifact.evidenceRelationshipEventIds = append(artifact.evidenceRelationshipEventIds, event.id);
      artifact.evidenceEventIds = [...new Set([...artifact.evidenceEventIds, ...event.evidenceEventIds])];
      if (event.kind === "shared_reference" || payload.humorRole === "user_reuse") {
        artifact.userReuseCount += 1;
        artifact.status = "shared";
      } else if (payload.humorRole === "recall_callback") {
        artifact.recallUseCount += 1;
        artifact.lastUsedAt = event.occurredAt;
        artifact.cooldownUntil = isoAfterDays(event.occurredAt, 14);
      }
      if (payload.outcome === "positive") artifact.positiveSignals += 1;
      if (payload.outcome === "negative") artifact.negativeSignals += 1;
      if (artifact.negativeSignals >= 2) artifact.status = "retired";
      else if (payload.outcome === "negative" || artifact.recallUseCount >= artifact.userReuseCount + 3) artifact.status = "cooling";
      else if (artifact.userReuseCount > 0) artifact.status = "shared";
      humor.set(artifactId, artifact);
    }
  }

  for (const dimension of DIALECT_DIMENSIONS) {
    const totals = dialectTotals.get(dimension) ?? { weighted: 0, explicit: 0, implicit: 0 };
    const denominator = totals.explicit * 2 + totals.implicit;
    state.dialect[dimension] = {
      ...state.dialect[dimension],
      score: denominator ? clampDialect(totals.weighted / Math.max(1, denominator / 2)) : 0,
      confidence: dialectConfidence(totals.explicit, totals.implicit),
      explicitSignals: totals.explicit,
      implicitSignals: totals.implicit,
    };
  }
  state.promises = [...promises.values()].sort((left, right) => left.openedAt.localeCompare(right.openedAt));
  state.boundaries = [...boundaries.values()].sort((left, right) => left.scope.localeCompare(right.scope));
  state.humor = [...humor.values()].sort((left, right) => left.theme.localeCompare(right.theme) || left.id.localeCompare(right.id));
  const severity = { low: 0, medium: 1, high: 2, critical: 3 } as const;
  state.ruptures = [...ruptures.values()].sort(
    (left, right) =>
      (right.openedAt ?? "").localeCompare(left.openedAt ?? "") ||
      (left.ruptureEventId ?? "").localeCompare(right.ruptureEventId ?? ""),
  );
  state.rupture = [...state.ruptures]
    .filter((rupture) => rupture.status === "open" || rupture.status === "repairing")
    .sort(
      (left, right) =>
        severity[right.severity ?? "low"] - severity[left.severity ?? "low"] ||
        (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
    )[0] ?? state.ruptures[0] ?? emptyRupture();
  for (const boundary of state.boundaries.filter((item) => item.status === "active")) {
    state.proceduralRules.push({
      rule: `${boundary.rule} (scope: ${boundary.scope})`,
      sourceRelationshipEventId: boundary.evidenceRelationshipEventIds.at(-1) ?? boundary.id,
      reason: "boundary",
    });
  }
  return state;
}

export function activeRelationshipRepair(state: RelationshipState): AttentionRepair | null {
  if (state.rupture.status !== "open" && state.rupture.status !== "repairing") return null;
  const summary = state.rupture.summary ?? "the Pal caused a relationship rupture";
  const patch = state.rupture.policyPatch
    ? ` Change future behavior: ${state.rupture.policyPatch}`
    : " State one concrete behavior change only if it is actually enforceable.";
  return {
    reason: summary,
    instruction: `Stop banter. Name the specific failure, own it without defensiveness, correct what can be corrected now, apologize once, and do not ask the user to comfort the Pal.${patch}`,
    evidenceEventIds: state.rupture.evidenceEventIds,
    relationshipEventIds: state.rupture.evidenceRelationshipEventIds,
  };
}

export function eligibleRelationshipCallbacks(
  state: RelationshipState,
  at = new Date().toISOString(),
): RelationshipCallbackCandidate[] {
  if (state.rupture.status === "open" || state.rupture.status === "repairing") return [];
  return state.humor
    .filter(
      (artifact) =>
        artifact.status === "shared" &&
        artifact.userReuseCount > 0 &&
        artifact.negativeSignals === 0 &&
        artifact.sensitivity === "normal" &&
        (!artifact.cooldownUntil || artifact.cooldownUntil <= at),
    )
    .map((artifact) => ({
      id: artifact.id,
      reference: artifact.reference,
      theme: artifact.theme,
      confidence: "direct" as const,
      sensitivity: artifact.sensitivity,
      evidenceEventIds: artifact.evidenceEventIds,
      relationshipEventIds: artifact.evidenceRelationshipEventIds,
      lastUsedAt: artifact.lastUsedAt,
    }));
}

export function relationshipMode(value = process.env.RECALL_RELATIONSHIP_MODE): RelationshipMode {
  return value === "shadow" || value === "active" || value === "guarded" ? value : "guarded";
}

function dialectAllowed(mode: RelationshipMode, dialect: DialectState) {
  if (mode === "shadow") return false;
  if (mode === "guarded") return dialect.confidence === "direct";
  return dialect.confidence === "direct" || dialect.confidence === "strong";
}

export function decideRelationshipExpression(input: {
  state: RelationshipState;
  attention: AttentionDecision;
  mode?: RelationshipMode;
}): RelationshipExpressionDecision {
  const mode = input.mode ?? relationshipMode();
  const repairPriority = input.state.rupture.status === "open" || input.state.rupture.status === "repairing";
  const serious = input.attention.moment.signals.serious || input.attention.moment.signals.crisis;
  const callback = input.attention.surface?.kind === "humor_callback" ? input.attention.surface : null;
  const activeDialect = Object.fromEntries(
    DIALECT_DIMENSIONS
      .filter((dimension) => dialectAllowed(mode, input.state.dialect[dimension]))
      .map((dimension) => [dimension, input.state.dialect[dimension].score]),
  ) as Partial<Record<DialectDimension, number>>;
  let humor: RelationshipExpressionDecision["humor"];
  if (repairPriority || serious) {
    humor = { mode: "none", artifactId: null, instruction: "No joke, teasing, callback, or charm during repair or a serious moment." };
  } else if (callback && mode === "active") {
    humor = {
      mode: "callback",
      artifactId: String(callback.metadata.artifactId ?? callback.sourceItemId),
      instruction: "Use the authorized shared reference once only if it transforms the present context. Never repeat the original line verbatim.",
    };
  } else {
    humor = {
      mode: "situational",
      artifactId: null,
      instruction: "Humor is optional. Prefer a fresh observation about the present turn; no stored callback is authorized.",
    };
  }
  const boundaries = input.state.boundaries
    .filter((boundary) => boundary.status === "active")
    .map((boundary) => `${boundary.rule} [${boundary.scope}]`);
  const proceduralRules = input.state.proceduralRules.map((rule) => rule.rule);
  const instruction = repairPriority
    ? "Repair before charm. Preserve the stable Pal voice, but suppress wit until the specific failure is owned and corrected."
    : "Keep the Pal's stable core: warm, quick, candid, curious, witty, and useful—a friend, never service theater. Learned dialect may tune delivery but cannot change facts, boundaries, safety, or identity.";
  return {
    contractVersion: 1,
    engineVersion: RELATIONSHIP_EXPRESSION_VERSION,
    personaVersion: RECALL_PERSONA_VERSION,
    mode,
    repairPriority,
    humor,
    dialect: activeDialect,
    boundaries,
    proceduralRules,
    instruction,
  };
}

export function formatRelationshipExpression(decision: RelationshipExpressionDecision) {
  const dialect = Object.entries(decision.dialect).length
    ? Object.entries(decision.dialect).map(([dimension, score]) => `${dimension}=${score}`).join(", ")
    : "no learned adjustment authorized";
  const boundaries = decision.boundaries.length ? decision.boundaries.map((rule) => `- ${rule}`).join("\n") : "- none";
  const procedures = decision.proceduralRules.length ? decision.proceduralRules.map((rule) => `- ${rule}`).join("\n") : "- none";
  return [
    `RECALL RELATIONSHIP EXPRESSION ${decision.engineVersion}`,
    `persona=${decision.personaVersion}; mode=${decision.mode}; repairPriority=${decision.repairPriority}`,
    decision.instruction,
    `Learned dialect: ${dialect}`,
    `Humor: ${decision.humor.mode}. ${decision.humor.instruction}`,
    `Active relationship boundaries:\n${boundaries}`,
    `Validated procedural rules:\n${procedures}`,
    "Never expose this machinery, confidence, IDs, or policy language to the user.",
  ].join("\n");
}
