import { createHash } from "node:crypto";
import { rebuildBeliefs } from "./belief-projector";
import {
  CaptureEvidencePayloadSchema,
  type CaptureEvidencePayload,
  type MemoryEvent,
  type MemorySpace,
  type MemorySource,
  type RequestedMemoryKind,
  type Sensitivity,
} from "./contracts";
import { type MemoryEventLedger } from "./event-ledger";
import { extractClaimsForEvents } from "./extractor";
import { rebuildProspective } from "./prospective-projector";
import { rebuildThreads } from "./thread-engine";

export const LEGACY_IMPORT_VERSION = "supermemory-legacy-v1" as const;

type ProviderMetadata = Record<string, unknown>;

export type LegacyProviderDocument = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status: string;
  content: string;
  title?: string | null;
  summary?: string | null;
  metadata: ProviderMetadata;
};

export type LegacyImportAction = "import" | "already_canonical" | "skip" | "blocked";

export type LegacyImportPlanItem = {
  externalId: string;
  createdAt: string;
  action: LegacyImportAction;
  reason: string;
  canonicalEventId: string | null;
  revisionExternalId: string | null;
  eventKind: MemoryEvent["kind"] | null;
  source: MemorySource | null;
  sensitivity: Sensitivity | null;
  payload: CaptureEvidencePayload | null;
};

export type LegacyImportPlan = {
  version: typeof LEGACY_IMPORT_VERSION;
  userId: string;
  space: MemorySpace;
  generatedAt: string;
  documents: number;
  counts: Record<LegacyImportAction, number>;
  items: LegacyImportPlanItem[];
};

function metadata(value: unknown): ProviderMetadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProviderMetadata)
    : {};
}

function text(value: unknown, limit = 4_000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]),
  );
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function stripHints(value: string) {
  return value.split("\n\n(answers:")[0].trim();
}

function sourceFor(meta: ProviderMetadata): {
  eventKind: MemoryEvent["kind"];
  source: MemorySource;
} {
  const label = text(meta.source, 200) ?? "legacy-supermemory";
  const lower = label.toLowerCase();
  const type = (text(meta.type, 120) ?? "memory").toLowerCase();
  const provenance = (text(meta.provenance, 120) ?? "").toLowerCase();
  if (
    type === "impression" ||
    provenance === "inferred" ||
    lower === "recall-ledger" ||
    lower.startsWith("recall-agent") ||
    lower.includes("dream")
  ) {
    return {
      eventKind: "observation",
      source: { actor: "recall", channel: "agent", trust: "recall_observation", label },
    };
  }
  if (lower.startsWith("drop:")) {
    return {
      eventKind: "document_quote",
      source: { actor: "external", channel: "document", trust: "user_approved", label },
    };
  }
  if (lower.includes("web")) {
    return {
      eventKind: "document_quote",
      source: { actor: "external", channel: "web", trust: "external_content", label },
    };
  }
  return {
    eventKind: "utterance",
    source: {
      actor: "user",
      channel: lower.includes("voice") ? "voice" : "text",
      trust: "user_direct",
      label,
    },
  };
}

function requestedKind(meta: ProviderMetadata): RequestedMemoryKind {
  const type = (text(meta.type, 120) ?? "memory").toLowerCase();
  if (type === "decision") return "decision";
  // A historical provider commitment is current only when its explicit
  // lifecycle status remains open. Missing/closed state is history, not a task.
  if (type === "commitment" && meta.status === "open") return "commitment";
  return "memory";
}

function sensitivityFor(meta: ProviderMetadata): Sensitivity {
  if (meta.sensitivity === "restricted") return "restricted";
  if (meta.sensitivity === "sensitive" || meta.redacted === true) return "sensitive";
  return "normal";
}

