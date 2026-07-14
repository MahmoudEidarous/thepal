import { createHash } from "node:crypto";
import {
  BeliefSchema,
  type Belief,
  type ConfidenceBand,
  type MemoryClaim,
  type MemorySpace,
} from "./contracts";
import {
  type ClaimEvidence,
  type MemoryEventLedger,
  type StoredClaimRelation,
} from "./event-ledger";

export const BELIEF_PROJECTOR_VERSION = "beliefs-v1";
const INFERRED_APPLICABILITY_DAYS = 90;

type Segment = {
  signature: string;
  claims: ClaimEvidence[];
  status: Belief["status"];
  validStart: string;
  validEnd: string | null;
  systemStart: string;
  systemEnd: string | null;
};

export type BeliefProjection = {
  beliefs: Belief[];
  relations: StoredClaimRelation[];
  excludedClaimIds: string[];
};

function stableValue(claim: MemoryClaim) {
  const object =
    claim.object.type === "string"
      ? { ...claim.object, value: claim.object.value.normalize("NFKC").trim().toLowerCase() }
      : claim.object.type === "entity"
        ? { type: "entity", value: claim.object.value.id }
        : claim.object;
  return JSON.stringify({ polarity: claim.polarity, object });
}

function slotKey(evidence: ClaimEvidence) {
  return JSON.stringify({
    userId: evidence.userId,
    space: evidence.space,
    subject: evidence.claim.subject.id,
    predicate: evidence.claim.predicate,
    contexts: evidence.claim.scope.contexts,
  });
}

function effectiveStart(evidence: ClaimEvidence) {
  return evidence.claim.validTime?.start ?? evidence.recordedAt;
}

function addDays(value: string, days: number) {
  const date = new Date(value.length <= 10 ? `${value}T12:00:00Z` : value);
  date.setUTCDate(date.getUTCDate() + days);
  return value.length <= 10 ? date.toISOString().slice(0, 10) : date.toISOString();
}

function claimApplicabilityEnd(evidence: ClaimEvidence) {
  if (evidence.claim.validTime?.end) return evidence.claim.validTime.end;
  if (evidence.claim.modality === "inferred" || evidence.trust === "recall_observation") {
    return addDays(effectiveStart(evidence), INFERRED_APPLICABILITY_DAYS);
  }
  return null;
}

function compareAt(boundary: string, asOf: string) {
  return asOf.slice(0, boundary.length).localeCompare(boundary);
}

function isExpired(end: string | null, asOf: string) {
  return !!end && compareAt(end, asOf) > 0;
}

function trustRank(evidence: ClaimEvidence) {
  switch (evidence.trust) {
    case "user_direct":
      return evidence.claim.modality === "asserted" ? 5 : 4;
    case "user_approved":
      return 3;
    case "tool_output":
      return 2;
    case "recall_observation":
      return 1;
    case "external_content":
      return 0;
  }
}

export function canProjectClaimEvidence(evidence: ClaimEvidence) {
  const { claim } = evidence;
  if (evidence.trust === "external_content") return false;
  if (
    (evidence.actor === "external" || evidence.trust === "user_approved") &&
    claim.subject.kind === "user"
  ) {
    return false;
  }
  if (
    (claim.predicate === "safety.constraint" || claim.predicate === "boundary") &&
    evidence.trust !== "user_direct"
  ) {
    return false;
  }
  if (evidence.trust === "recall_observation" && claim.modality !== "inferred") return false;
  return true;
}

function confidence(segment: Segment): ConfidenceBand {
  if (segment.status === "conflicting") return "conflicting";
  if (
    segment.claims.some(
      (item) => item.trust === "user_direct" && item.claim.modality === "asserted",
    )
  ) {
    return "direct";
  }
  if (
    segment.claims.length >= 2 &&
    segment.claims.every((item) => item.claim.modality !== "inferred")
  ) {
    return "strong";
  }
  return "tentative";
}

function beliefKey(slot: string, segment: Segment) {
  const hash = createHash("sha256")
    .update(`${slot}|${segment.signature}|${segment.systemStart}|${segment.claims[0].claim.id}`)
    .digest("hex")
    .slice(0, 32);
  return `belief:${hash}`;
}

function relationKey(relation: StoredClaimRelation) {
  return `${relation.fromClaimId}|${relation.toClaimId}|${relation.relation}`;
}

