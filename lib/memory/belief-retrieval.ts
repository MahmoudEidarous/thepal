import { getMemoryEventLedger, type MemoryEventLedger } from "./event-ledger";
import type { Belief, MemorySpace, TypedValue } from "./contracts";

const STOP = new Set(
  "a an and are at be did do does for from has have how i in is it me my of on or that the this to was what when where which who why with you your".split(
    " ",
  ),
);

const PREDICATE_TERMS: Record<string, string[]> = {
  "meeting.scheduled_for": ["meeting", "call", "date", "time", "when", "scheduled"],
  preference: ["like", "love", "hate", "prefer", "preference", "favorite", "dislike"],
  location: ["where", "location", "place", "venue", "located"],
  "state.status": ["status", "state", "going", "progress"],
  relationship: ["relationship", "know", "person"],
  decision: ["decided", "decision", "choose", "chosen"],
  "emotion.state": ["feel", "feeling", "mood", "emotion"],
  "routine.pattern": ["routine", "usually", "often", "pattern"],
};

function tokens(value: string) {
  return new Set(
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token && !STOP.has(token) && (token.length > 2 || /^\d+$/.test(token))),
  );
}

function valueText(value: TypedValue): string {
  if (value.type !== "entity") return String(value.value);
  return value.value.label;
}

function render(belief: Belief) {
  const verb = belief.polarity === -1 ? "denies" : "asserts";
  return `${belief.subject.label} · ${belief.predicate.replace(/[._]/g, " ")} · ${verb}: ${valueText(belief.value)}`;
}

export type ApplicableBelief = {
  key: string;
  text: string;
  status: Belief["status"];
  confidence: Belief["confidence"];
  validTime: Belief["validTime"];
  systemTime: Belief["systemTime"];
  evidence: string[];
  score: number;
};

export function retrieveApplicableBeliefs(
  query: string,
  space: MemorySpace,
  options: { ledger?: MemoryEventLedger; userId?: string; limit?: number; at?: string } = {},
): ApplicableBelief[] {
  const ledger = options.ledger ?? getMemoryEventLedger();
  const at = options.at ?? new Date().toISOString();
  const queryTokens = tokens(query);
  if (!queryTokens.size) return [];
  const candidates = [
    ...ledger.listBeliefs({ userId: options.userId, space, status: "current", limit: 500 }),
    ...ledger.listBeliefs({ userId: options.userId, space, status: "conflicting", limit: 500 }),
  ];
  const applicable = candidates.filter((belief) => {
    const start = at.slice(0, belief.validTime.start.length);
    const afterStart = start >= belief.validTime.start;
    const beforeEnd =
      belief.validTime.end === null ||
      at.slice(0, belief.validTime.end.length) <= belief.validTime.end;
    return afterStart && beforeEnd;
  });
  const scored = applicable.map((belief) => {
    const subject = tokens(belief.subject.label);
    const value = tokens(valueText(belief.value));
    const contexts = tokens(belief.scope.contexts.join(" "));
    const predicate = new Set([
      ...tokens(belief.predicate.replace(/[._]/g, " ")),
      ...(PREDICATE_TERMS[belief.predicate] ?? []),
    ]);
    const overlap = (set: Set<string>) => [...queryTokens].filter((token) => set.has(token)).length;
    const subjectMatch = overlap(subject);
    const valueMatch = overlap(value);
    const contextMatch = overlap(contexts);
    const predicateMatch = overlap(predicate);
    const score = subjectMatch * 4 + valueMatch * 3 + contextMatch * 2 + predicateMatch;
    return {
      key: belief.key,
      text: render(belief),
      status: belief.status,
      confidence: belief.confidence,
      validTime: belief.validTime,
      systemTime: belief.systemTime,
      evidence: belief.support,
      score,
    } satisfies ApplicableBelief;
  });
  return scored
    .filter((candidate) => candidate.score >= 2)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.status === "current" ? 0 : 1) - (right.status === "current" ? 0 : 1) ||
        left.key.localeCompare(right.key),
    )
    .slice(0, Math.max(1, Math.min(8, options.limit ?? 4)));
}
