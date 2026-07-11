// Second life-seed: texture, history, and weight. Drip-fed in small
// batches — the engine processes ~1 doc/min and permanently fails
// anything that sits queued past its stuck-threshold, so the queue
// stays shallow. Envelope failures retry; raw fallbacks are removed.
// Usage: node scripts/seed-more.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[seed] ${m}`);

const LIFE = [
  // weight
  "Dina and I broke up in March after four years together. That's all I want to say about it.",
  "We got the news about grandma on a Thursday in 2021. I flew to Cairo with one day's notice and wrote her eulogy on the plane.",
  "Mom sounded tired on Sunday's call. She said she's fine. She always says she's fine.",
  // family texture
  "When we were kids, Layla broke her arm copying my bike jump off the garage roof. Mom still blames me, twenty years later.",
  "Dad calls every Eid at exactly 9am, like clockwork. He thinks voice notes are for lazy people.",
  "Karim's wife Nadia is expecting their first baby in November. I need to find a proper gift before then.",
  "My grandfather kept a paper notebook he called his fahras — his index of everything. That's where the startup name comes from.",
  // startup lore
  "Karim sold his car in April to fund our first three months. I'll never forget that.",
  "I once pitched an investor with Spotify still playing in the background. He got two full minutes of Amr Diab before I noticed.",
  "Our first real user is Frau Bittner. She runs the support desk at the Leipzig shop and answers tickets like a sniper.",
  "Decided we won't do a freemium tier — pilots pay from day one, even if it's small.",
  "The Fahras codebase crossed 40,000 lines this week. Half of it is tests. I'm weirdly proud of that.",
  "The demo laptop needs a fresh battery before any live pitch — it died at 4 percent on stage in Munich. Never again.",
  "If the YC application goes nowhere, plan B is the EXIST grant — that deadline is October 1st.",
  "Marcus emailed back Monday. He wants retention numbers after eight weeks of the pilot, so that's a mid-September conversation.",
  // berlin / munich life
  "Decided the Cube bike comes to Berlin with me. Selling it felt like betrayal.",
  "Found my Berlin running route already: through Volkspark Friedrichshain, past the fairy tale fountain, 8k round trip.",
  "The Munich flat's echo is getting to me. Three more weeks of sleeping on a mattress on the floor.",
  "Herr Weber sent the house rules. Quiet hours start at 10pm sharp. Germany is going to Germany.",
  "My U-Bahn line in Berlin will be the U2 — Senefelderplatz station, four minutes' walk from the flat.",
  "RSVP to Omar's wedding by the end of July — Mom will actually kill me if I forget.",
  "Get renter's insurance sorted before the September 1st move-in.",
  "Ask Frau Schneider about the B1 course when A2 wraps up in August.",
  // quirks
  "I name my devices after Nile cities. The laptop is Aswan, the phone is Luxor, the backup drive is Rosetta.",
  "I write in Arabic when it's personal and English when it's work. The heart has a language.",
  "Cold showers year-round. Started as a dare in 2023, now I can't stop.",
  "My rule for anything over 100 euro: want it for thirty days first. The wishlist graveyard is enormous.",
  "Pistachio ice cream is the only correct answer. Everything else is decoration.",
  "I keep a paper notebook for ideas. If an idea survives a week on paper, it earns a file in the repo.",
  "Sunday mornings are for the long call home and koshari attempts. No laptop until noon.",
  // history, story-dated
  "My first computer was a Pentium 4 my uncle assembled in 2008. I broke Windows within a week and learned more fixing it than school ever taught me.",
  "First real paycheck was in 2019, at a Cairo fintech called Paymob. I spent it on a mechanical keyboard and regretted nothing.",
  "Landed in Munich on a gray Tuesday in October 2023 with two suitcases and exactly zero German.",
  "Ran the Munich half-marathon in April 2025 with Jonas. He beat me by ninety seconds and has mentioned it roughly ninety times since.",
  "The Egypt–Morocco final last month: the Sonnenallee shisha bar erupted so hard the police showed up. Best night in Berlin so far, and I don't even live there yet.",
  // impressions
  "Jonas seemed genuinely sad at the sendoff. Ten years at Siemens and he calls me the brave one. I think he wants out too.",
  "Sofia's been quiet at the gym lately. Might be the job hunt. I should ask her properly next session.",
  "Frau Bittner softened noticeably after we shipped the export feature. Skeptics make the best champions.",
  // longer note — embedded commitments
  "Week one of the Leipzig pilot, raw notes: 214 tickets ingested, retrieval hit rate 78 percent, misfiled memories down to twelve after Tuesday's fix. Frau Bittner wants exports her team can actually open in Excel — we need to ship the export feature by July 25th. The mid-pilot review call with their ops lead is set for August 8th. Also: write up the misfiling patterns for Karim before Monday, he's seen none of this yet.",
  "Decided to write a monthly letter to myself on the first of each month. July's letter says: don't let the move eat the momentum.",
];

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
const rawIds = [];
async function capture(content) {
  for (let i = 0; i < 3; i++) {
    const d = await fetch(`${BASE}/api/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: "recall-app" }),
    }).then((r) => r.json()).catch(() => null);
    if (d?.envelope) return d.envelope.type;
    if (d?.id && !(await del(d.id))) rawIds.push(d.id); // clean up at the end
    await sleep(5000);
  }
  return null;
}
async function waitShallow() {
  for (let i = 0; i < 40; i++) {
    const queued = (await caps()).filter(
      (c) => c.status === "queued" || c.status === "indexing",
    ).length;
    if (queued < 3) return;
    await sleep(45_000);
  }
}

const BATCH = 9;
for (let b = 0; b * BATCH < LIFE.length; b++) {
  const batch = LIFE.slice(b * BATCH, (b + 1) * BATCH);
  let ok = 0;
  for (const item of batch) if (await capture(item)) ok++;
  say(`batch ${b + 1}/${Math.ceil(LIFE.length / BATCH)}: ${ok}/${batch.length} enveloped — waiting for the engine`);
  await waitShallow();
}

// raw fallbacks that were locked mid-processing earlier
for (const id of rawIds) await del(id);

// anything the stuck-sweep still caught, one salvage pass
for (let round = 0; round < 4; round++) {
  const failed = (await caps()).filter((c) => c.status === "failed");
  if (!failed.length) break;
  say(`salvaging ${failed.length} swept doc(s)`);
  for (const f of failed) {
    if (await del(f.id)) await capture(f.text);
  }
  await waitShallow();
}

const final = await caps();
const st = {};
final.forEach((c) => (st[c.status ?? "?"] = (st[c.status ?? "?"] ?? 0) + 1));
say(`DONE — ${final.length} captures ${JSON.stringify(st)}`);
