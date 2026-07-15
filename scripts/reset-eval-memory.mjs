import { getMemoryEventLedger } from "../lib/memory/event-ledger.ts";
import { listAllSupermemoryDocuments } from "../lib/memory/legacy-import.ts";
import { supermemory } from "../lib/supermemory.ts";

const documents = await listAllSupermemoryDocuments("eval");
for (let index = 0; index < documents.length; index += 100) {
  const ids = documents.slice(index, index + 100).map((document) => document.id);
  if (ids.length) await supermemory.documents.deleteBulk({ ids });
}
const ledger = getMemoryEventLedger();
const events = ledger.resetEvaluationSpace();
const remaining = await listAllSupermemoryDocuments("eval");
if (remaining.length) {
  throw new Error(`eval reset left ${remaining.length} provider documents behind`);
}
console.log(
  JSON.stringify(
    {
      canonicalEventsRemoved: events,
      providerDocumentsRemoved: documents.length,
      sqliteIntegrity: ledger.stats().integrity,
    },
    null,
    2,
  ),
);
