import { MemoryEventLedger } from "../../lib/memory/event-ledger.ts";

const [databasePath, worker = "0", requested = "1", shared = ""] = process.argv.slice(2);
if (!databasePath) throw new Error("database path required");
const ledger = new MemoryEventLedger({ databasePath });
const receipts = [];
try {
  const count = Math.max(1, Number(requested));
  for (let index = 0; index < count; index += 1) {
    const idempotencyKey = shared || `stress:${worker}:${index}`;
    const appended = ledger.appendEvent({
      userId: "stress-user",
      space: "eval",
      kind: "utterance",
      payload: {
        content: `worker ${worker} event ${index}`,
        redacted: false,
        legacySource: "stress",
        requested: { kind: "memory", due: null },
      },
      source: {
        actor: "user",
        channel: "text",
        trust: "user_direct",
        label: "stress",
      },
      sensitivity: "normal",
      idempotencyKey,
    });
    receipts.push({ eventId: appended.event.id, duplicate: appended.receipt.duplicate });
  }
  process.stdout.write(JSON.stringify(receipts));
} finally {
  ledger.close();
}
