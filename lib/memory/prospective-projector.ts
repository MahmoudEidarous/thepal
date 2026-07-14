import { ProspectiveMemorySchema, type MemorySpace, type ProspectiveMemory } from "./contracts";
import { type MemoryEventLedger } from "./event-ledger";

export const PROSPECTIVE_PROJECTOR_VERSION = "prospective-v1" as const;

export type ProspectiveProjection = {
  triggers: ProspectiveMemory[];
  ignoredEventIds: string[];
};

export function projectProspective(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
): ProspectiveProjection {
  const events = ledger.listActiveEvents(userId, space);
  const activeEventIds = new Set(events.map((event) => event.id));
  const activeEvents = new Map(events.map((event) => [event.id, event]));
  const triggers = new Map<string, ProspectiveMemory>();
  const ignoredEventIds: string[] = [];

  for (const event of events) {
    const evidence = event.payload.prospective;
    if (!evidence) continue;

    if (evidence.operation === "create") {
      if (!evidence.topic || !evidence.action || evidence.triggerId) {
        ignoredEventIds.push(event.id);
        continue;
      }
      const sourceEvent = evidence.sourceEventId
        ? activeEvents.get(evidence.sourceEventId)
        : null;
      const authorized = evidence.sourceEventId
        ? event.source.actor === "recall" &&
          event.source.trust === "recall_observation" &&
          sourceEvent?.source.actor === "user" &&
          sourceEvent.source.trust === "user_direct"
        : event.source.actor === "user" && event.source.trust === "user_direct";
      if (!authorized) {
        ignoredEventIds.push(event.id);
        continue;
      }
      // A derived trigger is only valid while its originating user evidence
      // still exists. Deleting the utterance therefore removes the trigger on
      // replay without mutating history or trusting a stale projection.
      if (evidence.sourceEventId && !activeEventIds.has(evidence.sourceEventId)) {
        ignoredEventIds.push(event.id);
        continue;
      }
      const providerExternalId =
        evidence.providerExternalId ?? ledger.getMirror(event.id)?.externalId ?? null;
      const evidenceEventIds = [
        ...(evidence.sourceEventId ? [evidence.sourceEventId] : []),
        event.id,
      ];
      triggers.set(
        event.id,
        ProspectiveMemorySchema.parse({
          id: event.id,
          userId,
          space,
          createEventId: event.id,
          lastEventId: event.id,
          topic: evidence.topic,
          action: evidence.action,
          firePolicy: "once",
          status: "open",
          outcome: null,
          snoozedUntil: null,
          createdAt: event.recordedAt,
          firedAt: null,
          providerExternalId,
          evidenceEventIds: [...new Set(evidenceEventIds)],
          projectorVersion: PROSPECTIVE_PROJECTOR_VERSION,
        }),
      );
      continue;
    }

    if (!evidence.triggerId) {
      ignoredEventIds.push(event.id);
      continue;
    }
    const trigger = triggers.get(evidence.triggerId);
    if (!trigger || trigger.status !== "open") {
      ignoredEventIds.push(event.id);
      continue;
    }
    const next: ProspectiveMemory = {
      ...trigger,
      lastEventId: event.id,
      evidenceEventIds: [...trigger.evidenceEventIds, event.id],
      providerExternalId: evidence.providerExternalId ?? trigger.providerExternalId,
    };
    if (evidence.operation === "snooze") {
      if (!evidence.until) {
        ignoredEventIds.push(event.id);
        continue;
      }
      next.snoozedUntil = evidence.until;
    } else if (evidence.operation === "fire") {
      next.status = "done";
      next.outcome = "fired";
      next.firedAt = event.recordedAt;
      next.snoozedUntil = null;
    } else if (evidence.operation === "resolve") {
      next.status = "done";
      next.outcome = "resolved";
      next.snoozedUntil = null;
    } else if (evidence.operation === "cancel") {
      next.status = "cancelled";
      next.outcome = "cancelled";
      next.snoozedUntil = null;
    }
    triggers.set(trigger.id, ProspectiveMemorySchema.parse(next));
  }

  return {
    triggers: [...triggers.values()].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    ),
    ignoredEventIds,
  };
}

export function rebuildProspective(
  ledger: MemoryEventLedger,
  userId: string,
  space: MemorySpace,
): ProspectiveProjection {
  const projection = projectProspective(ledger, userId, space);
  ledger.replaceProspectiveProjection(userId, space, projection.triggers);
  return projection;
}
