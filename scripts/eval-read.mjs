// The read-side eval: confident-wrongs per 100, target zero.
// The write bank (eval-envelope) proves labels are written correctly;
// this proves the READ path — retrieve, answer only from memory,
// abstain honestly — doesn't invent. Each case retrieves via
// /api/recall exactly like the voice agent's search_memories tool,
// then a grounded answerer (same contract as the agent prompt) replies.
//
// Grading: confident-wrong (answered, wrongly) is the sin — exit 1 on
// any. Abstaining on a known answer is a retrieval miss — reported,
// tolerated in small numbers.
// Usage: node scripts/eval-read.mjs [baseUrl]
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3001";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const CASES = [
  { q: "What's my blood type?", expect: ["o negative"] },
  { q: "What am I allergic to?", expect: ["penicillin"] },
  { q: "Who is Frau Bittner?", expect: ["leipzig", "support"] },
  { q: "What's my favorite movie?", abstain: true },
  { q: "When is Omar's wedding?", expect: ["october 9", "2026-10-09", "october 9th"] },
  { q: "Who is my cofounder?", expect: ["karim"] },
  { q: "What do I think of cilantro?", expect: ["soap", "hate", "can't stand", "dislike"] },
  { q: "Which neighborhood is my Berlin apartment in?", expect: ["prenzlauer berg"] },
  { q: "What is my sister doing this September?", expect: ["residency"] },
  { q: "What kind of bike do I ride?", expect: ["cube"] },
  { q: "When did I move to Munich?", expect: ["2023"] },
  { q: "Why is the startup called Fahras?", expect: ["grandfather", "index", "notebook"] },
  { q: "What's my favorite weather?", expect: ["rain"] },
  { q: "Do I have any pets?", abstain: true },
  { q: "What did Tariq and I do in Jordan?", expect: ["wadi rum", "backpack"] },
  { q: "Who beat me at the Munich half-marathon?", expect: ["jonas"] },
  { q: "What's my mom's name?", expect: ["hoda"] },
  { q: "What instrument do I play?", abstain: true },
];

const ABSTAIN_RE = /i don't know|you haven'?t told|no memor|not (in|something) (my|the) memor/i;

async function recall(q) {
  const d = await fetch(`${BASE}/api/recall`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, limit: 6 }),
  }).then((r) => r.json());
  // same dated format the voice agent sees — one contract, one eval
  return (d.results ?? [])
    .map((r) => {
      const text = r.memory ?? r.chunk;
      if (!text) return null;
      return r.createdAt ? `${text} (told ${r.createdAt.slice(0, 16).replace("T", " ")})` : text;
    })
    .filter(Boolean);
}

async function answer(q, memories) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are the read side of a personal memory system. Answer the user's question in one short sentence using ONLY the memories provided. Each memory carries the timestamp when the user told it; when two memories conflict or one reverses another, the one with the LATEST timestamp is the current truth (later date wins; same date → later time wins). Never mention the timestamps themselves. Mind who each memory is about: a memory about someone else in the user's life describes THAT person, never the user — it cannot answer a question about the user themselves. If the memories do not contain the answer, reply exactly: I don't know — you haven't told me.",
        },
        {
          role: "user",
          content: `memories:\n${memories.map((m) => `- ${m}`).join("\n") || "(none)"}\n\nquestion: ${q}`,
        },
      ],
    }),
  }).then((r) => r.json());
  return res.choices?.[0]?.message?.content?.trim() ?? "";
}

let confidentWrong = 0;
let misses = 0;
let pass = 0;

for (const c of CASES) {
  const memories = await recall(c.q);
  const a = await answer(c.q, memories);
  const abstained = ABSTAIN_RE.test(a);
  const low = a.toLowerCase();

  if (c.abstain) {
    if (abstained) {
      pass++;
      console.log(`✅  abstains — ${c.q}`);
    } else {
      confidentWrong++;
      console.log(`🔥  CONFIDENT-WRONG (invented) — ${c.q}\n    → ${a}`);
    }
    continue;
  }
  if (abstained) {
    misses++;
    console.log(`▫️  miss (abstained on known) — ${c.q}`);
  } else if (c.expect.some((e) => low.includes(e))) {
    pass++;
    console.log(`✅  ${c.q} → ${a.slice(0, 70)}`);
  } else {
    confidentWrong++;
    console.log(`🔥  CONFIDENT-WRONG — ${c.q}\n    → ${a}`);
  }
}

const total = CASES.length;
console.log(
  `\n${pass}/${total} answered right · ${misses} retrieval miss(es) · ${confidentWrong} confident-wrong`,
);
console.log(`confident-wrongs per 100: ${Math.round((confidentWrong / total) * 100)} (target 0)`);
if (confidentWrong > 0 || misses > 3) process.exit(1);
