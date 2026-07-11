// The truth eval: staleness, negation, near-duplicates, write lag —
// against the PRODUCTION read path (/api/recall, space "eval").
//
// The bank lives in the quarantined "eval" space. Old truths were seeded
// before their updates, so told-order is physically real. Controls are
// adversarial: old-but-still-true memories that recency must not break,
// twin dinners that dedup must not merge, a negation pair that collapse
// must keep whole. Each control exists because a draft of the fix failed
// it: day-only stamps inverted flips; dedup ate "moved to Cafe Riche".
//
// Usage: node scripts/eval-truth.mjs [baseUrl]        (test, default)
//        node scripts/eval-truth.mjs [baseUrl] seed   (fresh machine)
import { readFileSync } from "node:fs";

const BASE = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3001";
const MODE = process.argv.includes("seed") ? "seed" : "test";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const STALE = [
  { old: "My cousin Nadia's wedding is on November 7th in Alexandria.", nu: "Nadia's wedding got pushed to November 21st.", q: "when is Nadia's wedding?", oldTok: ["november 7"], newTok: ["november 21"] },
  { old: "My studio in Alexandria rents for 900 pounds a month.", nu: "The landlord raised the studio rent to 1100 pounds starting next month.", q: "how much is the studio rent?", oldTok: ["900"], newTok: ["1100"] },
  { old: "I accepted the consulting gig with Delta Textiles.", nu: "I backed out of the Delta Textiles gig — the terms changed.", q: "am I doing the Delta Textiles consulting gig?", oldTok: ["accept", "yes,"], newTok: ["backed out", "no longer", "not "] },
  { old: "Friday dinner with Nour is at the Greek Club.", nu: "Friday dinner with Nour moved to Cafe Riche.", q: "where is Friday dinner with Nour?", oldTok: ["greek club"], newTok: ["riche"] },
  { old: "Pottery class is on Tuesday evenings.", nu: "Pottery class moved to Thursday evenings this term.", q: "which evening is pottery class?", oldTok: ["tuesday"], newTok: ["thursday"] },
];
const NEG = [
  { old: "I'm going to Hassan's engagement party next month.", nu: "I'm not going to Hassan's engagement party anymore.", q: "am I going to Hassan's engagement party?", oldTok: ["going", "yes"], newTok: ["not going", "no longer", "skip"] },
  { old: "I can't stand instant coffee.", nu: "I've come around on instant coffee — it's actually fine now.", q: "how do I feel about instant coffee these days?", oldTok: ["can't stand", "hate", "dislike"], newTok: ["come around", "fine", "like"] },
  { old: "I run along the corniche every morning before work.", nu: "I stopped the morning corniche runs — my knee acts up.", q: "do I still run in the mornings?", oldTok: ["every morning", "yes"], newTok: ["stopped", "knee", "no longer", "not "] },
  { old: "I subscribed to the climbing gym in Zamalek.", nu: "I cancelled the Zamalek climbing gym membership.", q: "do I have a climbing gym membership?", oldTok: ["subscribed", "yes"], newTok: ["cancel", "no longer", "not "] },
];
const DUP_DOCS = [
  "Got food poisoning from the shrimp stand in Dahab and spent two days in the hostel bed.",
  "That shrimp place in Dahab wrecked me — two days flat on my back in the hostel.",
  "Still can't look at shrimp since Dahab knocked me out for two days.",
  "Farida nursed me through the Dahab food poisoning with rice water and crackers.",
  "After the Dahab shrimp disaster I swore off street seafood for good.",
];
const DUP_Q = { q: "who took care of me when I was sick in Dahab?", expect: ["farida"] };
const NONDUP = [
  "Dinner with Selim at the fish market in Alexandria was fantastic.",
  "Dinner with Selim at the new Lebanese place was mediocre.",
];
const NONDUP_Q = { q: "how was dinner with Selim at the Lebanese place?", expect: ["mediocre"] };
const CONTROL = [
  { old: "My grandmother's bakery on Fouad Street was called Rose du Nil.", nu: "Walked past Fouad Street yesterday — the old bakery block is a phone shop now.", q: "what was my grandmother's bakery called?", expect: ["rose du nil"] },
  { old: "My old landline number in Tanta ended in 447.", nu: "Booked a trip to visit Tanta in the winter.", q: "what did my old Tanta landline end in?", expect: ["447"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return r.json();
}

async function recall(q) {
  const d = await post("/api/recall", { q, space: "eval", limit: 6 });
  return (d.results ?? [])
    .map((r) => ({
      text: (r.memory ?? r.chunk ?? "").trim(),
      dated: r.createdAt
        ? `${(r.memory ?? r.chunk ?? "").trim()} (told ${r.createdAt.slice(0, 16).replace("T", " ")})`
        : (r.memory ?? r.chunk ?? "").trim(),
    }))
    .filter((r) => r.text);
}

async function answer(q, lines) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are the read side of a personal memory system. Answer the user's question in one short sentence using ONLY the memories provided. Each memory carries the timestamp when the user told it; when two memories conflict or one reverses another, the one with the LATEST timestamp is the current truth (later date wins; same date → later time wins). Never mention the timestamps themselves. If the memories do not contain the answer, reply exactly: I don't know — you haven't told me.",
        },
        { role: "user", content: `memories:\n${lines.map((m) => `- ${m}`).join("\n") || "(none)"}\n\nquestion: ${q}` },
      ],
    }),
  }).then((r) => r.json());
  return (res.choices?.[0]?.message?.content?.trim() ?? "").toLowerCase();
}

