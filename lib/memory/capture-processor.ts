import { enrich, localToday, type Envelope } from "@/lib/envelope";
import { fusedRecall, invalidateCorpus, type Hit } from "@/lib/fusion";
import { openCommitments, setLedgerStatus } from "@/lib/ledger";
import { spaceTag, supermemory, type Space } from "@/lib/supermemory";
import { MEMORY_CONTRACT_VERSION, type Sensitivity, type TrustTier } from "./contracts";

const CHANGE_HINT =
  /\b(actually|instead|no longer|not anymore|anymore|moved|moving|changed|switch(ed)?|turns out|correction|scratch|forget (that|the|it)|never ?mind|new plan|re-?decided|decided on|going with|went with|settled on|updat(e|ed|ing)|wrong|after all|from now on|these days|now)\b/i;

type Conflict = { id: string; text: string; told: string | null };

export type CaptureProcessorInput = {
  eventId?: string;
  payloadHash?: string;
  recordedAt?: string;
  trust?: TrustTier;
  sensitivity?: Sensitivity;
  content: string;
  preRedacted: boolean;
  source: string;
  space: Space;
  kind: "memory" | "decision" | "commitment" | "briefing";
  due?: string;
};

type CanonicalCaptureProcessorInput = CaptureProcessorInput & {
  eventId: string;
  payloadHash: string;
  recordedAt: string;
  trust: TrustTier;
  sensitivity: Sensitivity;
};

type CaptureAnalysis = {
  envelope: Envelope | null;
  conflict: Conflict | null;
  openLedger: Awaited<ReturnType<typeof openCommitments>>;
  supersededIndex: number | null;
};

export async function findCanonicalSupermemoryMirror(
  space: Space,
  eventId: string,
): Promise<string | null> {
  const listed = await supermemory.documents.list({
    containerTags: [spaceTag(space)],
    limit: 500,
    sort: "createdAt",
    order: "desc",
  });
  const documents = (
    listed as {
      memories?: Array<{ id: string; metadata?: Record<string, unknown> | null }>;
    }
  ).memories;
  return (
    documents?.find((document) => document.metadata?.canonicalEventId === eventId)?.id ?? null
  );
}

function findConflict(probe: Hit[], newText: string, envelope: Envelope | null): Conflict | null {
  if (envelope?.type === "commitment" || typeof envelope?.supersedes === "number") return null;
  const changeSpoken = CHANGE_HINT.test(newText);
  const entityNames = (envelope?.entities ?? [])
    .flatMap((entity) => [entity.name, ...entity.aliases])
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 2);
  let best: (Conflict & { similarity: number }) | null = null;
  for (const candidate of probe) {
    if (
      !candidate.memory ||
      /^(Done|Cancelled):/.test(candidate.memory) ||
      /^Good morning/i.test(candidate.memory)
    ) {
      continue;
    }
    const entityOverlap = entityNames.some((name) =>
      candidate.memory.toLowerCase().includes(name),
    );
    const qualifies = changeSpoken
      ? (entityOverlap && candidate.similarity >= 0.6) || candidate.similarity >= 0.74
      : candidate.similarity >= 0.82;
    if (!qualifies) continue;
    if (!best || candidate.similarity > best.similarity) {
      best = {
        id: candidate.documentId,
        text: candidate.memory.slice(0, 200),
        told: candidate.createdAt,
        similarity: candidate.similarity,
      };
    }
  }
  return best ? { id: best.id, text: best.text, told: best.told } : null;
}

export async function analyzeCapture(input: CaptureProcessorInput): Promise<CaptureAnalysis> {
  const probePromise: Promise<Hit[]> = fusedRecall({
    q: input.content.slice(0, 300),
    space: input.space,
    limit: 6,
    excludeUnlisted: true,
  }).catch(() => []);
  const openLedger = await openCommitments(spaceTag(input.space)).catch(() => []);
  const envelope = await enrich(
    input.content,
    input.source,
    localToday(),
    openLedger.map((commitment) => commitment.content),
  );
  const semanticConflict = findConflict(await probePromise, input.content, envelope);
  const supersededIndex =
    typeof envelope?.supersedes === "number" ? envelope.supersedes : null;
  const priorCommitment =
    supersededIndex !== null && supersededIndex >= 1 && supersededIndex <= openLedger.length
      ? openLedger[supersededIndex - 1]
      : null;
  const conflict =
    semanticConflict ??
    (priorCommitment
      ? {
          id: priorCommitment.id,
          text: priorCommitment.content,
          told: priorCommitment.createdAt,
        }
      : null);
  return { envelope, conflict, openLedger, supersededIndex };
}

