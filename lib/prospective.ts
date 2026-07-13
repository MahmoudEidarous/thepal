import { localToday } from "./envelope";
import { setLedgerStatus, stripHints } from "./ledger";
import { supermemory } from "./supermemory";

// Prospective memory: an intention whose due moment is a context rather
// than a date. The document stays a typed commitment, but triggerMode
// keeps it out of the ordinary agenda until its topic comes back.

type Doc = {
  id: string;
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

export type ProspectiveTrigger = {
  id: string;
  content: string;
  topic: string;
  action: string;
  firePolicy: "once";
  status: "open" | "done" | "cancelled";
  snoozedUntil: string | null;
  createdAt: string | null;
  firedAt: string | null;
};

export type ProspectiveMatch = ProspectiveTrigger & {
  match: "exact" | "fuzzy";
  reason: string;
  score: number;
};

const stringValue = (value: unknown) => (typeof value === "string" ? value : null);

async function listDocs(tag: string): Promise<Doc[]> {
  const docs = await supermemory.documents.list({
    containerTags: [tag],
    limit: 500,
    sort: "createdAt",
    order: "desc",
  });
  return (docs as { memories?: Doc[] }).memories ?? [];
}

function fromDoc(doc: Doc, metadata: Record<string, unknown>, content: string): ProspectiveTrigger {
  const rawStatus = stringValue(metadata.status);
  return {
    id: doc.id,
    content: stripHints(content),
    topic: stringValue(metadata.triggerTopic) ?? "",
    action: stringValue(metadata.triggerAction) ?? stripHints(content),
    firePolicy: "once",
    status: rawStatus === "done" ? "done" : rawStatus === "cancelled" ? "cancelled" : "open",
    snoozedUntil: stringValue(metadata.triggerSnoozedUntil),
    createdAt: doc.createdAt ?? null,
    firedAt: stringValue(metadata.triggerFiredAt),
  };
}

export async function prospectiveTriggers(
  tag: string,
  options: { includeClosed?: boolean; includeSnoozed?: boolean } = {},
): Promise<ProspectiveTrigger[]> {
  const candidates = (await listDocs(tag)).filter(
    (doc) => doc.metadata?.triggerMode === "context",
  );
  const now = new Date().toISOString();
  const full = await Promise.all(
    candidates.map(async (doc) => {
      // documents.list can serve stale metadata after lifecycle PATCHes.
      // As with the ledger, the individual document is the source of truth.
      const got = (await supermemory.documents.get(doc.id).catch(() => null)) as {
        content?: string | null;
        metadata?: Record<string, unknown> | null;
      } | null;
      const metadata = (got?.metadata ?? doc.metadata ?? {}) as Record<string, unknown>;
      return fromDoc(
        doc,
        metadata,
        got?.content ?? doc.content ?? doc.title ?? doc.summary ?? "",
      );
    }),
  );
  return full
    .filter((trigger) => trigger.topic && trigger.action && trigger.content)
    .filter((trigger) => options.includeClosed || trigger.status === "open")
    .filter(
      (trigger) =>
        options.includeSnoozed ||
        !trigger.snoozedUntil ||
        trigger.snoozedUntil <= now,
    )
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

export async function createProspectiveTrigger(args: {
  tag: string;
  topic: string;
  action: string;
  source?: string;
  salience?: number;
}) {
  const topic = args.topic.trim().replace(/\s+/g, " ").slice(0, 120);
  const action = args.action.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!topic || !action) throw new Error("topic and action required");
  const content = `Next time ${topic} comes up, remind me: ${action}`;
  const doc = await supermemory.add({
    content,
    containerTag: args.tag,
    metadata: {
      source: args.source ?? "recall-prospective",
      type: "commitment",
      provenance: "stated",
      salience: args.salience ?? 0.78,
      status: "open",
      triggerMode: "context",
      triggerTopic: topic,
      triggerAction: action,
      triggerFirePolicy: "once",
      triggerCreatedAt: new Date().toISOString(),
    },
  });
  return {
    ...doc,
    trigger: {
      id: doc.id,
      content,
      topic,
      action,
      firePolicy: "once" as const,
      status: "open" as const,
      snoozedUntil: null,
      createdAt: new Date().toISOString(),
      firedAt: null,
    },
  };
}

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

function tokens(text: string): string[] {
  return normalized(text)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token));
}