// ── seed (fresh machines only — waves preserve told-order) ────────
if (MODE === "seed") {
  const cap = (content) => post("/api/capture", { content, space: "eval", source: "eval-truth" });
  const wait = async (label) => {
    for (;;) {
      const d = await fetch(`${BASE}/api/feed?space=eval`).then((r) => r.json()).catch(() => null);
      const pending = d?.processing?.length ?? 0;
      if (!pending) return console.log(`  [${label}] processed`);
      console.log(`  [${label}] ${pending} processing…`);
      await sleep(15_000);
    }
  };
  const wave1 = [...STALE.map((c) => c.old), ...NEG.map((c) => c.old), ...DUP_DOCS, ...NONDUP, ...CONTROL.map((c) => c.old)];
  for (const [i, t] of wave1.entries()) {
    await cap(t);
    if ((i + 1) % 10 === 0) await wait(`wave1@${i + 1}`);
  }
  await wait("wave1");
  for (const t of [...STALE.map((c) => c.nu), ...NEG.map((c) => c.nu), ...CONTROL.map((c) => c.nu)]) await cap(t);
  await wait("wave2");
  console.log("seeded.");
  process.exit(0);
}

// ── test ──────────────────────────────────────────────────────────
let bad = 0;

console.log("═══ current truth must win ═══");
for (const c of [...STALE, ...NEG]) {
  const hits = await recall(c.q);
  const a = await answer(c.q, hits.map((h) => h.dated));
  const hasNew = c.newTok.some((t) => a.includes(t));
  const hasOld = c.oldTok.some((t) => a.includes(t));
  const ok = hasNew && !(!hasNew && hasOld);
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "🟥"} "${c.q}" → ${a.slice(0, 80)}`);
}

console.log("═══ history must survive recency ═══");
for (const c of CONTROL) {
  const hits = await recall(c.q);
  const a = await answer(c.q, hits.map((h) => h.dated));
  const ok = c.expect.some((t) => a.includes(t));
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "🟥"} "${c.q}" → ${a.slice(0, 80)}`);
}

console.log("═══ duplicates collapse, twins and reversals survive ═══");
{
  const hits = await recall(DUP_Q.q);
  const rank = hits.findIndex((h) => DUP_Q.expect.some((t) => h.text.toLowerCase().includes(t))) + 1;
  const okF = rank > 0 && rank <= 3;
  if (!okF) bad++;
  console.log(`  ${okF ? "✅" : "🟥"} context survives retellings (Farida rank ${rank || "MISS"})`);

  const sel = await recall(NONDUP_Q.q);
  const a = await answer(NONDUP_Q.q, sel.map((h) => h.dated));
  const okS = NONDUP_Q.expect.some((t) => a.includes(t));
  if (!okS) bad++;
  console.log(`  ${okS ? "✅" : "🟥"} different events not merged → ${a.slice(0, 60)}`);

  const hassan = await recall("Hassan engagement party plans");
  const both = hassan.filter((h) => h.text.toLowerCase().includes("hassan")).length >= 2;
  if (!both) bad++;
  console.log(`  ${both ? "✅" : "🟥"} negation pair kept whole through collapse`);
}

console.log("═══ just-told must be recallable now ═══");
{
  const stamp = Date.now().toString().slice(-5);
  const probe = `The temporary locker code at the studio is nine-${stamp}.`;
  await post("/api/capture", { content: probe, space: "eval", source: "eval-truth-lag" });
  await sleep(3_000);
  const hits = await recall("what is the temporary locker code at the studio?");
  const ok = hits.some((h) => h.text.includes(stamp));
  if (!ok) bad++;
  console.log(`  ${ok ? "✅" : "🟥"} memory told 3s ago is already retrievable (${stamp})`);
}

console.log(`\n${bad === 0 ? "all green" : `${bad} failure(s)`}`);
if (bad > 0) process.exit(1);
