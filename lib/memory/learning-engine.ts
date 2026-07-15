import { createHash } from "node:crypto";
import { canProjectClaimEvidence } from "./belief-projector";
import type { MemorySpace, TypedValue } from "./contracts";
import type {
  AttentionOutcomeRecord,
  ClaimEvidence,
  MemoryAssociationRecord,
} from "./event-ledger";

export const LEARNING_PROJECTOR_VERSION = "learning-v1" as const;

export type AttentionLearningBucket = {
  samples: number;
  positive: number;
  negative: number;
  boost: number;
  lastOutcomeAt: string | null;
};

export type AttentionLearningProfile = {
  contractVersion: 1;
  projectorVersion: typeof LEARNING_PROJECTOR_VERSION;
  userId: string;
  space: MemorySpace;
  projectedAt: string;
  totalOutcomes: number;
  byKind: Record<string, AttentionLearningBucket>;
  byMomentAndKind: Record<string, AttentionLearningBucket>;
  byCooldown: Record<string, AttentionLearningBucket>;
};

export type AttentionLearningTarget = {
  kind: string;
  momentKind: AttentionOutcomeRecord["momentKind"];
  cooldownKey: string;
};

type WeightedSample = {
  reward: number;
  weight: number;
  occurredAt: string;
};

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 45;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function recencyWeight(occurredAt: string, now: string) {
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(occurredAt)) / DAY);
  return 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

function projectBucket(
  samples: WeightedSample[],
  options: { minimum: number; cap: number },
): AttentionLearningBucket {
  const weight = samples.reduce((sum, sample) => sum + sample.weight, 0);
  const weightedReward = samples.reduce(
    (sum, sample) => sum + sample.reward * sample.weight,
    0,
  );
  // Two virtual neutral observations keep small histories from swinging the
  // policy. A bucket is inert until its minimum evidence threshold is met.
  const mean = weightedReward / Math.max(2 + weight, 1);
  const boost = samples.length < options.minimum
    ? 0
    : Math.round(clamp(mean * 12, -options.cap, options.cap));
  return {
    samples: samples.length,
    positive: samples.filter((sample) => sample.reward > 0).length,
    negative: samples.filter((sample) => sample.reward < 0).length,
    boost,
    lastOutcomeAt: samples.map((sample) => sample.occurredAt).sort().at(-1) ?? null,
  };
}

function addSample(map: Map<string, WeightedSample[]>, key: string, sample: WeightedSample) {
  const current = map.get(key) ?? [];
  current.push(sample);
  map.set(key, current);
}

function projectMap(
  map: Map<string, WeightedSample[]>,
  options: { minimum: number; cap: number },
) {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, samples]) => [key, projectBucket(samples, options)]),
  );
}

export function projectAttentionLearningProfile(options: {
  outcomes: AttentionOutcomeRecord[];
  userId: string;
  space: MemorySpace;
  at?: string;
}): AttentionLearningProfile {
  const projectedAt = options.at ?? new Date().toISOString();
  const byKind = new Map<string, WeightedSample[]>();
  const byMomentAndKind = new Map<string, WeightedSample[]>();
  const byCooldown = new Map<string, WeightedSample[]>();
  const eligible = options.outcomes.filter(
    (outcome) =>
      outcome.userId === options.userId &&
      outcome.space === options.space &&
      Date.parse(outcome.occurredAt) <= Date.parse(projectedAt),
  );
  for (const outcome of eligible) {
    const sample = {
      reward: outcome.reward,
      weight: outcome.confidence * recencyWeight(outcome.occurredAt, projectedAt),
      occurredAt: outcome.occurredAt,
    };
    addSample(byKind, outcome.candidateKind, sample);
    addSample(byMomentAndKind, `${outcome.momentKind}|${outcome.candidateKind}`, sample);
    addSample(byCooldown, outcome.cooldownKey, sample);
  }
  return {
    contractVersion: 1,
    projectorVersion: LEARNING_PROJECTOR_VERSION,
    userId: options.userId,
    space: options.space,
    projectedAt,
    totalOutcomes: eligible.length,
    byKind: projectMap(byKind, { minimum: 3, cap: 6 }),
    byMomentAndKind: projectMap(byMomentAndKind, { minimum: 3, cap: 4 }),
    byCooldown: projectMap(byCooldown, { minimum: 2, cap: 3 }),
  };
}

