// The big seed: a life's worth of memories, every one through the real
// write envelope. Failed enrichments are retried (raw fallbacks deleted
// once supermemory finishes processing them). A few commitments are
// completed at the end so the kept-archive has history.
// Usage: node scripts/seed-life.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIFE = [
  // family
  "My mom's name is Hoda. She still lives in Nasr City, Cairo, in the same apartment I grew up in.",
  "Dad is retired now — he taught physics at a Cairo high school for thirty years.",
  "Grandma passed in 2021. Her koshari recipe card is framed in my kitchen — it's the only dish I cook truly well.",
  "My cousin Omar is getting married in Cairo on October 9th.",
  "Layla sounds more confident every week on our calls. Cairo suits her.",
  // the startup
  "Karim and I are building Fahras — a memory layer for customer support teams.",
  "The startup has been registered as a UG in Munich since March.",
  "Our first user interview for Fahras was June 30th — she teared up describing her ticket backlog. That's when I knew we had something.",
  "We signed our first pilot customer on July 2nd — an e-commerce shop out of Leipzig.",
  "The Fahras demo crashed live on stage at a Munich meetup in May. Karim still jokes about it.",
  "I decided to bootstrap through the pilot instead of raising a pre-seed right now.",
  "I've decided Fahras stays remote-first, even after I settle in Berlin.",
  "Marcus the investor kept checking his phone during our pitch on Wednesday. Not a good sign.",
  "I think Karim is burning out a little — he's answered Slack at 3am twice this week.",
  "The support lead at our Leipzig pilot seems skeptical of AI tools. Win her over and we win the whole account.",
  "Don't share any Fahras numbers publicly until we announce the pilot.",
  // people
  "Tariq works as a data engineer at Zalando — that's why he's moving to Berlin too.",
  "Jonas was my teammate at Siemens. He stayed. We still get beers whenever I'm back in Munich.",
  "Sofia is my climbing partner — we met at Berta Block, the bouldering hall.",
  "Anna sits next to me in German class. She's from São Paulo and laughs at my grammar in two languages.",
  "I think Anna would make a great first design hire someday — she sketches interfaces for fun.",
  "Herr Weber seems strict, but he answered the boiler question within a day. Fair man, I think.",
  // berlin move logistics
  "My Munich lease ends August 31st, so the timing with the Berlin move-in is tight.",
  "Sold my Munich couch and desk on Kleinanzeigen last weekend. The flat echoes now.",
  "Visited the Berlin flat last week to measure the rooms — the afternoon light in the study is unreal.",
  "Call the Munich landlord about the deposit handover before July 15th.",
  "Cancel my Munich gym membership by July 18th or it auto-renews for a year.",
  "Schedule the TK health insurance switch call before the end of July.",
  "Renew the UG's registered address at the Handelsregister after the move — deadline September 15th.",
  "Get my bike serviced before the move — the brakes squeak going downhill.",
  "I ride a gray Cube road bike I bought used in Munich.",
  // commitments, various horizons
  "Print and sign the Leipzig pilot contract by Tuesday.",
  "Follow up with Marcus the investor next Thursday.",
  "Finish the YC application — the deadline is August 4th.",
  "Book flights to Cairo for Omar's wedding by July 30th, before prices spike.",
  "Send Layla the residency prep books before her program starts September 1st.",
  "Buy a proper desk chair once the Berlin flat is set up.",
  "Write Jonas a thank-you note for organizing the Siemens sendoff.",
  // events, story-dated
  "Ran my first half-marathon in Munich in April 2025 — 1:52, nearly died at kilometer 18.",
  "Tariq and I backpacked through Jordan in 2022. Wadi Rum under the stars is still the best night of my life.",
  "Finally got my German driver's license sorted last November, after two failed attempts at the paperwork.",
  "Sofia and I sent our first 7A boulder problem two weeks ago.",
  "My laptop died mid-flight to Lisbon in 2024 and I lost a week of uncommitted code. Never again — I commit everything now.",
  "Tariq and I watched the Egypt match in a packed shisha bar on Sonnenallee last month.",
  "I did my bachelor's in computer engineering at Ain Shams, class of 2019.",
  // tastes
  "Fairuz in the morning, Aphex Twin when I code. Nothing with lyrics when I'm writing.",
  "I always take the window seat. Always.",
  "The koshari place on Sonnenallee is almost as good as Cairo. Almost.",
  "I can't do horror movies. Not won't — can't.",
  "Dark chocolate over milk chocolate, no contest.",
  "I need a wall behind my back to focus — open-plan offices kill me.",
  "Espresso doubles only after lunch, and no caffeine after 4pm or I'm awake until 3.",
  "Analog watches only. A smartwatch feels like a leash.",
  "Paper books only — e-readers put me to sleep.",
  "Summer rain is my favorite weather. Cairo never had enough of it.",
  // boundaries + safety
  "Friday evenings are for the family call to Cairo. Never book anything over it.",
  "If I say I'm heads-down, don't suggest calls. Text only.",
  "No work talk after 10pm — my brain won't shut up otherwise.",
  "Bee stings make me swell badly — I carry antihistamines all summer.",
  "If anything ever happens to me, Tariq is my emergency contact.",
  // money/admin facts
  "I bank with N26 personally; the startup runs on Qonto.",
  "My blood type is O negative.",
];