function containsPhrase(context: string, topic: string): boolean {
  const haystack = ` ${normalized(context)} `;
  const needle = normalized(topic);
  return !!needle && haystack.includes(` ${needle} `);
}

export async function matchProspectiveTrigger(args: {
  tag: string;
  context: string;
  seen?: string[];
}): Promise<ProspectiveMatch | null> {
  const context = args.context.trim();
  if (!context) return null;
  const seen = new Set(args.seen ?? []);
  const open = (await prospectiveTriggers(args.tag)).filter((trigger) => !seen.has(trigger.id));

  // Exact phrase/entity matching wins. It is deterministic, cheap and
  // prevents a merely related conversation from consuming a one-shot.
  const exact = open.find((trigger) => containsPhrase(context, trigger.topic));
  if (exact) {
    return {
      ...exact,
      match: "exact",
      reason: `matched the exact topic “${exact.topic}”`,
      score: 1,
    };
  }

  // Fuzzy fallback is intentionally conservative: at least two useful
  // topic tokens and 72% coverage. A one-word trigger must match exactly.
  const contextTokens = new Set(tokens(context));
  const scored = open
    .map((trigger) => {
      const topicTokens = [...new Set(tokens(trigger.topic))];
      const overlap = topicTokens.filter((token) => contextTokens.has(token)).length;
      const score = topicTokens.length ? overlap / topicTokens.length : 0;
      return { trigger, topicTokens, score };
    })
    .filter(({ topicTokens, score }) => topicTokens.length >= 2 && score >= 0.72)
    .sort((a, b) => b.score - a.score);
  const fuzzy = scored[0];
  if (!fuzzy) return null;
  return {
    ...fuzzy.trigger,
    match: "fuzzy",
    reason: `matched ${Math.round(fuzzy.score * 100)}% of the topic “${fuzzy.trigger.topic}”`,
    score: fuzzy.score,
  };
}

function tomorrow(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("en-CA");
}

export async function updateProspectiveTrigger(args: {
  tag: string;
  id?: string;
  about?: string;
  operation: "fire" | "resolve" | "cancel" | "snooze";
  until?: string;
  reason?: string;
}) {
  const open = await prospectiveTriggers(args.tag, { includeSnoozed: true });
  let trigger = args.id ? open.find((item) => item.id === args.id) : undefined;
  if (!trigger && args.about) {
    const q = new Set(tokens(args.about));
    trigger = open
      .map((item) => {
        const all = tokens(`${item.topic} ${item.action}`);
        return { item, score: all.filter((token) => q.has(token)).length };
      })
      .sort((a, b) => b.score - a.score)
      .find((entry) => entry.score > 0)?.item;
  }
  if (!trigger) return null;

  const now = new Date().toISOString();
  if (args.operation === "snooze") {
    const until = (args.until?.trim() || tomorrow()).slice(0, 32);
    await setLedgerStatus(args.tag, trigger.id, {
      status: "open",
      triggerSnoozedUntil: until.length === 10 ? `${until}T23:59:59` : until,
      triggerLastActionAt: now,
    });
    return { trigger, operation: "snooze" as const, until };
  }

  const status = args.operation === "cancel" ? "cancelled" : "done";
  await setLedgerStatus(args.tag, trigger.id, {
    status,
    completedAt: localToday(),
    triggerOutcome: args.operation === "fire" ? "fired" : args.operation,
    triggerLastActionAt: now,
    ...(args.operation === "fire"
      ? {
          triggerFiredAt: now,
          triggerFiredReason: args.reason?.slice(0, 240) || `topic ${trigger.topic} returned`,
        }
      : {}),
  });

  if (args.operation === "fire") {
    await supermemory
      .add({
        content: `Remembered forward: ${trigger.action} when ${trigger.topic} came up (${localToday()})`,
        containerTag: args.tag,
        metadata: {
          source: "recall-prospective#fired",
          type: "event",
          provenance: "stated",
          storyDate: localToday(),
          salience: 0.58,
          prospectiveTrigger: trigger.id,
        },
      })
      .catch(() => {});
  }
  return { trigger, operation: args.operation, on: localToday() };
}
