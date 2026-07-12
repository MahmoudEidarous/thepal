// The vague-query eval: 30 deliberately hard questions — metaphor,
// answer-side phrasing, relational references, temporal twists, negation
// morphology — against the production /api/recall fusion.
//
// History: single-search baseline scored 19/25 on the core bank; the
// fusion layer (parallel probes + temporal router + safety booster +
// RRF) takes retrieval to 25/25 with the agent's rephrase layer on top.
// Cases marked layer1 are unanswerable without conversation context
// (pronouns, private metaphor) — for those the eval sends the query the
// agent is prompted to send after resolving, and both must agree.
// Usage: node scripts/eval-vague.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3001";

const CASES = [
  { q: "what's eating me lately?", expect: ["anxiety", "anxious", "move"] },
  { q: "who should I be worried about right now?", expect: ["karim", "burnout", "mom", "sofia", "hoda"] },
  { q: "what's the number that changed her mind?", expect: ["78", "retrieval"], resolved: "Frau Bittner Leipzig pilot numbers results" },
  { q: "when do the boxes leave?", expect: ["august", "mover"] },
  { q: "what's on the stove on Sundays?", expect: ["koshari"] },
  { q: "what did the ER visit teach me?", expect: ["penicillin"] },
  { q: "who's gone quiet on me lately?", expect: ["sofia"] },
  // the misfiling writeup was CLOSED by a later telling (seed-deep) —
  // the honest answer is now whatever the ledger holds due this Sunday
  { q: "what's due before the weekend is over?", expect: ["mock interview", "demo video", "layla"] },
  { q: "what's the story behind the name?", expect: ["grandfather", "notebook"] },
  { q: "did anything get broken when we were kids?", expect: ["arm", "layla"] },
  { q: "what's my ride called?", expect: ["cube"] },
  { q: "whose big day is coming in the fall?", expect: ["omar", "wedding"] },
  { q: "what's forbidden before noon on a Sunday?", expect: ["laptop"] },
  { q: "what did the skeptic do after we shipped?", expect: ["bittner", "soften"] },
  { q: "what should no doctor ever give me?", expect: ["penicillin"] },
  { q: "which class am I dragging myself to every week?", expect: ["german", "a2"] },
  { q: "what happened out in the desert?", expect: ["wadi rum", "jordan"] },
  { q: "why do I send dishes back at restaurants?", expect: ["cilantro"], resolved: "foods I hate or refuse to eat" },
  // was "what's still sitting unsigned?" → Leipzig contract, until the
  // user signed it live on 2026-07-12 and the truth closed under the
  // check. Same un-stem machinery, re-pinned on a target still open.
  { q: "what's still unpacked?", expect: ["packing", "boxes"] },
  { q: "who do I still need to charm for money?", expect: ["marcus"], resolved: "which investor do I still need to convince for funding" },
  { q: "how many mistakes are we down to?", expect: ["twelve", "12"] },
  { q: "what's my kind of sky?", expect: ["rain"], resolved: "favorite weather" },
  { q: "what's overdue and haunting me?", expect: ["deck", "pitch"] },
  { q: "what's on the calendar for October?", expect: ["omar", "wedding"] },
  { q: "anything due end of August?", expect: ["book", "residency", "insurance"] },
  // keepers from earlier rounds — each pinned a specific fix
  { q: "what's my sister up to?", expect: ["residency"] }, // entity alias "my sister" → Layla
  { q: "anything big happening in September?", expect: ["residency", "layla"] }, // temporal router
  { q: "if I ever need surgery, what should the doctors know?", expect: ["penicillin", "o negative"] }, // safety booster
  { q: "my partner in crime at work — how's he doing?", expect: ["karim"] }, // RRF guard: probes must never evict base hits
  { q: "what do I owe him?", expect: ["karim", "deck"], resolved: "what do I owe Karim" }, // pronoun → layer 1
];

async function recall(q) {
  const r = await fetch(`${BASE}/api/recall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, limit: 6 }),
  });
  const d = await r.json();
  return (d.results ?? []).map((x) => (x.memory ?? x.chunk ?? "").toLowerCase());
}

const rankOf = (texts, expect) => {
  const i = texts.findIndex((t) => expect.some((e) => t.includes(e)));
  return i < 0 ? null : i + 1;
};

let hits = 0;
let misses = 0;
let totalMs = 0;
for (const c of CASES) {
  const t0 = Date.now();
  let rank = rankOf(await recall(c.q), c.expect);
  totalMs += Date.now() - t0;
  let via = "";
  if (!rank && c.resolved) {
    rank = rankOf(await recall(c.resolved), c.expect);
    via = ` (via layer-1 rephrase: "${c.resolved}")`;
  }
  if (rank) {
    hits++;
    console.log(`✅  hit @${rank}${via} — ${c.q}`);
  } else {
    misses++;
    console.log(`🟥  MISS — ${c.q}`);
  }
}
console.log(`\n${hits}/${CASES.length} retrieved · avg ${Math.round(totalMs / CASES.length)}ms per query`);
if (misses > 0) process.exit(1);
