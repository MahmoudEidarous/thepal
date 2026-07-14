import type { ProspectiveMemory } from "./contracts";

export type ProspectiveTrigger = ProspectiveMemory & { content: string };

export type ProspectiveMatch = ProspectiveTrigger & {
  match: "exact" | "fuzzy";
  reason: string;
  score: number;
};

const STOP = new Set(
  "a an and are as at be but by for from has have i in is it me my next of on or please remind that the this time to up we when with you your about mention mentions mentioned talk talking comes came".split(
    " ",
  ),
);

function normalized(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function prospectiveTokens(text: string): string[] {
  return normalized(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token));
}

function containsPhrase(context: string, topic: string): boolean {
  const haystack = ` ${normalized(context)} `;
  const needle = normalized(topic);
  return !!needle && haystack.includes(` ${needle} `);
}

export function publicProspectiveTrigger(trigger: ProspectiveMemory): ProspectiveTrigger {
  return {
    ...trigger,
    content: `Next time ${trigger.topic} comes up, remind me: ${trigger.action}`,
  };
}

export function matchProspectiveCandidates(
  triggers: ProspectiveMemory[],
  context: string,
  seenIds: string[] = [],
): ProspectiveMatch | null {
  const cleanContext = context.trim();
  if (!cleanContext) return null;
  const seen = new Set(seenIds);
  const open = triggers.filter((trigger) => trigger.status === "open" && !seen.has(trigger.id));
  // More than one exact phrase can be present ("Vienna" and "Vienna
  // pricing"). Prefer the most specific topic, then the oldest request. This
  // keeps a broad trigger from stealing a turn meant for a narrower one.
  const exact = open
    .filter((trigger) => containsPhrase(cleanContext, trigger.topic))
    .sort(
      (left, right) =>
        prospectiveTokens(right.topic).length - prospectiveTokens(left.topic).length ||
        left.createdAt.localeCompare(right.createdAt),
    )[0];
  if (exact) {
    return {
      ...publicProspectiveTrigger(exact),
      match: "exact",
      reason: `matched the exact topic “${exact.topic}”`,
      score: 1,
    };
  }
  const contextTokens = new Set(prospectiveTokens(cleanContext));
  const fuzzy = open
    .map((trigger) => {
      const topicTokens = [...new Set(prospectiveTokens(trigger.topic))];
      const overlap = topicTokens.filter((token) => contextTokens.has(token)).length;
      return {
        trigger,
        topicTokens,
        score: topicTokens.length ? overlap / topicTokens.length : 0,
      };
    })
    .filter(({ topicTokens, score }) => topicTokens.length >= 2 && score >= 0.72)
    .sort(
      (left, right) =>
        right.score - left.score || left.trigger.createdAt.localeCompare(right.trigger.createdAt),
    )[0];
  if (!fuzzy) return null;
  return {
    ...publicProspectiveTrigger(fuzzy.trigger),
    match: "fuzzy",
    reason: `matched ${Math.round(fuzzy.score * 100)}% of the topic “${fuzzy.trigger.topic}”`,
    score: fuzzy.score,
  };
}