export function projectBeliefs(
  allEvidence: ClaimEvidence[],
  options: { asOf?: string; projectorVersion?: string } = {},
): BeliefProjection {
  const asOf = options.asOf ?? new Date().toISOString();
  const projectorVersion = options.projectorVersion ?? BELIEF_PROJECTOR_VERSION;
  const excludedClaimIds: string[] = [];
  const eligible = allEvidence.filter((evidence) => {
    if (evidence.recordedAt > asOf) return false;
    const accepted = canProjectClaimEvidence(evidence);
    if (!accepted) excludedClaimIds.push(evidence.claim.id);
    return accepted;
  });
  const groups = new Map<string, ClaimEvidence[]>();
  for (const evidence of eligible) {
    const key = slotKey(evidence);
    const group = groups.get(key) ?? [];
    group.push(evidence);
    groups.set(key, group);
  }

  const beliefs: Belief[] = [];
  const relationMap = new Map<string, StoredClaimRelation>();
  const addRelation = (
    from: ClaimEvidence,
    to: ClaimEvidence,
    relation: StoredClaimRelation["relation"],
    reason: string,
  ) => {
    if (from.claim.id === to.claim.id) return;
    const item: StoredClaimRelation = {
      fromClaimId: from.claim.id,
      toClaimId: to.claim.id,
      relation,
      reason,
      projectorVersion,
    };
    relationMap.set(relationKey(item), item);
  };

  for (const [slot, group] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    group.sort(
      (left, right) =>
        left.recordedAt.localeCompare(right.recordedAt) ||
        left.claim.id.localeCompare(right.claim.id),
    );
    const segments: Segment[] = [];
    const current = new Set<number>();

    for (const evidence of group) {
      const signature = stableValue(evidence.claim);
      const matching = [...current].find((index) => segments[index].signature === signature);
      if (matching !== undefined) {
        const segment = segments[matching];
        for (const prior of segment.claims) {
          addRelation(evidence, prior, "supports", "same scoped proposition");
        }
        segment.claims.push(evidence);
        const laterEnd = claimApplicabilityEnd(evidence);
        if (laterEnd && (!segment.validEnd || laterEnd > segment.validEnd)) {
          segment.validEnd = laterEnd;
        }
        continue;
      }

      const start = effectiveStart(evidence);
      const next: Segment = {
        signature,
        claims: [evidence],
        status: "current",
        validStart: start,
        validEnd: claimApplicabilityEnd(evidence),
        systemStart: evidence.recordedAt,
        systemEnd: null,
      };
      if (!current.size) {
        segments.push(next);
        current.add(segments.length - 1);
        continue;
      }

      const active = [...current].map((index) => segments[index]);
      const explicitChange =
        evidence.eventKind === "correction" ||
        evidence.claim.relationHint === "supersede" ||
        evidence.claim.relationHint === "retract";
      const incomingRank = trustRank(evidence);
      const strongestActive = Math.max(
        ...active.flatMap((segment) => segment.claims.map(trustRank)),
      );

      if (explicitChange || incomingRank > strongestActive) {
        for (const index of current) {
          const previous = segments[index];
          previous.status = "historical";
          previous.validEnd = start;
          previous.systemEnd = evidence.recordedAt;
          for (const prior of previous.claims) {
            addRelation(
              evidence,
              prior,
              "supersedes",
              explicitChange ? "explicit correction or change" : "stronger evidence replaced a weaker projection",
            );
          }
        }
        current.clear();
        segments.push(next);
        current.add(segments.length - 1);
        continue;
      }

      if (incomingRank < strongestActive) {
        next.status = "unknown";
        next.validEnd = next.validEnd ?? start;
        next.systemEnd = evidence.recordedAt;
        for (const previous of active) {
          for (const prior of previous.claims) {
            addRelation(evidence, prior, "contradicts", "weaker evidence did not replace current truth");
          }
        }
        segments.push(next);
        continue;
      }

      for (const index of current) segments[index].status = "conflicting";
      next.status = "conflicting";
      for (const previous of active) {
        for (const prior of previous.claims) {
          addRelation(evidence, prior, "contradicts", "equally authoritative claims overlap");
        }
      }
      segments.push(next);
      current.add(segments.length - 1);
    }

    const applicable: number[] = [];
    for (const index of current) {
      const segment = segments[index];
      if (isExpired(segment.validEnd, asOf)) {
        segment.status = "historical";
        segment.systemEnd = asOf;
      } else {
        applicable.push(index);
      }
    }
    if (applicable.length === 1) segments[applicable[0]].status = "current";
    if (applicable.length > 1) {
      for (const index of applicable) segments[index].status = "conflicting";
    }

    const allClaimIds = group.map((item) => item.claim.id);
    for (const segment of segments) {
      const head = segment.claims[0];
      const support = segment.claims.map((item) => item.claim.id).sort();
      const supportSet = new Set(support);
      beliefs.push(
        BeliefSchema.parse({
          key: beliefKey(slot, segment),
          subject: head.claim.subject,
          predicate: head.claim.predicate,
          value: head.claim.object,
          polarity: head.claim.polarity,
          status: segment.status,
          confidence: confidence(segment),
          validTime: {
            start: segment.validStart,
            end: segment.validEnd,
            precision: "interval",
          },
          systemTime: {
            start: segment.systemStart,
            end: segment.systemEnd,
            precision: "interval",
          },
          scope: head.claim.scope,
          support,
          opposition: allClaimIds.filter((claimId) => !supportSet.has(claimId)).sort(),
          projectorVersion,
        }),
      );
    }
  }

  return {
    beliefs: beliefs.sort((left, right) => left.key.localeCompare(right.key)),
    relations: [...relationMap.values()].sort((left, right) =>
      relationKey(left).localeCompare(relationKey(right)),
    ),
    excludedClaimIds: excludedClaimIds.sort(),
  };
}

export function rebuildBeliefs(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
  options: { asOf?: string; projectorVersion?: string } = {},
) {
  const projection = projectBeliefs(ledger.listClaimEvidence(userId, space), options);
  ledger.replaceBeliefProjection(userId, space, projection.beliefs, projection.relations);
  return projection;
}
