// Drip re-ingestion supervisor. The local supermemory server processes
// ~1 doc/min and permanently fails anything that sits queued past its
// stuck-threshold — so bulk re-adds always lose their tail. This keeps
// the queue shallow instead: re-ingest failed docs a dozen at a time,
// only when the queue is nearly empty, until everything is processed.
// Then completes the seeded kept-commitments (metadata PATCHes only
// stick on processed docs) and removes raw duplicates. Logs sparsely.
const BASE = process.argv[2] ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[drip] ${m}`);

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
async function recapture(text) {
  for (let i = 0; i < 3; i++) {
    const d = await fetch(`${BASE}/api/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, source: "recall-app" }),
    }).then((r) => r.json()).catch(() => null);
    if (d?.envelope) return true;
    if (d?.id) await del(d.id); // raw fallback — don't keep it
    await sleep(5000);
  }
  return false;
}

const deadline = Date.now() + 3.5 * 3600_000;
while (Date.now() < deadline) {
  const cs = await caps();
  const queued = cs.filter((c) => c.status === "queued" || c.status === "indexing").length;
  const failed = cs.filter((c) => c.status === "failed");

  if (queued === 0 && failed.length === 0) break;

  if (queued < 4 && failed.length) {
    const batch = failed.slice(0, 12);
    let ok = 0;
    for (const f of batch) {
      if (!(await del(f.id))) continue; // still locked — next round
      if (await recapture(f.text)) ok++;
    }
    say(`re-ingested ${ok}/${batch.length} · ${failed.length - batch.length} failed left · queue was ${queued}`);
  }
  await sleep(90_000);
}

// completions stick now — everything is processed
for (let round = 0; round < 8; round++) {
  const cs = await caps();
  const open = cs.filter(
    (c) =>
      c.meta.type === "commitment" &&
      c.meta.status === "open" &&
      KEPT.some((t) => c.text.includes(t)),
  );
  if (!open.length) break;
  for (const c of open) {
    await fetch(`${BASE}/api/agenda/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id }),
    }).catch(() => {});
  }
  await sleep(20_000);
}

// stray raw fallbacks that were re-captured under a clean envelope
for (const rdoc of (await caps()).filter(
  (c) => c.meta.type === "memory" && c.text.includes("more confident"),
)) {
  await del(rdoc.id);
}

const final = await caps();
const st = {};
final.forEach((c) => (st[c.status ?? "?"] = (st[c.status ?? "?"] ?? 0) + 1));
const ledger = await fetch(`${BASE}/api/ledger`).then((r) => r.json());
say(
  `DONE — ${final.length} captures ${JSON.stringify(st)} · ledger open ${ledger.open.length} done ${ledger.done.length}`,
);