export async function listAllSupermemoryDocuments(
  space: MemorySpace,
): Promise<LegacyProviderDocument[]> {
  // Keep the pure migration planner usable in deterministic tests that do not
  // have provider credentials. Only the live listing boundary loads the client.
  const { spaceTag, supermemory } = await import("../supermemory");
  const documents = new Map<string, LegacyProviderDocument>();
  for (let page = 1; ; page += 1) {
    const response = await supermemory.documents.list({
      containerTags: [spaceTag(space)],
      limit: 100,
      page,
      sort: "createdAt",
      order: "asc",
      includeContent: true,
    });
    for (const document of response.memories) {
      let content = document.content ?? document.summary ?? document.title ?? "";
      if (!content) {
        const hydrated = (await supermemory.documents.get(document.id).catch(() => null)) as {
          content?: string | null;
        } | null;
        content = hydrated?.content ?? "";
      }
      documents.set(document.id, {
        id: document.id,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        status: document.status,
        content,
        title: document.title,
        summary: document.summary,
        metadata: metadata(document.metadata),
      });
    }
    if (page >= response.pagination.totalPages) break;
  }
  return [...documents.values()].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function planLegacyImport(input: {
  documents: LegacyProviderDocument[];
  ledger: MemoryEventLedger;
  userId?: string;
  space?: MemorySpace;
  at?: string;
}): LegacyImportPlan {
  const userId = input.userId ?? "local-user";
  const space = input.space ?? "personal";
  const adopted = new Map(
    input.ledger
      .listActiveEvents(userId, space)
      .flatMap((event) =>
        event.payload.legacyImport?.provider === "supermemory"
          ? [[event.payload.legacyImport.externalId, event.id] as const]
          : [],
      ),
  );
  const items = input.documents.map((document): LegacyImportPlanItem => {
    const meta = metadata(document.metadata);
    const adoptedEventId = adopted.get(document.id);
    if (adoptedEventId) {
      return {
        externalId: document.id,
        createdAt: document.createdAt,
        action: "already_canonical",
        reason: "provider document is already adopted by the canonical ledger",
        canonicalEventId: adoptedEventId,
        revisionExternalId: null,
        eventKind: null,
        source: null,
        sensitivity: null,
        payload: null,
      };
    }
    const canonicalEventId = text(meta.canonicalEventId, 160);
    if (canonicalEventId) {
      const event = input.ledger.getEvent(canonicalEventId);
      return {
        externalId: document.id,
        createdAt: document.createdAt,
        action: event ? "already_canonical" : "blocked",
        reason: event
          ? "provider document already has a canonical event"
          : "provider claims a canonical event that is missing locally",
        canonicalEventId,
        revisionExternalId: null,
        eventKind: null,
        source: null,
        sensitivity: null,
        payload: null,
      };
    }
    const sourceLabel = text(meta.source, 200) ?? "legacy-supermemory";
    const originalType = text(meta.type, 120) ?? "memory";
    if (originalType === "briefing" || sourceLabel.toLowerCase().startsWith("recall-agent")) {
      return {
        externalId: document.id,
        createdAt: document.createdAt,
        action: "skip",
        reason: "generated briefing is rebuildable output, not user evidence",
        canonicalEventId: null,
        revisionExternalId: null,
        eventKind: null,
        source: null,
        sensitivity: null,
        payload: null,
      };
    }
    if (sourceLabel.toLowerCase().includes("#ledger")) {
      return {
        externalId: document.id,
        createdAt: document.createdAt,
        action: "skip",
        reason: "embedded ledger document is derived from its parent telling",
        canonicalEventId: null,
        revisionExternalId: null,
        eventKind: null,
        source: null,
        sensitivity: null,
        payload: null,
      };
    }
    if (document.status !== "done") {
      return {
        externalId: document.id,
        createdAt: document.createdAt,
        action: "blocked",
        reason: `provider document is not settled (${document.status})`,
        canonicalEventId: null,
        revisionExternalId: null,
        eventKind: null,
        source: null,
        sensitivity: null,
        payload: null,
      };
    }
    const content = stripHints(document.content).trim();
    if (!content) {
      return {
        externalId: document.id,
        createdAt: document.createdAt,
        action: "skip",
        reason: "provider document has no evidence text",
        canonicalEventId: null,
        revisionExternalId: null,
        eventKind: null,
        source: null,
        sensitivity: null,
        payload: null,
      };
    }
    const classified = sourceFor(meta);
    const kind = requestedKind(meta);
    const due = kind === "commitment" ? text(meta.due, 64) : null;
    const payload = CaptureEvidencePayloadSchema.parse({
      content,
      redacted: meta.redacted === true,
      legacySource: sourceLabel,
      requested: { kind, due },
      legacyImport: {
        provider: "supermemory",
        externalId: document.id,
        originalType,
        originalProvenance: text(meta.provenance, 120),
        originalStatus: text(meta.status, 120),
        originalStoryDate: text(meta.storyDate, 80),
        originalEntities: text(meta.entities, 4_000),
        originalMetadataHash: hash(meta),
      },
    });
    return {
      externalId: document.id,
      createdAt: document.createdAt,
      action: "import",
      reason: "settled legacy evidence will adopt its existing semantic mirror",
      canonicalEventId: null,
      revisionExternalId: text(meta.updates, 500),
      eventKind: classified.eventKind,
      source: classified.source,
      sensitivity: sensitivityFor(meta),
      payload,
    };
  });
  const counts: Record<LegacyImportAction, number> = {
    import: 0,
    already_canonical: 0,
    skip: 0,
    blocked: 0,
  };
  for (const item of items) counts[item.action] += 1;
  return {
    version: LEGACY_IMPORT_VERSION,
    userId,
    space,
    generatedAt: input.at ?? new Date().toISOString(),
    documents: items.length,
    counts,
    items,
  };
}

async function extractWithRetry(
  events: MemoryEvent[],
  extractor: typeof extractClaimsForEvents,
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await extractor(events);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

export async function applyLegacyImport(input: {
  plan: LegacyImportPlan;
  ledger: MemoryEventLedger;
  extractor?: typeof extractClaimsForEvents;
  onProgress?: (progress: {
    stage: "adopt" | "extract";
    completed: number;
    total: number;
  }) => void;
}) {
  if (input.plan.counts.blocked > 0) {
    throw new Error(`legacy import has ${input.plan.counts.blocked} blocked documents`);
  }
  const extractor = input.extractor ?? extractClaimsForEvents;
  const externalToEvent = new Map<string, string>();
  for (const item of input.plan.items) {
    if (item.action === "already_canonical" && item.canonicalEventId) {
      externalToEvent.set(item.externalId, item.canonicalEventId);
    }
  }
  const imported: MemoryEvent[] = [];
  const candidates = input.plan.items.filter((item) => item.action === "import");
  for (const [index, item] of candidates.entries()) {
    if (!item.payload || !item.source || !item.sensitivity || !item.eventKind) {
      throw new Error(`legacy import plan for ${item.externalId} is incomplete`);
    }
    const revisionOf = item.revisionExternalId
      ? externalToEvent.get(item.revisionExternalId) ?? null
      : null;
    const appended = input.ledger.appendEvent({
      userId: input.plan.userId,
      space: input.plan.space,
      kind: revisionOf ? "correction" : item.eventKind,
      payload: item.payload,
      source: item.source,
      sensitivity: item.sensitivity,
      revisionOf,
      idempotencyKey: `${LEGACY_IMPORT_VERSION}:${item.externalId}`,
      recordedAt: item.createdAt,
    });
    input.ledger.adoptExistingSupermemoryMirror({
      eventId: appended.event.id,
      externalId: item.externalId,
      payloadHash: appended.event.payloadHash,
      syncedAt: item.createdAt,
    });
    externalToEvent.set(item.externalId, appended.event.id);
    imported.push(appended.event);
    input.onProgress?.({ stage: "adopt", completed: index + 1, total: candidates.length });
  }

  // A failed archival extraction must be resumable without changing provider
  // identity or appending duplicate evidence. Include previously adopted
  // legacy events whose projection job is still incomplete.
  const resumable = input.plan.items.flatMap((item) => {
    if (item.action !== "already_canonical" || !item.canonicalEventId) return [];
    const event = input.ledger.getEvent(item.canonicalEventId);
    return event?.payload.legacyImport?.provider === "supermemory" ? [event] : [];
  });
  const projectionEvents = [...new Map([...imported, ...resumable].map((event) => [event.id, event])).values()];
  const pending = projectionEvents.filter(
    (event) =>
      input.ledger.getStateJobForEvent(event.id, "extract_and_project")?.status !== "succeeded",
  );
  let extracted = 0;
  let claimCount = 0;
  for (let index = 0; index < pending.length; index += 6) {
    const batch = pending.slice(index, index + 6);
    const claims = await extractWithRetry(batch, extractor);
    for (const event of batch) {
      const eventClaims = claims.get(event.id) ?? [];
      input.ledger.replaceClaimsForEvent(event.id, eventClaims);
      input.ledger.completeImportedProjection(event.id);
      claimCount += eventClaims.length;
      extracted += 1;
    }
    input.onProgress?.({ stage: "extract", completed: extracted, total: pending.length });
  }

  const beliefs = rebuildBeliefs(input.ledger, input.plan.userId, input.plan.space);
  const threads = rebuildThreads(input.ledger, input.plan.userId, input.plan.space);
  const prospective = rebuildProspective(input.ledger, input.plan.userId, input.plan.space);
  input.ledger.invalidateContinuityKernel(input.plan.userId, input.plan.space);
  return {
    imported: imported.length,
    projected: pending.length,
    claims: claimCount,
    beliefs: beliefs.beliefs.length,
    threads: threads.threads.length,
    prospective: prospective.triggers.length,
  };
}
