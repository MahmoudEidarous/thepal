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
  if (method !== "GET") return r.status;
  const body = await r.json().catch(() => ({}));
  return { ...body, httpStatus: r.status };
};
const settle = async (id) => {
  for (let i = 0; i < 50; i++) {
    const d = await engineDoc(id);
    if (d.httpStatus === 404) return "missing";
    if (d.status === "done" || d.status === "failed") return d.status;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return "timeout";
};
const evalAgenda = async () =>
  (await fetch(`${BASE}/api/agenda?space=eval`).then((r) => r.json())).commitments ?? [];
const until = async (fn) => {
  for (let i = 0; i < 8; i++) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return fn();
};

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
const canonicalCleanup = [];

const futureDate = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return {
    iso: date.toLocaleDateString("en-CA"),
    spoken: date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  };
};

const originalAppointment = futureDate(7);
const movedAppointment = futureDate(9);
const xrayDeadline = futureDate(13);

const providerId = async (data) => {
  const eventId = data.receipt?.eventId;
  if (!eventId || data.id !== eventId) return data.id;
  for (let i = 0; i < 40; i++) {
    const captures = await fetch(`${BASE}/api/captures?space=eval`)
      .then((r) => r.json())
      .then((body) => body.captures ?? [])
      .catch(() => []);
    const mirror = captures.find((capture) => capture.meta?.canonicalEventId === eventId);
    if (mirror?.id) return mirror.id;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return data.id;
};

const deleteCanonical = async (eventId) => {
  const preview = await post("/api/memory/deletions/preview", { eventId });
  if (preview.status !== 200 || !preview.data.token) return false;
  const executed = await post("/api/memory/deletions/execute", { token: preview.data.token });
  return executed.status === 200;
};

// ── reschedule: a new telling retires the old terms ────────────────
const a = await post("/api/capture", {
  content: `eval-ledger: dentist appointment on ${originalAppointment.spoken} at 3pm`,
  space: "eval",
  source: "eval-ledger",
});
const aId = await providerId(a.data);
cleanup.push(aId);
if (a.data.receipt?.eventId) canonicalCleanup.push(a.data.receipt.eventId);
check(a.status === 200 && a.data.envelope?.type === "commitment", "plants an open commitment");
await settle(aId);

const b = await post("/api/capture", {
  content: `My dentist appointment is actually going to be ${movedAppointment.spoken}, not ${originalAppointment.spoken}`,
  space: "eval",
  source: "eval-ledger",
});
const bId = await providerId(b.data);
cleanup.push(bId);
if (b.data.receipt?.eventId) canonicalCleanup.push(b.data.receipt.eventId);
check(
  typeof b.data.superseded === "string" && /dentist/i.test(b.data.superseded),
  "the enricher names the open item a reschedule replaces",
  JSON.stringify(b.data.envelope?.supersedes),
);
check(
  b.data.conflict?.id === aId && /dentist/i.test(b.data.conflict?.text ?? ""),
  "the filing receipt exposes the old telling as an update",
  JSON.stringify(b.data.conflict ?? null),
);
let oldDoc = await engineDoc(aId);
const supersessionKept = await until(async () => {
  oldDoc = await engineDoc(aId);
  if (oldDoc.metadata?.status === "superseded") return true;
  // A failed immutable provider document is safely reborn under a new ID.
  // Follow the canonical event rather than confusing provider identity with
  // Recall's durable identity.
  const canonicalEventId = a.data.receipt?.eventId;
  if (!canonicalEventId) return false;
  const listed = await fetch(`${ENGINE}/v3/documents/list`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ containerTags: ["recall_eval"], limit: 200 }),
  }).then((r) => r.json());
  for (const memory of listed.memories ?? []) {
    if (memory.metadata?.canonicalEventId !== canonicalEventId) continue;
    const fresh = await engineDoc(memory.id);
    if (fresh.metadata?.status === "superseded") {
      oldDoc = fresh;
      return true;
    }
  }
  return false;
});
check(supersessionKept, "old terms retire as superseded");
check(oldDoc.metadata?.supersededBy === bId, "audit trail links old → new");
const newDoc = await engineDoc(bId);
check(newDoc.metadata?.updates === aId, "new telling stores the old → new lineage");
check(!!newDoc.metadata?.updatesTold, "lineage keeps when the prior telling was told");
{
  const dentist = (await evalAgenda()).filter((c) => /dentist/i.test(c.content));
  check(
    dentist.length === 1 && dentist[0].due === movedAppointment.iso,
    "the agenda nags exactly once, with the new date",
    JSON.stringify(dentist.map((d) => d.due)),
  );
}

