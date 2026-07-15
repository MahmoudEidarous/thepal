import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureEvidencePayloadSchema } from "../lib/memory/contracts.ts";
import { MemoryEventLedger } from "../lib/memory/event-ledger.ts";
import { materializeClaimCandidates } from "../lib/memory/extractor.ts";
import { applyLegacyImport, planLegacyImport } from "../lib/memory/legacy-import.ts";

const directory = mkdtempSync(join(tmpdir(), "recall-legacy-import-"));
const ledger = new MemoryEventLedger({ databasePath: join(directory, "memory.sqlite") });
const AT = "2026-01-10T12:00:00.000Z";
let checks = 0;

function check(condition, label) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`✅  ${label}`);
}

function document(id, content, metadata = {}, overrides = {}) {
  return {
    id,
    content,
    createdAt: overrides.createdAt ?? AT,
    updatedAt: overrides.createdAt ?? AT,
    status: overrides.status ?? "done",
    title: null,
    summary: null,
    metadata,
  };
}

function seedCanonical() {
  const payload = CaptureEvidencePayloadSchema.parse({
    content: "I already live in canonical memory.",
    redacted: false,
    legacySource: "recall-app",
    requested: { kind: "memory", due: null },
  });
  const appended = ledger.appendEvent({
    userId: "local-user",
    space: "personal",
    kind: "utterance",
    payload,
    source: { actor: "user", channel: "text", trust: "user_direct", label: "recall-app" },
    sensitivity: "normal",
    idempotencyKey: "existing",
    recordedAt: "2026-01-01T12:00:00.000Z",
  });
  ledger.adoptExistingSupermemoryMirror({
    eventId: appended.event.id,
    externalId: "provider-existing",
    payloadHash: appended.event.payloadHash,
  });
  return appended.event;
}

const existing = seedCanonical();
const documents = [
  document("provider-existing", "already", { canonicalEventId: existing.id, type: "fact", source: "recall-app" }),
  document("provider-fact", "I prefer mint tea.", { type: "taste", source: "recall-app", provenance: "stated" }),
  document("provider-impression", "Mahmoud may be tired after launches.", { type: "impression", source: "recall-app", provenance: "inferred" }, { createdAt: "2026-01-02T12:00:00.000Z" }),
  document("provider-open", "Send Layla the proposal.", { type: "commitment", source: "recall-voice", status: "open", due: "2026-02-01" }, { createdAt: "2026-01-03T12:00:00.000Z" }),
  document("provider-closed", "Book the train.", { type: "commitment", source: "recall-app", status: "done" }, { createdAt: "2026-01-04T12:00:00.000Z" }),
  document("provider-drop", "The Berlin notes say launch is Monday.", { type: "fact", source: "drop:berlin.md", provenance: "stated" }, { createdAt: "2026-01-05T12:00:00.000Z" }),
  document("provider-ledger", "Send Layla the proposal.", { type: "commitment", source: "recall-app#ledger", status: "open" }),
  document("provider-briefing", "Generated morning summary", { type: "briefing", source: "recall-agent" }),
];

const plan = planLegacyImport({ documents, ledger, space: "personal", at: AT });
check(plan.documents === 8, "dry-run accounts for every provider document");
check(plan.counts.import === 5, "dry-run selects only evidence-bearing legacy documents");
check(plan.counts.already_canonical === 1, "existing canonical mirror is recognized");
check(plan.counts.skip === 2, "derived ledger and briefing output are skipped");
check(plan.counts.blocked === 0, "settled fixture has no blockers");
const impression = plan.items.find((item) => item.externalId === "provider-impression");
check(impression?.eventKind === "observation", "legacy impressions remain Recall observations");
check(impression?.source?.trust === "recall_observation", "inference never gains user authority");
const fact = plan.items.find((item) => item.externalId === "provider-fact");
check(fact?.source?.trust === "user_direct", "direct app telling preserves user authority");
const open = plan.items.find((item) => item.externalId === "provider-open");
check(open?.payload?.requested.kind === "commitment", "explicitly open commitment stays actionable");
check(open?.payload?.requested.due === "2026-02-01", "open commitment preserves its due date");
const closed = plan.items.find((item) => item.externalId === "provider-closed");
check(closed?.payload?.requested.kind === "memory", "closed commitment imports only as history");
const drop = plan.items.find((item) => item.externalId === "provider-drop");
check(drop?.eventKind === "document_quote", "approved document remains quoted evidence");
check(drop?.source?.trust === "user_approved", "document import cannot impersonate direct speech");
check(fact?.payload?.legacyImport?.externalId === "provider-fact", "event preserves provider provenance");
check(!!fact?.payload?.legacyImport?.originalMetadataHash, "event preserves an auditable metadata hash");

const failedPlan = planLegacyImport({
  documents: [document("provider-failed", "failed", { type: "fact", source: "recall-app" }, { status: "failed" })],
  ledger,
  space: "personal",
});
check(failedPlan.counts.blocked === 1, "unsettled provider documents block migration");

