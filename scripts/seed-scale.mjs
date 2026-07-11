// Third life-seed: scale. 100 more memories so retrieval is tested against
// a real crowd — near-miss distractors beside the facts the demo leans on,
// arcs that advance (never contradict) what earlier seeds established, and
// a thick layer of everyday noise. Honesty traps stay traps: no pets, no
// favorite movie, no instrument for the user. Drip-fed like seed-more —
// the engine fails anything queued past its stuck-threshold.
// Usage: node scripts/seed-scale.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[seed-scale] ${m}`);

const LIFE = [
  // family & Cairo texture
  "My aunt Mervat runs a fabric shop in Khan el-Khalili. She's been threatening to retire for fifteen years.",
  "Omar's fiancée is called Salma — they met at a wedding, which Mom finds hilariously efficient.",
  "Dad's knee surgery last spring went well. He walks the Nasr City loop every morning now and reports his step count like it's the news.",
  "Layla's white-coat ceremony is September 20th. I promised Mom I'd be on a video call for it no matter what.",
  "Mom refuses to text. Voice notes only, minimum ninety seconds each.",
  "Uncle Sameh — the one who built my first computer — fixes ATMs for a living in Alexandria. Machines just obey him.",
  "Our old building's doorman, Amm Fathy, still asks Mom when I'm coming back. Eight years now.",
  "Grandma's recipe box went to Aunt Mervat after she passed. Mom photographed every card in it, just in case.",
  "My cousin Heba in Toronto sends me winter photos every January like a threat.",
  "The family WhatsApp group is called '3elet el Ghalaba'. Ninety percent of it is Mom's chain-message forwards.",
  // startup — texture, distractors, commitments
  "Frau Bittner's team cleared 96 percent of Tuesday's queue with Fahras suggestions turned on. She sent a one-word email: 'Weiter.'",
  "We're on a 14-day sprint cadence now. Demo Fridays, retro Mondays. Karim insisted and he was right.",
  "Signed the NDA with the Hamburg logistics company on July 8th — they want a scoping call late August.",
  "A second pilot lead came inbound from Vienna — a travel booking startup. Discovery call July 24th at 2pm.",
  "Our AWS bill jumped to 340 euro in June. Embeddings are the culprit. Cap it before the pilot scales.",
  "Karim wants to rewrite the ingestion worker in Go. I said prove it in a branch first. October problem at the earliest.",
  "The Fahras logo is grandad's notebook spiral, abstracted. Anna sketched twelve versions before we landed on it.",
  "Registered fahras.io and fahras.de last year. The .com squatter wants four thousand dollars. He can keep it.",
  "Our pitch deck is nineteen slides. Marcus said cut it to twelve. He's right and it hurts.",
  "Prepare the mid-pilot metrics pack before the August 8th ops call — retention curve, deflection rate, the misfiling fix timeline.",
  "Invoice the Leipzig pilot for July by August 5th. The Qonto template is saved as 'Pilot-Monthly'.",
  "Karim finally took a full weekend off — first one since April. Nadia made him. Good.",
  "Fahras hit 500 indexed tickets on July 9th. Small number, real milestone. We printed the dashboard and taped it to the fridge.",
  "Never demo on hotel wifi again. Kassel taught me that in June.",
  "Book the stand at the SaaS meetup in Berlin on September 18th — applications close August 20th.",
  "Frau Bittner's ops lead is called Herr Maas. Bald, precise, asks about data residency every single call.",
  "All pilot data stays on EU servers — Hetzner in Falkenstein. That's a promise we made in writing.",
  "I still owe Karim the misfiling writeup — it's been on my list since Monday and it's becoming embarrassing.",
  // berlin / munich logistics
  "The movers are booked for August 30th, a Saturday. Confirmation number MV-2214 from Umzug Held.",
  "Herr Weber confirmed the deposit landed. One less 2am worry.",
  "Internet at the Berlin flat: Vodafone cable, install appointment September 3rd between 8 and 12.",
  "The kitchen in the Berlin flat has no oven, just a two-plate cooktop. Buying a used oven is on the September list.",
  "Return the Munich apartment keys to the Hausverwaltung on August 31st before noon.",
  "The Munich cellar still has two boxes of books I forgot about. Deal with them before the movers come.",
  "Anmeldung appointment in Berlin: September 5th at 11:40, Bürgeramt Prenzlauer Berg. Bring the Wohnungsgeberbestätigung from Herr Weber.",
  "Set up mail forwarding from the Munich flat starting September 1st — Deutsche Post Nachsendeauftrag, six months.",
  "The study in the Berlin flat faces east. Morning light for the plants, if I ever manage to keep plants alive.",
  "Neighbor intel from Herr Weber: the flat above is a retired opera singer who practices at 3pm sharp. Could be wonderful or terrible.",
  "Berlin climbing plan: Berta Block has a sister hall ten minutes from the new flat. Sofia already scouted it.",
  "Sell or donate the Munich microwave — it won't survive another move.",
  // people
  "Anna got a junior design offer from a Hamburg agency. She's torn — she was planning her own Berlin move next year.",
  "Tariq's oud lives in the corner of his flat. He plays Umm Kulthum badly after midnight and calls it heritage.",
  "Tariq starts at Zalando on September 15th. We land in Berlin within two weeks of each other, which feels like fate.",
  "Sofia sent a screenshot of a job posting at a climbing gear startup in Dresden. Asked what I thought. That's not nothing.",
  "Jonas mentioned a side project for the first time in years — something about factory sensor data. The Siemens escape plan begins.",
  "Frau Schneider says my German plateaued because I only practice vocabulary I already know. Painfully accurate.",
  "Ramy canceled a third call. I'm done initiating — if he wants to team up, he knows where I am.",
  "Met the Berlin flat's previous tenant, Katrin, at the handover. She left me a hand-drawn map of the neighborhood's best bakeries. Instant good omen.",
  "Nadia's baby shower is October 18th in Munich. Karim asked me to help plan the surprise part.",
  "My old Siemens manager, Dr. Vogel, connected me to two potential pilot customers. Kindness I didn't expect.",
  "Amr from the Paymob days is in Berlin now too, doing fintech consulting. We're overdue a koshari summit.",
  "Layla's residency roster came out — she got cardiology first rotation. She called me screaming. Happy screaming.",
  "Mom met Omar's fiancée Salma and approved within one tea. Historic speed.",
  "Herr Maas asked if Fahras could handle Kundendaten under BDSG as well as GDPR. Homework: have a real answer by the August 8th call.",
  "Sometimes I think Tariq agreed to Berlin partly to keep an eye on me after the Dina thing. He'd never say it.",
  // history, story-dated
  "Cairo, 2015: my first hackathon. We built a bus-tracking app that tracked exactly one bus. We won anyway.",
  "The 2018 World Cup — watched Egypt lose to Uruguay in the 89th minute from a rooftop in Zamalek. Heartbreak has a skyline.",
  "In 2020 I taught myself PyTorch during lockdown by reimplementing papers in a Nasr City bedroom while the city went quiet.",
  "March 2023: the Siemens offer letter arrived while I was in line for gas in Cairo. I read it four times.",
  "My first Oktoberfest, 2024: went ironically, stayed sincerely. Lederhosen remain a hard no.",
  "December 2024, Prague with Tariq: minus eleven degrees, best goulash of my life, worst hostel of my life.",
  "May 2025: gave my first conference talk, at a Munich Python meetup — forty people, two hard questions, one job offer I declined.",
  "February 2026: took the S-Bahn to Starnberger See alone, walked the frozen shore, and decided for real to quit Siemens. The lake did it.",
  "June 2026: my last day at Siemens. Jonas organized the sendoff at the Augustiner. I kept the name badge.",
  "April 2024: crashed the Cube on tram tracks in the rain. Nothing broken, helmet cracked. Always the helmet.",
  "New Year's 2026 in Cairo: the whole family on the roof, fireworks over Nasr City. Layla and I made the residency-vs-startup pact — both all-in, no whining.",
  "September 2019: graduation trip to Dahab. The Blue Hole at dawn. I still measure calm against that morning.",
  // tastes, quirks, noise — the distractor mass
  "Berlin döner ranking so far: Rüyam over Mustafa's, and I will die on this hill quietly.",
  "I've started drinking sparkling water like a German. Cairo me would be ashamed.",
  "New rule: the phone stays in the hallway after 11pm. Week two, holding.",
  "The A2 class did a field trip to a Biergarten to practice ordering. I panicked and pointed. Frau Schneider saw everything.",
  "I keep a running list of German words that sound like insults but aren't. 'Fahrtwind' is top three.",
  "Bought a moka pot for the Munich mattress era. The coffee ritual survives even when furniture doesn't.",
  "My reading pile: The Idea Factory again, a Naguib Mahfouz reread, and a German children's book Frau Schneider assigned without irony.",
  "I've decided the Berlin flat gets exactly one plant to start. Earn the second, plant.",
  "Weekend runs are now Tuesday-Friday runs. Weekends are for boxes until the move.",
  "The shisha bar on Sonnenallee knows my order now. Double apple, mint tea, corner table.",
  "I sleep with the window open, even in winter. German windows were built for people like me.",
  "Bought fabric from Aunt Mervat's shop on my last Cairo visit — Mom's making cushion covers for the Berlin flat.",
  "My grandmother's koshari has seven components. I can reliably nail five. The fried onions remain my nemesis.",
  "I've started saying 'genau' unironically. Integration is happening whether I consent or not.",
  "Podcast rotation: one Egyptian politics, one German learner's, and one startup show I'm too embarrassed to name.",
  "The Canon AE-1 has a light leak on the left edge now. Every photo looks like a memory of itself. I'm not fixing it.",
  "Tap water in Munich is Alpine and perfect. Everyone says Berlin's is worse. I'll be the judge.",
  "My desk setup fits in one backpack now: laptop, keyboard, mouse, one cable. Minimalism by necessity, kept by choice.",
  "Three years in Munich and the Marienplatz Glockenspiel still stops me mid-walk. A mechanical puppet show, undefeated.",
  "Friday's koshari attempt: 8 out of 10, onions almost right. Progress report filed with Mom, who remains unconvinced.",
  // health & admin
  "Blood donation at the DRK on July 29th at 5pm — O negative, they call me every eight weeks like clockwork.",
  "New glasses prescription picked up in June — slightly stronger left eye. Screen hours are winning.",
  "The physio says my right shoulder clicks from climbing overuse. Two stretches, twice a day, forever apparently.",
  "Travel insurance renews October 12th. Check whether it actually covers Egypt trips before renewing.",
  "The TK confirmed my insurance number transfers cleanly to Berlin. One bureaucratic dragon slain.",
  "Vitamin D through the winter, per the doctor. 'You live in Germany now,' she said. Fair.",
  "File the UG's Q3 VAT return with the accountant by October 10th — her name is Frau Albrecht, and she hates last-minute uploads.",
  "Update my address with N26, Qonto, and the consulate after the Anmeldung on September 5th.",
  // impressions & weight
  "Mom's 'I'm fine' had a cough behind it on Sunday's call. Booking her a checkup through Layla might be overstepping. Might do it anyway.",
  "Karim looked lighter on Monday's retro. The weekend off worked. Note to self: protect his weekends like they're mine.",
  "I catch myself narrating Munich in the past tense already. The city noticed first.",
  "Anna's sketches for the Fahras onboarding made Karim laugh out loud. First-hire energy, someday.",
  "Leaving feels less like loss this time. Maybe that's what the second migration teaches you.",
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

say(`seeding ${LIFE.length} memories into ${BASE}`);
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

// anything the stuck-sweep still caught, salvage passes
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