// ── a different errand for the same person must NOT supersede ──────
const c = await post("/api/capture", {
  content: `Pick up the X-ray results from the dentist's office by ${xrayDeadline.spoken}`,
  space: "eval",
  source: "eval-ledger",
});
const cId = await providerId(c.data);
cleanup.push(cId);
if (c.data.receipt?.eventId) canonicalCleanup.push(c.data.receipt.eventId);
check(
  !c.data.superseded,
  "a different errand at the same place never supersedes",
  JSON.stringify(c.data.superseded ?? null),
);
// closures below target docs that have settled — like a real user
// closing something told earlier (the route also guards the race)
await settle(bId);
await settle(cId);

// ── cancellation: scrapped plans close as cancelled, never deleted ──
const cx = await post("/api/agenda/complete", {
  q: "pick up the x-ray results",
  space: "eval",
  outcome: "cancelled",
});
check(cx.status === 200 && cx.data.outcome === "cancelled", "cancel closes with outcome=cancelled");
if (cx.data.receipt?.eventId) canonicalCleanup.push(cx.data.receipt.eventId);
let cancelledDoc = await engineDoc(cId);
const cancellationKept = await until(async () => {
  cancelledDoc = await engineDoc(cId);
  if (cancelledDoc.metadata?.status === "cancelled") return true;
  // A failed immutable provider document is safely reborn under a new ID.
  // Find that replacement instead of mistaking the removed failed ID for
  // lost history.
  const listed = await fetch(`${ENGINE}/v3/documents/list`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ containerTags: ["recall_eval"], limit: 200 }),
  }).then((r) => r.json());
  for (const memory of listed.memories ?? []) {
    const text = `${memory.content ?? ""} ${memory.title ?? ""} ${memory.summary ?? ""}`;
    if (!/x-ray results/i.test(text)) continue;
    const fresh = await engineDoc(memory.id);
    if (fresh.metadata?.status === "cancelled") {
      cancelledDoc = fresh;
      return true;
    }
  }
  return false;
});
check(
  cancellationKept,
  "the document keeps status=cancelled",
  JSON.stringify(cancelledDoc.metadata ?? null),
);

// ── completion: done stays done ─────────────────────────────────────
const dn = await post("/api/agenda/complete", {
  q: `dentist appointment ${movedAppointment.spoken}`,
  space: "eval",
});
check(dn.status === 200 && dn.data.outcome === "done", "done closes with outcome=done");
if (dn.data.receipt?.eventId) canonicalCleanup.push(dn.data.receipt.eventId);

// ── neither retired state may appear in the ledger views ───────────
// the engine's list endpoint can serve a stale snapshot for a beat
// after a PATCH — read like a patient user, not a race
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
      /x-ray|eval-ledger/i.test(x.content),
    ),
    "superseded and cancelled items leave the ledger entirely",
  );
}

// ── cleanup — settle first, delete everything planted + closure events
for (const id of cleanup) await settle(id);
const canonicalDeleted = new Set();
for (const eventId of canonicalCleanup) {
  if (await deleteCanonical(eventId)) canonicalDeleted.add(eventId);
}
// Compatibility fallback for a legacy server that did not return receipts.
if (!canonicalCleanup.length) {
  for (const id of cleanup) await engineDoc(id, "DELETE");
}
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
    (String(md.source ?? "").startsWith("recall-ledger") && /dentist|x-ray/i.test(text))
  ) {
    const eventId = typeof md.canonicalEventId === "string" ? md.canonicalEventId : null;
    if (eventId && !canonicalDeleted.has(eventId)) {
      if (await deleteCanonical(eventId)) canonicalDeleted.add(eventId);
    } else if (!eventId) {
      await settle(m.id);
      await engineDoc(m.id, "DELETE");
    }
  }
}
console.log(`\n${pass}/${pass + fail} checks green`);
if (fail > 0) process.exit(1);