const extractor = async (events) =>
  new Map(
    events.map((event) => [
      event.id,
      event.payload.content.includes("mint tea")
        ? materializeClaimCandidates(event, [
            {
              subject: { kind: "user", label: "the user" },
              predicate: "preference",
              object: { type: "string", value: "mint tea" },
              polarity: 1,
              modality: "asserted",
              relationHint: "assert",
              validTime: null,
              contexts: [],
            },
          ])
        : [],
    ]),
  );

const before = ledger.stats().events;
const applied = await applyLegacyImport({ plan, ledger, extractor });
check(applied.imported === 5, "apply adopts every planned document");
check(applied.projected === 5, "apply completes every imported projection");
check(ledger.stats().events === before + 5, "apply appends exactly one event per document");
const importedFact = ledger
  .listActiveEvents("local-user", "personal")
  .find((event) => event.payload.legacyImport?.externalId === "provider-fact");
check(!!importedFact, "provider identity resolves to a canonical event");
check(ledger.getMirror(importedFact.id)?.externalId === "provider-fact", "existing provider document becomes the mirror");
check(ledger.getJob(ledger.getStateJobForEvent(importedFact.id, "extract_and_project")?.id ?? "") === null, "state and mirror jobs remain distinct");
check(ledger.getStateJobForEvent(importedFact.id, "extract_and_project")?.status === "succeeded", "imported projection job is complete");
check(ledger.listClaimsForEvent(importedFact.id).length === 1, "batched extraction stores evidence-local claims");
check(ledger.listBeliefs({ userId: "local-user", space: "personal" }).length === 1, "one final replay materializes beliefs");
const importedImpression = ledger
  .listActiveEvents("local-user", "personal")
  .find((event) => event.payload.legacyImport?.externalId === "provider-impression");
check(importedImpression?.source.trust === "recall_observation", "stored impression remains low-authority");

await applyLegacyImport({ plan, ledger, extractor });
check(ledger.stats().events === before + 5, "re-running migration is idempotent");
check(ledger.listActiveEvents("local-user", "personal").filter((event) => event.payload.legacyImport).length === 5, "idempotency holds across every imported provider ID");

const openEnded = materializeClaimCandidates(importedFact, [
  {
    subject: { kind: "person", label: "Layla" },
    predicate: "location",
    object: { type: "string", value: "Toronto" },
    polarity: 1,
    modality: "asserted",
    relationHint: "assert",
    validTime: { start: null, end: "2026-12-31", precision: "month" },
    contexts: [],
  },
]);
check(openEnded[0]?.validTime?.start === "2026-01-10", "open-ended model time is anchored to evidence time");

const resumeDocument = document("provider-resume", "The launch is still planned.", {
  type: "fact",
  source: "recall-app",
});
const resumePlan = planLegacyImport({ documents: [resumeDocument], ledger, space: "personal", at: AT });
const resumeItem = resumePlan.items[0];
const partial = ledger.appendEvent({
  userId: resumePlan.userId,
  space: resumePlan.space,
  kind: resumeItem.eventKind,
  payload: resumeItem.payload,
  source: resumeItem.source,
  sensitivity: resumeItem.sensitivity,
  idempotencyKey: `supermemory-legacy-v1:${resumeItem.externalId}`,
  recordedAt: resumeItem.createdAt,
});
ledger.adoptExistingSupermemoryMirror({
  eventId: partial.event.id,
  externalId: resumeItem.externalId,
  payloadHash: partial.event.payloadHash,
});
const resumedPlan = planLegacyImport({ documents: [resumeDocument], ledger, space: "personal", at: AT });
const resumed = await applyLegacyImport({ plan: resumedPlan, ledger, extractor });
check(resumed.imported === 0 && resumed.projected === 1, "interrupted projection resumes without duplicating evidence");
check(ledger.getStateJobForEvent(partial.event.id, "extract_and_project")?.status === "succeeded", "resumed projection reaches succeeded state");

const evalPayload = CaptureEvidencePayloadSchema.parse({
  content: "quarantined eval",
  redacted: false,
  legacySource: "fixture",
  requested: { kind: "memory", due: null },
});
ledger.appendEvent({
  userId: "fixture-user",
  space: "eval",
  kind: "utterance",
  payload: evalPayload,
  source: { actor: "user", channel: "text", trust: "user_direct", label: "fixture" },
  sensitivity: "normal",
});
check(ledger.operationalQueueStats(["eval"]).jobs.pending === 1, "eval work is measurable separately");
check(ledger.operationalQueueStats(["personal", "work", "health"]).jobs.pending === 0, "user health excludes eval queues");
check(ledger.resetEvaluationSpace() === 1, "eval reset removes quarantined canonical residue");
check(ledger.listActiveEvents("local-user", "personal").length === before + 6, "eval reset cannot touch personal history");
check(ledger.stats().integrity === "ok", "legacy import preserves SQLite integrity");

ledger.close();
rmSync(directory, { recursive: true, force: true });
console.log(`\n${checks} memory-legacy checks passed`);
