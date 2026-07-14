import { localToday } from "./envelope";
import { setLedgerStatus, stripHints } from "./ledger";
import { getMemoryEventLedger } from "./memory/event-ledger";
import { rebuildProspective } from "./memory/prospective-projector";
import {
  createCanonicalProspective,
  transitionCanonicalProspective,
} from "./memory/prospective-writer";
import { processCaptureJob } from "./memory/reconciler";
import { scheduleMemoryReconciliation } from "./memory/reconcile-scheduler";
import { processStateJob } from "./memory/state-reconciler";
import type { MemorySpace } from "./memory/contracts";
import {
  matchProspectiveCandidates,
  prospectiveTokens as tokens,
  publicProspectiveTrigger as publicTrigger,
  type ProspectiveMatch,
  type ProspectiveTrigger,
} from "./memory/prospective-matcher";
import { supermemory } from "./supermemory";

export {
  matchProspectiveCandidates,
  type ProspectiveMatch,
  type ProspectiveTrigger,
} from "./memory/prospective-matcher";

type Doc = {
  id: string;
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

function spaceFromTag(tag: string): MemorySpace {
  const value = tag.startsWith("recall_") ? tag.slice("recall_".length) : tag;
  if (["personal", "work", "health", "eval"].includes(value)) return value as MemorySpace;
  throw new Error(`unknown prospective memory space ${tag}`);
}

const legacyMigrationAttempted = new Set<string>();

async function migrateLegacyProviderTriggers(tag: string) {
  if (legacyMigrationAttempted.has(tag)) return;
  legacyMigrationAttempted.add(tag);
  const listed = await supermemory.documents.list({
    containerTags: [tag],
    limit: 500,
    sort: "createdAt",
    order: "desc",
  });
  const docs = ((listed as { memories?: Doc[] }).memories ?? []).filter(
    (doc) =>
      doc.metadata?.triggerMode === "context" &&
      typeof doc.metadata?.canonicalEventId !== "string" &&
      typeof doc.metadata?.canonicalProspectiveId !== "string",
  );
  const space = spaceFromTag(tag);
  const ledger = getMemoryEventLedger();
  for (const doc of docs) {
    const got = (await supermemory.documents.get(doc.id).catch(() => null)) as {
      content?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
    const metadata = (got?.metadata ?? doc.metadata ?? {}) as Record<string, unknown>;
    const topic = typeof metadata.triggerTopic === "string" ? metadata.triggerTopic : "";
    const action =
      typeof metadata.triggerAction === "string"
        ? metadata.triggerAction
        : stripHints(got?.content ?? doc.content ?? doc.title ?? doc.summary ?? "");
    if (!topic.trim() || !action.trim()) continue;
    const created = createCanonicalProspective(
      {
        topic,
        action,
        space,
        source: "recall-prospective#import",
        providerExternalId: doc.id,
        recordedAt:
          doc.createdAt && Number.isFinite(Date.parse(doc.createdAt)) ? doc.createdAt : undefined,
        idempotencyKey: `prospective-import:${doc.id}`,
      },
      ledger,
    );
    await processStateJob(created.stateJob.id, { ledger }).catch(() => null);
    await setLedgerStatus(tag, doc.id, { canonicalProspectiveId: created.trigger.id }).catch(
      () => null,
    );
  }
}

export async function prospectiveTriggers(
  tag: string,
  options: { includeClosed?: boolean; includeSnoozed?: boolean } = {},
): Promise<ProspectiveTrigger[]> {
  await migrateLegacyProviderTriggers(tag).catch(() => null);
  const ledger = getMemoryEventLedger();
  const space = spaceFromTag(tag);
  rebuildProspective(ledger, "local-user", space);
  return ledger
    .listProspective({
      space,
      includeClosed: options.includeClosed,
      includeSnoozed: options.includeSnoozed,
    })
    .map(publicTrigger);
}

export async function createProspectiveTrigger(args: {
  tag: string;
  topic: string;
  action: string;
  source?: string;
  salience?: number;
  idempotencyKey?: string;
}) {
  const ledger = getMemoryEventLedger();
  const created = createCanonicalProspective(
    {
      topic: args.topic,
      action: args.action,
      space: spaceFromTag(args.tag),
      source: args.source,
      idempotencyKey: args.idempotencyKey,
    },
    ledger,
  );
  const [mirrored] = await Promise.all([
    processCaptureJob(created.job.id, ledger),
    processStateJob(created.stateJob.id, { ledger }),
  ]);
  const projection = rebuildProspective(ledger, created.event.userId, created.event.space);
  const trigger = projection.triggers.find((item) => item.id === created.trigger.id) ?? created.trigger;
  if (mirrored.state === "pending" || mirrored.state === "dead") scheduleMemoryReconciliation();
  return {
    id: trigger.providerExternalId ?? trigger.id,
    status: mirrored.state,
    trigger: publicTrigger(trigger),
  };
}

export async function matchProspectiveTrigger(args: {
  tag: string;
  context: string;
  seen?: string[];
}): Promise<ProspectiveMatch | null> {
  const open = await prospectiveTriggers(args.tag);
  return matchProspectiveCandidates(open, args.context, args.seen);
}

function tomorrowEnd(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

export async function updateProspectiveTrigger(args: {
  tag: string;
  id?: string;
  about?: string;
  operation: "fire" | "resolve" | "cancel" | "snooze";
  until?: string;
  reason?: string;
  idempotencyKey?: string;
}) {
  const ledger = getMemoryEventLedger();
  const space = spaceFromTag(args.tag);
  rebuildProspective(ledger, "local-user", space);
  const open = ledger.listProspective({
    space,
    includeSnoozed: true,
  });
  let trigger = args.id ? open.find((item) => item.id === args.id) : undefined;
  if (!trigger && args.about) {
    const query = new Set(tokens(args.about));
    trigger = open
      .map((item) => ({
        item,
        score: tokens(`${item.topic} ${item.action}`).filter((token) => query.has(token)).length,
      }))
      .sort((left, right) => right.score - left.score)
      .find((entry) => entry.score > 0)?.item;
  }
  if (!trigger) return null;
  const transition = transitionCanonicalProspective(
    {
      triggerId: trigger.id,
      operation: args.operation,
      space,
      until: args.operation === "snooze" ? args.until?.trim() || tomorrowEnd() : null,
      reason: args.reason,
      idempotencyKey: args.idempotencyKey,
    },
    ledger,
  );
  if (!transition) return null;
  const [mirrored] = await Promise.all([
    processCaptureJob(transition.job.id, ledger),
    processStateJob(transition.stateJob.id, { ledger }),
  ]);
  const providerId = transition.before.providerExternalId;
  if (providerId) {
    const now = transition.event.recordedAt;
    const patch =
      args.operation === "snooze"
        ? {
            status: "open",
            triggerSnoozedUntil: transition.trigger.snoozedUntil,
            triggerLastActionAt: now,
          }
        : {
            status: args.operation === "cancel" ? "cancelled" : "done",
            completedAt: localToday(),
            triggerOutcome: transition.trigger.outcome,
            triggerLastActionAt: now,
            ...(args.operation === "fire"
              ? {
                  triggerFiredAt: now,
                  triggerFiredReason:
                    args.reason?.slice(0, 240) || `topic ${trigger.topic} returned`,
                }
              : {}),
          };
    await setLedgerStatus(args.tag, providerId, patch).catch(() => null);
  }
  if (mirrored.state === "pending" || mirrored.state === "dead") scheduleMemoryReconciliation();
  return {
    trigger: publicTrigger(transition.trigger),
    operation: args.operation,
    ...(args.operation === "snooze"
      ? { until: transition.trigger.snoozedUntil }
      : { on: localToday() }),
  };
}
