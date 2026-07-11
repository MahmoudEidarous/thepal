// Post-seed janitor. Waits for the supermemory ingest queue to drain,
// then: re-ingests permanently-failed docs (their memories were never
// extracted), completes the seeded kept-commitments (metadata PATCHes
// don't stick while a doc is processing), and removes raw duplicates.
// Emits one progress line per state change — quiet otherwise.
const BASE = process.argv[2] ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[fixup] ${m}`);

const KEPT = ["Book the movers", "Vodafone", "hackathon registration", "April invoices"];

async function caps() {
  return (await fetch(`${BASE}/api/captures`).then((r) => r.json())).captures ?? [];
}
async function del(id) {
  const r = await fetch(`${BASE}/api/document`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return r.ok;
}

// 1 — wait for the queue
let lastQueued = -1;
for (let i = 0; i < 60; i++) {
  const cs = await caps();
  const queued = cs.filter((c) => c.status === "queued").length;
  if (queued !== lastQueued && (queued % 10 === 0 || queued < 5)) {
    say(`queue: ${queued} left`);
    lastQueued = queued;
  }
  if (queued === 0) break;
  await sleep(120_000);
}
say("queue drained");

// 2 — re-ingest permanently failed docs
const failed = (await caps()).filter((c) => c.status === "failed");
say(`re-ingesting ${failed.length} failed doc(s)`);
for (const f of failed) {
  if (!(await del(f.id))) {
    say(`could not delete failed doc: ${f.text.slice(0, 40)}`);
    continue;
  }
  const r = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: f.text, source: "recall-app" }),
  }).then((x) => x.json());
  say(`re-ingested ${r.envelope?.type ?? "raw"} — ${f.text.slice(0, 44)}`);
  await sleep(2000);
}

// 3 — complete the kept commitments, verify the status actually stuck
for (let round = 0; round < 10; round++) {
  const cs = await caps();
  const open = KEPT.filter((t) =>
    cs.some((c) => c.text.includes(t) && c.meta.type === "commitment" && c.meta.status === "open"),
  );
  if (!open.length) break;
  for (const t of open) {
    const c = cs.find(
      (x) => x.text.includes(t) && x.meta.type === "commitment" && x.meta.status === "open",
    );
    await fetch(`${BASE}/api/agenda/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id }),
    });
  }
  await sleep(20_000);
}
say("kept commitments completed");

// 4 — raw duplicates (enrichment fallbacks that were later re-captured)
const raws = (await caps()).filter(
  (c) => c.meta.type === "memory" && c.text.includes("more confident"),
);
for (const rdoc of raws) say((await del(rdoc.id)) ? "raw duplicate removed" : "raw dupe still locked");

const final = await caps();
const st = {};
final.forEach((c) => (st[c.status ?? "?"] = (st[c.status ?? "?"] ?? 0) + 1));
const ledger = await fetch(`${BASE}/api/ledger`).then((r) => r.json());
say(
  `DONE — ${final.length} captures ${JSON.stringify(st)} · ledger open ${ledger.open.length} done ${ledger.done.length}`,
);