// captured, then immediately completed — the kept archive needs a past
const KEPT = [
  "Book the movers for the Berlin move.",
  "Cancel the Vodafone contract before moving out.",
  "Submit the hackathon registration form.",
  "Send the April invoices to the accountant.",
];

let ok = 0;
const failures = [];

async function capture(content) {
  try {
    const r = await fetch(`${BASE}/api/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: "recall-app" }),
    });
    const d = await r.json();
    if (!d.envelope) {
      failures.push({ id: d.id, content });
      console.log(`RAW (will retry) — ${content.slice(0, 50)}`);
      return null;
    }
    ok++;
    console.log(
      `[${ok}] ${d.envelope.type}${d.envelope.due ? ` due ${d.envelope.due}` : ""} — ${content.slice(0, 52)}`,
    );
    return d;
  } catch (err) {
    failures.push({ id: null, content });
    console.log(`ERR (will retry) — ${content.slice(0, 50)}: ${err.message}`);
    return null;
  }
}

async function run(items, workers = 3) {
  const q = [...items];
  const results = [];
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (q.length) results.push(await capture(q.shift()));
    }),
  );
  return results;
}

async function deleteWhenReady(id, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${BASE}/api/document`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (r.ok) return true;
    await sleep(15_000); // 409 while supermemory is still processing
  }
  return false;
}

console.log(`— seeding ${LIFE.length} memories —`);
await run(LIFE);

console.log(`— seeding ${KEPT.length} to-be-kept commitments —`);
const keptDocs = (await run(KEPT)).filter(Boolean);

// retry pass: clear raw fallbacks, capture again
for (let round = 0; round < 3 && failures.length; round++) {
  const redo = failures.splice(0);
  console.log(`— retry round ${round + 1}: ${redo.length} item(s) —`);
  await sleep(30_000);
  for (const f of redo) {
    if (f.id) await deleteWhenReady(f.id);
    await capture(f.content);
  }
}

// complete the kept items once their docs are patchable
console.log("— completing kept commitments —");
await sleep(30_000);
for (const d of keptDocs) {
  let done = false;
  for (let i = 0; i < 10 && !done; i++) {
    const r = await fetch(`${BASE}/api/agenda/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: d.id }),
    });
    done = r.ok;
    if (!done) await sleep(15_000);
  }
  console.log(`${done ? "kept" : "COULD NOT COMPLETE"} — ${(d.envelope?.text ?? "").slice(0, 50)}`);
}

console.log(`done: ${ok} enriched, ${failures.length} unrecovered`);
