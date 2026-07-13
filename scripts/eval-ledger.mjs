// The ledger-integrity eval: the commitment lifecycle's sharp edges,
// pinned. A reschedule told as a NEW commitment must retire the old one
// (the enricher reads the open ledger and names what a telling
// replaces); a scrapped plan closes as cancelled, never deleted; and
// neither superseded nor cancelled items may ever nag again. Runs in
// the quarantined eval space and cleans up after itself.
// Usage: node scripts/eval-ledger.mjs [baseUrl]
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3001";
const ENGINE = "http://localhost:6767";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const KEY = env.SUPERMEMORY_API_KEY;

const post = async (p, b) => {
  const r = await fetch(`${BASE}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const engineDoc = async (id, method = "GET") => {
  const r = await fetch(`${ENGINE}/v3/documents/${id}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}` },
  });
  return method === "GET" ? r.json().catch(() => ({})) : r.status;
};
const settle = async (id) => {
  for (let i = 0; i < 50; i++) {
    const d = await engineDoc(id);
    if (d.status === "done" || d.status === "failed") return d.status;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return "timeout";
};
const evalAgenda = async () =>
  (await fetch(`${BASE}/api/agenda?space=eval`).then((r) => r.json())).commitments ?? [];

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) {
    pass++;
    console.log(`✅  ${label}`);
  } else {
    fail++;
    console.log(`🟥  FAIL — ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const cleanup = [];

// ── reschedule: a new telling retires the old terms ────────────────
const a = await post("/api/capture", {
  content: "eval-ledger: dentist appointment on Tuesday July 14th at 3pm",
  space: "eval",
  source: "eval-ledger",
});
cleanup.push(a.data.id);
check(a.status === 200 && a.data.envelope?.type === "commitment", "plants an open commitment");
await settle(a.data.id);

const b = await post("/api/capture", {
  content: "My dentist appointment is actually going to be Thursday July 16th, not Tuesday",
  space: "eval",
  source: "eval-ledger",
});
cleanup.push(b.data.id);
check(
  typeof b.data.superseded === "string" && /dentist/i.test(b.data.superseded),
  "the enricher names the open item a reschedule replaces",
  JSON.stringify(b.data.envelope?.supersedes),
);
check(
  b.data.conflict?.id === a.data.id && /dentist/i.test(b.data.conflict?.text ?? ""),
  "the filing receipt exposes the old telling as an update",
  JSON.stringify(b.data.conflict ?? null),
);
const oldDoc = await engineDoc(a.data.id);
check(oldDoc.metadata?.status === "superseded", "old terms retire as superseded");
check(oldDoc.metadata?.supersededBy === b.data.id, "audit trail links old → new");
const newDoc = await engineDoc(b.data.id);
check(newDoc.metadata?.updates === a.data.id, "new telling stores the old → new lineage");
check(!!newDoc.metadata?.updatesTold, "lineage keeps when the prior telling was told");
{
  const dentist = (await evalAgenda()).filter((c) => /dentist/i.test(c.content));
  check(
    dentist.length === 1 && dentist[0].due === "2026-07-16",
    "the agenda nags exactly once, with the new date",
    JSON.stringify(dentist.map((d) => d.due)),
  );
}

// ── a different errand for the same person must NOT supersede ──────
const c = await post("/api/capture", {
  content: "Pick up the X-ray results from the dentist's office by July 20th",
  space: "eval",
  source: "eval-ledger",
});
cleanup.push(c.data.id);
check(
  !c.data.superseded,
  "a different errand at the same place never supersedes",
  JSON.stringify(c.data.superseded ?? null),
);
// closures below target docs that have settled — like a real user
// closing something told earlier (the route also guards the race)
await settle(b.data.id);
await settle(c.data.id);

// ── cancellation: scrapped plans close as cancelled, never deleted ──
const cx = await post("/api/agenda/complete", {
  q: "pick up the x-ray results",
  space: "eval",
  outcome: "cancelled",
});
check(cx.status === 200 && cx.data.outcome === "cancelled", "cancel closes with outcome=cancelled");
const cDoc = await engineDoc(c.data.id);
check(cDoc.metadata?.status === "cancelled", "the document keeps status=cancelled");

// ── completion: done stays done ─────────────────────────────────────
const dn = await post("/api/agenda/complete", { q: "dentist appointment thursday", space: "eval" });
check(dn.status === 200 && dn.data.outcome === "done", "done closes with outcome=done");

// ── neither retired state may appear in the ledger views ───────────
// the engine's list endpoint can serve a stale snapshot for a beat
// after a PATCH — read like a patient user, not a race
const until = async (fn) => {
  for (let i = 0; i < 8; i++) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return fn();
};
{
  let last = [];
  const ok = await until(async () => {
    last = await evalAgenda();
    return !last.some((x) => /dentist|x-ray/i.test(x.content));
  });
  check(
    ok,
    "agenda holds neither superseded, cancelled, nor done items",
    JSON.stringify(last.map((x) => x.content.slice(0, 60))),
  );
}
{
  const ledgerView = () => fetch(`${BASE}/api/ledger?space=eval`).then((r) => r.json());
  let lastDone = [];
  const ok = await until(async () => {
    lastDone = (await ledgerView()).done ?? [];
    return lastDone.some((x) => /dentist appointment/i.test(x.content));
  });
  check(
    ok,
    "the done archive keeps the finished commitment",
    JSON.stringify(lastDone.map((x) => x.content.slice(0, 60))),
  );
  const l = await ledgerView();
  check(
    ![...(l.open ?? []), ...(l.done ?? [])].some((x) =>
      /x-ray|tuesday july 14/i.test(x.content),
    ),
    "superseded and cancelled items leave the ledger entirely",
  );
}

// ── cleanup — settle first, delete everything planted + closure events
for (const id of cleanup) await settle(id);
for (const id of cleanup) await engineDoc(id, "DELETE");
// the Done/Cancelled events written by the complete route
const listed = await fetch(`${ENGINE}/v3/documents/list`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ containerTags: ["recall_eval"], limit: 200 }),
}).then((r) => r.json());
for (const m of listed.memories ?? []) {
  const md = m.metadata ?? {};
  // list truncates content — read every text field it might hide in.
  // Reborn docs (setLedgerStatus on failed originals) carry NEW ids, so
  // sweep by source, not by the ids we planted.
  const text = `${m.content ?? ""} ${m.title ?? ""} ${m.summary ?? ""}`;
  if (
    md.source === "eval-ledger" ||
    (md.source === "recall-ledger" && /dentist|x-ray/i.test(text))
  ) {
    await settle(m.id);
    await engineDoc(m.id, "DELETE");
  }
}
console.log(`\n${pass}/${pass + fail} checks green`);
if (fail > 0) process.exit(1);