async function processCapture(input: CaptureProcessorInput) {
  const ledgerLifecycleEvent =
    input.source.startsWith("recall-ledger#user-confirmed") &&
    /^\s*(Done|Cancelled|Canceled):/i.test(input.content);
  const analysis = await analyzeCapture(input);
  const { envelope, openLedger } = analysis;
  const conflict = ledgerLifecycleEvent ? null : analysis.conflict;
  const supersededIndex = ledgerLifecycleEvent ? null : analysis.supersededIndex;
  const commitmentEvent =
    !ledgerLifecycleEvent &&
    (envelope?.type === "commitment" ||
      input.kind === "commitment" ||
      typeof envelope?.supersedes === "number");
  const hints = envelope?.hints?.length ? `\n\n(answers: ${envelope.hints.join(" · ")})` : "";
  const content = (input.content.length > 800 ? input.content : (envelope?.text ?? input.content)) + hints;
  const canonicalMetadata: Record<string, string | number> = {};
  if (input.eventId && input.payloadHash && input.recordedAt && input.trust) {
    Object.assign(canonicalMetadata, {
      canonicalEventId: input.eventId,
      canonicalPayloadHash: input.payloadHash,
      canonicalRecordedAt: input.recordedAt,
      canonicalTrustTier: input.trust,
      canonicalSensitivity: input.sensitivity ?? "normal",
      memoryContractVersion: MEMORY_CONTRACT_VERSION,
    });
  }

  const document = await supermemory.add({
    content,
    containerTag: spaceTag(input.space),
    metadata: {
      source: input.source,
      type: ledgerLifecycleEvent ? "event" : (envelope?.type ?? input.kind),
      provenance: envelope?.provenance ?? "stated",
      salience: envelope?.salience ?? 0.5,
      valence: envelope?.valence ?? 0,
      intensity: envelope?.intensity ?? 0,
      redacted: envelope?.redacted || input.preRedacted,
      ...canonicalMetadata,
      ...(envelope?.hints?.length ? { hints: envelope.hints.join(" · ") } : {}),
      ...(envelope?.storyDate ? { storyDate: envelope.storyDate } : {}),
      ...(envelope?.entities?.length
        ? {
            entities: envelope.entities
              .map(
                (entity) =>
                  `${[entity.name, ...entity.aliases].join("/")}#${entity.kind ?? "thing"}`,
              )
              .join(", "),
          }
        : {}),
      ...(commitmentEvent
        ? {
            status: "open",
            ...(envelope?.due ?? input.due ? { due: envelope?.due ?? input.due } : {}),
          }
        : {}),
      ...(envelope?.prospective
        ? {
            triggerMode: "context",
            triggerTopic: envelope.prospective.topic.slice(0, 120),
            triggerAction: envelope.prospective.action.slice(0, 300),
            triggerFirePolicy: envelope.prospective.firePolicy,
            triggerCreatedAt: new Date().toISOString(),
          }
        : {}),
      ...(conflict
        ? {
            updates: conflict.id,
            updatesText: conflict.text.slice(0, 140),
            ...(conflict.told ? { updatesTold: conflict.told } : {}),
          }
        : {}),
    },
  });

  let superseded: string | null = null;
  if (
    supersededIndex !== null &&
    supersededIndex >= 1 &&
    supersededIndex <= openLedger.length
  ) {
    const old = openLedger[supersededIndex - 1];
    await setLedgerStatus(spaceTag(input.space), old.id, {
      status: "superseded",
      supersededAt: localToday(),
      supersededBy: document.id,
    }).catch(() => {});
    superseded = old.content;
  }

  const embedded = (ledgerLifecycleEvent ? [] : (envelope?.commitments ?? [])).filter(
    (commitment) => commitment.content.trim() && envelope?.type !== "commitment",
  );
  await Promise.all(
    embedded.map((commitment) =>
      supermemory
        .add({
          content: commitment.content.trim(),
          containerTag: spaceTag(input.space),
          metadata: {
            source: `${input.source}#ledger`,
            type: "commitment",
            provenance: envelope?.provenance ?? "stated",
            salience: 0.8,
            status: "open",
            ...(input.eventId ? { derivedFromEventId: input.eventId } : {}),
            ...(input.trust ? { canonicalTrustTier: input.trust } : {}),
            ...(commitment.due ? { due: commitment.due } : {}),
          },
        })
        .catch(() => null),
    ),
  );

  invalidateCorpus(input.space);
  return {
    externalId: document.id,
    response: {
      ...document,
      envelope: envelope ?? undefined,
      ...(superseded ? { superseded } : {}),
      ...(conflict ? { conflict } : {}),
    },
  };
}

export function processCaptureEvent(input: CanonicalCaptureProcessorInput) {
  return processCapture(input);
}

export function processLegacyCapture(input: CaptureProcessorInput) {
  return processCapture(input);
}