export function learnedAttentionBoost(
  profile: AttentionLearningProfile | null | undefined,
  target: AttentionLearningTarget,
) {
  if (!profile) return 0;
  const kind = profile.byKind[target.kind]?.boost ?? 0;
  const moment = profile.byMomentAndKind[`${target.momentKind}|${target.kind}`]?.boost ?? 0;
  const topic = profile.byCooldown[target.cooldownKey]?.boost ?? 0;
  return clamp(kind + moment + topic, -12, 12);
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function valueText(value: TypedValue) {
  return value.type === "entity" ? value.value.label : String(value.value);
}

function associationId(parts: string[]) {
  return `association:${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
}

function outcomeKind(predicate: string): MemoryAssociationRecord["outcomeKind"] | null {
  if (predicate === "emotion.state") return "emotion";
  if (predicate === "decision") return "decision";
  if (predicate.endsWith(".status") || predicate === "state.status") return "status";
  return null;
}

function evidenceQuality(evidence: ClaimEvidence) {
  if (evidence.trust === "user_direct" && evidence.claim.modality === "asserted") return 1;
  if (evidence.trust === "user_approved" || evidence.trust === "tool_output") return 0.7;
  return 0.45;
}

export function projectMemoryAssociations(options: {
  evidence: ClaimEvidence[];
  userId: string;
  space: MemorySpace;
  at?: string;
}): MemoryAssociationRecord[] {
  const at = options.at ?? new Date().toISOString();
  const byEvent = new Map<string, ClaimEvidence[]>();
  for (const item of options.evidence) {
    if (
      item.userId !== options.userId ||
      item.space !== options.space ||
      item.recordedAt > at ||
      !canProjectClaimEvidence(item)
    ) continue;
    const group = byEvent.get(item.claim.eventId) ?? [];
    group.push(item);
    byEvent.set(item.claim.eventId, group);
  }

  type Observation = {
    eventId: string;
    at: string;
    quality: number;
    subject: ClaimEvidence["claim"]["subject"];
    kind: MemoryAssociationRecord["outcomeKind"];
    value: string;
  };
  const groups = new Map<string, Observation[]>();
  for (const evidence of byEvent.values()) {
    const anchors = new Map<string, ClaimEvidence["claim"]["subject"]>();
    for (const item of evidence) {
      if (item.claim.subject.kind !== "user") anchors.set(item.claim.subject.id, item.claim.subject);
      if (item.claim.object.type === "entity" && item.claim.object.value.kind !== "user") {
        anchors.set(item.claim.object.value.id, item.claim.object.value);
      }
    }
    for (const item of evidence) {
      const kind = outcomeKind(item.claim.predicate);
      if (!kind) continue;
      const raw = valueText(item.claim.object).trim();
      const value = `${item.claim.polarity < 0 ? "not " : ""}${raw}`.trim();
      if (!normalize(value)) continue;
      const relevantAnchors = item.claim.subject.kind !== "user"
        ? [item.claim.subject]
        : [...anchors.values()];
      for (const subject of relevantAnchors) {
        const key = `${subject.id}|${kind}|${normalize(value)}`;
        const observations = groups.get(key) ?? [];
        if (!observations.some((observation) => observation.eventId === item.claim.eventId)) {
          observations.push({
            eventId: item.claim.eventId,
            at: item.recordedAt,
            quality: evidenceQuality(item),
            subject,
            kind,
            value,
          });
          groups.set(key, observations);
        }
      }
    }
  }

  const associations: MemoryAssociationRecord[] = [];
  for (const observations of groups.values()) {
    if (observations.length < 2) continue;
    const ordered = [...observations].sort((left, right) => left.at.localeCompare(right.at));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const averageQuality = ordered.reduce((sum, item) => sum + item.quality, 0) / ordered.length;
    const confidence = clamp(averageQuality * Math.min(0.9, 0.45 + ordered.length * 0.15), 0, 0.9);
    const stale = Date.parse(at) - Date.parse(last.at) > 90 * DAY;
    const status: MemoryAssociationRecord["status"] = stale
      ? "stale"
      : ordered.length >= 3 && confidence >= 0.6
        ? "active"
        : "emerging";
    associations.push({
      id: associationId([options.userId, options.space, first.subject.id, first.kind, normalize(first.value)]),
      userId: options.userId,
      space: options.space,
      subjectId: first.subject.id,
      subjectKind: first.subject.kind,
      subjectLabel: first.subject.label,
      outcomeKind: first.kind,
      outcomeValue: first.value,
      status,
      confidence: Number(confidence.toFixed(3)),
      observations: ordered.length,
      evidenceEventIds: ordered.map((item) => item.eventId).sort(),
      firstObservedAt: first.at,
      lastObservedAt: last.at,
      projectorVersion: LEARNING_PROJECTOR_VERSION,
      updatedAt: at,
    });
  }
  return associations.sort(
    (left, right) =>
      (right.status === "active" ? 1 : 0) - (left.status === "active" ? 1 : 0) ||
      right.confidence - left.confidence ||
      right.lastObservedAt.localeCompare(left.lastObservedAt) ||
      left.id.localeCompare(right.id),
  );
}
