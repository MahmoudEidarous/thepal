import { CaptureEvidencePayloadSchema, type MemorySpace } from "./contracts";
import { getMemoryEventLedger, type MemoryEventLedger } from "./event-ledger";
import { rebuildProspective } from "./prospective-projector";
import { redactSecrets } from "./redaction";

function normalized(value: string, limit: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}

export function createCanonicalProspective(
  input: {
    topic: string;
    action: string;
    space: MemorySpace;
    userId?: string;
    source?: string;
    sourceEventId?: string | null;
    providerExternalId?: string | null;
    idempotencyKey?: string;
    recordedAt?: string;
  },
  ledger: MemoryEventLedger = getMemoryEventLedger(),
) {
  const userId = input.userId ?? "local-user";
  const topic = normalized(input.topic, 120);
  const action = normalized(input.action, 300);
  if (!topic || !action) throw new Error("topic and action required");
  if (input.sourceEventId) {
    const sourceEvent = ledger.getEvent(input.sourceEventId);
    if (
      !sourceEvent ||
      sourceEvent.tombstonedAt ||
      sourceEvent.userId !== userId ||
      sourceEvent.space !== input.space
    ) {
      throw new Error("prospective source evidence is unavailable");
    }
  }
  const content = `Next time ${topic} comes up, remind me: ${action}`;
  const redaction = redactSecrets(content);
  const safeTopic = redactSecrets(topic).text;
  const safeAction = redactSecrets(action).text;
  const source = input.source ?? "recall-prospective";
  const classification = input.sourceEventId
    ? {
        eventKind: "observation" as const,
        source: {
          actor: "recall" as const,
          channel: "agent" as const,
          trust: "recall_observation" as const,
          label: `${source}#derived`,
        },
      }
    : {
        eventKind: "utterance" as const,
        source: {
          actor: "user" as const,
          channel: source.toLowerCase().includes("voice") ? ("voice" as const) : ("text" as const),
          trust: "user_direct" as const,
          label: source,
        },
      };
  const appended = ledger.appendEvent({
    userId,
    space: input.space,
    kind: classification.eventKind,
    payload: CaptureEvidencePayloadSchema.parse({
      content: redaction.text,
      redacted: redaction.redacted,
      legacySource: classification.source.label,
      requested: { kind: "commitment", due: null },
      prospective: {
        operation: "create",
        triggerId: null,
        topic: safeTopic,
        action: safeAction,
        firePolicy: "once",
        until: null,
        reason: input.sourceEventId ? "derived from an explicit forward-memory request" : null,
        sourceEventId: input.sourceEventId ?? null,
        providerExternalId: input.providerExternalId ?? null,
      },
    }),
    source: classification.source,
    sensitivity: redaction.redacted ? "sensitive" : "normal",
    idempotencyKey: input.idempotencyKey,
    recordedAt: input.recordedAt,
  });
  // Imported/derived forward memories already have a provider document: the
  // original canonical capture. Do not create a second semantic document for
  // the projection event. SQLite still keeps the complete typed evidence.
  if (input.providerExternalId && !appended.receipt.duplicate) {
    // A legacy provider trigger belongs to this imported create event and can
    // be tracked as its mirror, preserving deletion propagation. A trigger
    // derived from a modern capture reuses the source event's mirror, whose
    // unique provider ID cannot and should not be claimed twice.
    if (!input.sourceEventId) {
      ledger.recordSupermemoryMirror({
        eventId: appended.event.id,
        externalId: input.providerExternalId,
        payloadHash: appended.event.payloadHash,
      });
    }
    const claimed = ledger.claimJob(appended.job.id, new Date().toISOString());
    if (claimed) ledger.markJobSucceeded(claimed.id);
  }
  const projection = rebuildProspective(ledger, userId, input.space);
  const trigger = projection.triggers.find((item) => item.createEventId === appended.event.id);
  if (!trigger) throw new Error("prospective trigger was not projected from canonical evidence");
  return { ...appended, trigger };
}

export function transitionCanonicalProspective(
  input: {
    triggerId: string;
    operation: "fire" | "resolve" | "cancel" | "snooze";
    space: MemorySpace;
    userId?: string;
    source?: string;
    until?: string | null;
    reason?: string | null;
    idempotencyKey?: string;
    recordedAt?: string;
  },
  ledger: MemoryEventLedger = getMemoryEventLedger(),
) {
  const userId = input.userId ?? "local-user";
  rebuildProspective(ledger, userId, input.space);
  const trigger = ledger.listProspective({
    userId,
    space: input.space,
    id: input.triggerId,
    includeClosed: true,
    includeSnoozed: true,
  })[0];
  if (!trigger || trigger.status !== "open") return null;
  let until: string | null = null;
  if (input.operation === "snooze") {
    const candidate = input.until?.trim();
    if (!candidate || !Number.isFinite(Date.parse(candidate))) {
      throw new Error("snooze requires an ISO-compatible future instant");
    }
    until = new Date(candidate).toISOString();
  }
  const source = input.source ?? "recall-prospective#lifecycle";
  const label = normalized(source, 200) || "recall-prospective#lifecycle";
  const verb =
    input.operation === "fire"
      ? "Fired"
      : input.operation === "resolve"
        ? "Resolved"
        : input.operation === "cancel"
          ? "Cancelled"
          : "Snoozed";
  const detail = input.operation === "snooze" ? ` until ${until}` : "";
  const content = `${verb} forward memory “${trigger.topic}”${detail}: ${trigger.action}`;
  const redaction = redactSecrets(content);
  const appended = ledger.appendEvent({
    userId,
    space: input.space,
    kind: "observation",
    payload: CaptureEvidencePayloadSchema.parse({
      content: redaction.text,
      redacted: redaction.redacted,
      legacySource: label,
      requested: { kind: "memory", due: null },
      prospective: {
        operation: input.operation,
        triggerId: trigger.id,
        topic: null,
        action: null,
        firePolicy: "once",
        until,
        reason: input.reason ? normalized(input.reason, 500) : null,
        sourceEventId: null,
        providerExternalId: trigger.providerExternalId,
      },
    }),
    source: {
      actor: "recall",
      channel: "agent",
      trust: "recall_observation",
      label,
    },
    sensitivity: redaction.redacted ? "sensitive" : "normal",
    idempotencyKey: input.idempotencyKey,
    recordedAt: input.recordedAt,
  });
  const projection = rebuildProspective(ledger, userId, input.space);
  return {
    ...appended,
    before: trigger,
    trigger: projection.triggers.find((item) => item.id === trigger.id) ?? trigger,
  };
}
