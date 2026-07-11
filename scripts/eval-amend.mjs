// The amend eval: edit_memory's contract, pinned. Part one aims the
// targeting at the live personal corpus READ-ONLY (dryRun) — the right
// memory must win among planted near-miss distractors, and the system's
// own bookkeeping (ledger completion events, briefings) must never be
// the target of a correction. Part two runs the full lifecycle in the
// quarantined eval space: plant → amend → verify the rewrite, the
// re-envelope, and the audit trail → clean up after itself.
// Usage: node scripts/eval-amend.mjs [baseUrl]
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

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const engineDoc = async (id, method = "GET") => {
  const res = await fetch(`${ENGINE}/v3/documents/${id}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}` },
  });
  return method === "GET" ? res.json().catch(() => ({})) : res.status;
};

const waitSettled = async (id) => {
  for (let i = 0; i < 50; i++) {
    const d = await engineDoc(id);
    if (d.status === "done" || d.status === "failed") return d.status;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return "timeout";
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

// ── part one: targeting, read-only against the real corpus ─────────
console.log("— targeting (dryRun, personal space) —");
const TARGETS = [
  { q: "my blood donation appointment", expect: ["blood donation"], never: ["vienna"] },
  { q: "the Vienna call", expect: ["vienna"], never: ["blood"] },
  // the ledger's own "Done:" event must never be the target — the told
  // memory underneath it is what a correction means
  { q: "the movers booking", expect: ["mover"], never: ["done:"] },
  { q: "my friend Tariq's oud", expect: ["oud"], never: [] },
];
for (const t of TARGETS) {
  const { status, data } = await post("/api/amend", { query: t.q, correction: "x", dryRun: true });
  const m = (data.match ?? "").toLowerCase();
  check(
    status === 200 &&
      t.expect.some((e) => m.includes(e)) &&
      !t.never.some((n) => m.includes(n)),
    `targets right memory — "${t.q}"`,
    `got [${data.match ?? data.error}]`,
  );
}
{
  const { status } = await post("/api/amend", {
    query: "my pet iguana's feeding schedule",
    correction: "x",
    dryRun: true,
  });
  check(status === 404, "refuses a target it can't find (404, nothing guessed)");
}

// ── part two: lifecycle, quarantined in the eval space ─────────────
console.log("— lifecycle (eval space) —");
const plant = await post("/api/capture", {
  content: "eval-amend: my German class moved to Tuesdays at 6pm at the Volkshochschule",
  space: "eval",
  source: "eval-amend",
});
const docId = plant.data.id;
check(plant.status === 200 && !!docId, "plants the memory to correct");
check((await waitSettled(docId)) === "done", "planted doc settles");

const amend = await post("/api/amend", {
  query: "German class schedule",
  correction: "My German class is now on Wednesdays at 7pm at the Volkshochschule",
  space: "eval",
});
check(amend.status === 200, "amend succeeds", JSON.stringify(amend.data).slice(0, 120));
check(
  (amend.data.before ?? "").toLowerCase().includes("tuesday"),
  "before = the old telling",
  amend.data.before,
);
check(
  (amend.data.after ?? "").toLowerCase().includes("wednesday"),
  "after = the corrected telling",
  amend.data.after,
);

const doc = await engineDoc(docId);
check(
  (doc.content ?? "").toLowerCase().includes("wednesday"),
  "the document itself now says Wednesday",
);
check(
  (doc.metadata?.amendedFrom ?? "").toLowerCase().includes("tuesday"),
  "audit trail keeps what it used to say (amendedFrom)",
);
check(typeof doc.metadata?.amendedAt === "string", "audit trail stamps when (amendedAt)");

const miss = await post("/api/amend", {
  query: "the eval space's championship chess trophy",
  correction: "x",
  space: "eval",
});
check(miss.status === 404, "no confident match in eval space → 404");

// cleanup — only delete once the rewrite has fully re-processed
await waitSettled(docId);
const del = await engineDoc(docId, "DELETE");
check(del === 200 || del === 204, "cleans up after itself");

console.log(`\n${pass}/${pass + fail} checks green`);
if (fail > 0) process.exit(1);
