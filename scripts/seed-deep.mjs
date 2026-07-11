// Fourth life-seed: complexity. 150 memories that make the corpus argue
// with itself the way a real life does — multi-hop reversals (moved, then
// un-moved), commitments closed by later tellings, a namespace collision
// (a second Jonas, a second Weber), arcs that resolve, long documents
// with buried deadlines, deep history, and noise. Protected demo facts
// (book club, dentist, the unsigned Leipzig contract, the ninety
// seconds, the abstain traps) are never contradicted.
// Usage: node scripts/seed-deep.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[seed-deep] ${m}`);

const LIFE = [
  // ── the YC arc ──
  "Started the YC application tonight. The 'what do you understand that others don't' question is going to haunt me.",
  "YC application: Karim wrote the technical section in one sitting. He's better at bragging in writing than I am.",
  "I keep rewriting the YC one-liner. Current: 'Fahras gives support teams a memory.' Karim wants 'the memory layer for customer support.' He's probably right.",
  "Almost talked myself out of the YC application on Tuesday. Karim talked me back into it in eleven minutes.",
  "Decided: we submit the YC application Friday July 31st, four days before the deadline. No midnight heroics.",
  "Recorded the YC founder video on the third take. My accent got thicker every take, so take three it is.",
  "If we get YC interviews, they'd be in September — that would clash with the Berlin settling-in. A problem I'd love to have.",
  "The Hamburg logistics NDA people went quiet after the scoping call ask. Following up once in August, then letting it go.",
  "Our pilot pricing is 850 euro a month. Karim wanted 500. I held at 850 and Frau Bittner's boss didn't blink.",
  "Fahras crossed 700 indexed tickets today. The retention curve for the metrics pack finally looks like something.",
  "Wrote the July investor update — the first-Monday ritual held for the third month running.",
  "Marcus forwarded our deck to a Berlin fund called Nummer Acht Capital. Unprompted. Interesting.",
  "A partner at Nummer Acht Capital — Elena Roth — wants coffee in September once I'm settled in Berlin.",
  "Note to self: Elena Roth invests at pre-seed and wrote the first check into two dev-tools companies Karim respects.",
  "The demo laptop's new battery arrived. Kassel will never happen again.",
  "Sprint retro verdict: we ship too fast and document too little. Karim's phrase: 'we're building memory for others and keeping none ourselves.' It stung because it's true.",
  "Decided to write internal docs every Friday afternoon from now on. Demo Fridays become demo-and-docs Fridays.",
  "The .com squatter came back at two thousand dollars. Still no.",
  "Fahras got its first cold inbound signup from the meetup lead list — a Dresden e-commerce shop.",
  "Karim and I agreed: no new features until the mid-pilot review on August 8th. Stability sprint.",
  // ── Vienna + Leipzig, week two ──
  "The Vienna travel startup is called Fernweh Reisen. Their support lead, Herr Brandt, found us through Dr. Vogel.",
  "Prep sheet for the Vienna call: they do 3,000 tickets a month, mostly rebooking chaos. Fahras eats exactly this.",
  "The Vienna discovery call moved — Herr Brandt's assistant emailed, it's now Monday July 27th at 11am, not the 24th.",
  "Scratch that — Vienna confirmed Friday July 24th at 2pm after all, they un-moved it. Chaos before we've even signed them.",
  "Frau Bittner's team hit 97 percent deflection-assisted on Wednesday. She sent a second one-word email: 'Endlich.'",
  "Herr Maas approved the Hetzner data-residency writeup. One dragon down, the BDSG answer still owed by August 8th.",
  "Leipzig week two raw notes: 391 tickets ingested, hit rate 84 percent, two misfiles both from forwarded email chains. Fix the email-chain parser before July 28th. Also Frau Bittner wants the CSV exports column-configurable — promised it for the August 8th review.",
  "A junior agent in Leipzig, Timo, started answering tickets with Fahras suggestions verbatim. Frau Bittner made him rewrite them in his own words. She's right — that's a product lesson.",
  "Sketched the CSV export columns with Karim — shipping it well before the July 25th promise if the week behaves.",
  "Timo asked if Fahras could learn from resolved tickets automatically. Fourteen days into the pilot and the junior agent is writing our roadmap.",
  "Fernweh's procurement wants a German-language contract if we get past discovery. Ask Frau Albrecht whether her tax English extends to contract German — or find a lawyer.",
  "Dr. Vogel's second intro: a Nuremberg insurance broker's support desk. Parking it until after the Vienna call — one new conversation at a time.",
  "Decided: Leipzig pricing stays grandfathered at 850 even when we raise for new pilots. First believers keep their price.",
  "If Vienna signs, we need a second onboarding checklist that doesn't assume Frau Bittner-level patience.",
  "Wrote the misfiling writeup for Karim at last — eleven days late. His reply: 'worth the wait, never again.' Both true.",
  // ── the wedding + Cairo ──
  "Booked the Cairo flights for Omar's wedding: out October 6th, back October 13th, EgyptAir, window seat both ways obviously.",
  "Mom's assignment for the wedding: I'm carrying two kilos of German chocolate and a specific brand of hand cream only sold at dm.",
  "Omar asked me to give a toast at the wedding. In Arabic. My Arabic is fine; my toast Arabic is untested.",
  "Draft the wedding toast before the end of September — Omar's exact words: 'funny, but make Mom cry, the good way.'",
  "The wedding is at a Nile-side venue in Maadi. An October evening on the Nile — the one thing I miss most, scheduled.",
  "Salma's family insisted on meeting me before the wedding. Tea at Aunt Mervat's, first week of October.",
  "Hotel for the wedding week: staying at Heba's empty Zamalek apartment instead — she's in Toronto until December. Keys with the doorman.",
  "Suit situation: getting one tailored in Cairo the wedding week. Uncle Sameh knows a tailor in Heliopolis who dressed his own wedding in 1989.",
  "Layla threatened to show the bike-jump broken-arm photo at the wedding dinner. Deterrence negotiations ongoing.",
  "October 9th planning truth: the wedding week is also the only week Mom, Layla, and I will be in one city this year. Protect a free afternoon for just us three.",
  // ── health & body ──
  "Physio upgraded me: the shoulder is responding, stretches down to once a day. The click is quieter.",
  "New DRK donation booked for September 24th in Berlin — first donation as a Berliner.",
  "Ran 12k on Tuesday without noticing until the app told me. The Tuesday-Friday rhythm is working.",
  "Sleep experiment, week one: phone in the hallway plus no espresso after 2pm — average 7h12m, up forty minutes.",
  "Aspirin upsets my stomach — ibuprofen is fine. Worth remembering the difference at a pharmacy counter.",
  "The Berlin flat is a fourth-floor walkup. My knees will either become excellent or file a complaint.",
  "Target: sub-1:50 at the Berlin half marathon next spring. Jonas doesn't know I'm training to beat his ghost yet.",
  "Bought proper running shoes — the Munich pair died at 900 kilometers. The store's gait analysis says I overpronate left.",
  "The doctor renewed the vitamin D through winter and added: 'more fish, less shawarma.' We compromised at 'also fish.'",
  "Blue-light glasses verdict after two weeks: probably placebo, keeping them anyway. The placebo works.",
  // ── bureaucracy & money ──
  "The Anmeldung checklist from Katrin's neighborhood map is gospel: passport, lease, Wohnungsgeberbestätigung, and arrive twenty minutes early.",
  "Opened a second N26 sub-account just for the move — everything Berlin-transition gets paid from there. Budget: 4,200 euro.",
  "The Munich deposit comes back within four weeks of the August 31st handover, per the Hausverwaltung email. 2,850 euro, minus whatever they invent.",
  "Herr Weber's Wohnungsgeberbestätigung arrived signed, PDF and paper both. German landlords do not play about paper.",
  "The Rundfunkbeitrag transfers with the Anmeldung automatically — one bureaucracy that handles itself, a small miracle.",
  "Frau Albrecht flagged: the UG's Handelsregister address change and my personal Anmeldung are separate filings. Do not conflate them — her exact underlined words.",
  "Q3 VAT prep: export the Qonto statements monthly instead of quarterly. Frau Albrecht's inbox, her rules.",
  "The travel insurance answer came: Egypt trips covered, but 'adventure diving' excluded. The Blue Hole and I are officially just friends now.",
  "Set up the Deutsche Post Nachsendeauftrag online — 28,90 euro for six months. Confirmation number NS-77412.",
  "The TK app finally shows Berlin as my region. Bureaucracy speedrun: eleven days.",
  "German lesson from Frau Schneider that doubles as life advice: 'Termin ist Termin.' An appointment is an appointment.",
  "B1 course registration opens August 18th — Frau Schneider teaches the Tuesday-Thursday evening slot from September, online from Munich. Staying with her class across the move.",
  // ── people, deeper ──
  "Sofia got the Dresden interview. First round is a video call next Wednesday. She asked me to run a mock interview with her on Sunday.",
  "Sofia's mock interview verdict: she undersells the route-setting leadership. Told her to say 'I design problems for a living.' She lit up.",
  "Karim and Nadia found out it's a girl. He called me before he called his own brother. I keep thinking about that.",
  "Baby name shortlist per Karim: Amina, Layla — 'wait, no, that's taken in the friend group' — and Dunia. Nadia's veto pending.",
  "Anna took the Hamburg offer. Berlin loses a future first hire; Hamburg gains a great designer. The Fahras onboarding sketches were her parting gift — she said finish them without her.",
  "Anna's going-away picnic is July 26th at the Englischer Garten. Bring the AE-1 — she wants film photos, 'digital doesn't count for goodbyes.'",
  "Jonas sent the first screenshot of his factory-sensor side project. It's rough and it's REAL. 'The brave one,' he used to call me. Look who's talking now.",
  "Told Jonas about the sub-1:50 plan after all. His reply: 'then I'll train too. Ninety seconds becomes ninety-five.' War declared.",
  "Amr's koshari summit is set: last Sunday of July, his place in Neukölln. He claims his fried onions beat Grandma's recipe. He will be wrong, publicly.",
  "Amr's fintech consulting is going so well he's hiring. Asked if Fahras needs a fractional CFO someday. Someday, yes. Not at 850 a month of revenue.",
  "Katrin left a housewarming gift with Herr Weber: a hand-labeled jar of plum jam from the opera singer upstairs. The building has lore.",
  "The opera singer is Frau Adler, retired mezzo-soprano, thirty years at the Staatsoper. Herr Weber says her 3pm practice is 'the building's clock.'",
  "Timo from Leipzig asked for a reading list on search systems. Sent him three links and the misfiling writeup. Investing in the champion's apprentice.",
  "Dr. Vogel's birthday is August 11th — the man opened two doors for us in a month. Send something thoughtful, not corporate.",
  "Mom's checkup happened — Layla arranged it exactly as planned. Blood pressure slightly up, nothing scary, one new prescription. Mom's review: 'the doctor was young but polite.' The cough was 'just the dust.' We'll see.",
  "Layla's first cardiology shadow shift: she called at 1am her time, wired on hospital coffee, narrating an entire catheterization. The pact is working.",
  "Heba mailed the Zamalek apartment keys ahead — they arrived with a note: 'water the fern or face Toronto consequences.'",
  "Tariq found a flat! Friedrichshain, fifteen minutes from mine by bike. The Berlin chapter assembles itself.",
  "Tariq's flat news, part two: his building has a rooftop. New Year's on a Berlin rooftop is already being spoken into existence.",
  "Frau Schneider assigned me a tandem partner: Jonas Weber — no relation to my landlord, a Munich nurse learning English. Two Jonases and two Webers in one life now. The universe enjoys a namespace collision.",
  // ── reversals & updates ──
  "Moved my Berlin running plan: not Volkspark after all — Katrin's map says the Weißensee lake loop at 7am is the neighborhood's best-kept secret.",
  "Correction from Herr Weber: quiet hours are 10pm on weekdays, 11pm on weekends. The house rules PDF had a typo. Germany experienced a typo.",
  "The used-oven plan is dead — Katrin says the kitchen alcove is two centimeters too narrow for standard ovens. Induction plate plus the moka pot it is.",
  "Re-decided the oven thing AGAIN after measuring myself: the alcove is 59.5cm and compact 45cm ovens exist. Buying a compact oven in September. The two centimeters were Katrin's tape measure being dramatic.",
  "Pushed the SaaS meetup stand application through — submitted July 12th, three days after applications opened. Confirmation pending.",
  "The library renewed The Idea Factory one more time — final renewal, due back August 4th, same day as the YC deadline. The universe has a sense of humor.",
  "Alcohol pause until the move: decided after Anna's news hit harder than expected over two beers. Clear head till September 1st.",
  // ── boundaries & meta ──
  "New boundary: August 30th, moving day, is sacred — book nothing, suggest nothing. The calendar is a wall.",
  "If I start a sentence with 'quick thought' after midnight, remind me that sleep is also a thought.",
  "Never correct my German pronunciation out loud. Frau Schneider is enough correction for one lifetime.",
  "When I ask about Dina-adjacent memories for the letters, answer plainly and don't soften it. I'll ask when I'm ready; don't offer.",
  "Rule for the wedding week: no Fahras work calls October 6th through 13th. Karim has written sign-off authority that week.",
  "If Karim messages after 11pm his time, don't relay it until morning unless the word 'urgent' is in it verbatim.",
  // ── deep history, story-dated ──
  "2008, the Pentium 4 summer: Uncle Sameh handed me a screwdriver and said 'you break it, you own it.' I broke it. I owned it.",
  "2011: school kept closing, the city held its breath, and I taught myself HTML from a cybercafé CD by candlelight during the outages.",
  "2014: failed my first university entrance mock by four points. Dad's only comment: 'now you know the price of almost.'",
  "2016: first internship at a Maadi software house — unpaid, two buses each way. Learned SQL and the exact smell of 7am Cairo traffic.",
  "2018: our Ain Shams team won the university hackathon with a pharmacy-inventory app. Tariq slept under the table the second night. I have photos.",
  "May 2019: graduation day. Grandma came in her best dress and told everyone within earshot that I built 'the computers themselves.' I did not correct her.",
  "2020, week three of lockdown: taught Mom video calls. She now video calls me from the kitchen to show me pots. I regret nothing.",
  "December 2023: the first Munich winter broke me gently — sunset at 4:21pm. Bought the daylight lamp Tariq still mocks.",
  "March 2024: the Fahras idea was born in a Siemens hallway after a support engineer said 'we answer everything twice.' Wrote it on a napkin. Karim framed the napkin.",
  "October 2024: Oktoberfest with Jonas — he wore Lederhosen 'ironically' and got photographed for a tourism brochure. Leverage: infinite.",
  "August 2025: Dina and I hiked the Partnachklamm. Keeping this one; the letters can have the rest.",
  "January 2026: the residency-vs-startup pact got its written form — Layla's handwriting on hotel stationery, one copy each. Mine lives in the passport drawer.",
  // ── rituals & rhythms ──
  "First Monday of every month: the investor update. Non-negotiable, even when the update is 'still alive, still building.'",
  "Last Friday of the month is film drop-off day. The AE-1 rolls go to the lab on Torstraße once I'm in Berlin; Foto Sauter until then.",
  "Sunday koshari attempts continue: version nine scored 8.5 out of 10 from Tariq. The onions browned evenly for the first time. History.",
  "The first-of-the-month letter ritual, August edition planned: 'to the me unpacking boxes.'",
  "Quarterly ritual with Karim: one dinner, no laptops, state of the union. The Q3 edition is due before the wedding trip.",
  "Payday rule: ten percent to the 'Cairo flights forever' savings pot. Home is a standing line item.",
  // ── noise, texture, life ──
  "Rüyam gave me extra bread today. We are officially regulars.",
  "The U2 has a busker who plays the Amélie soundtrack on accordion at Senefelderplatz. Berlin is winking at me.",
  "Learned that 'Feierabend' has no English translation, and that's everything wrong with English work culture.",
  "The moka pot whistles a half-tone off from the kettle. The kitchen is slightly out of tune and I notice every morning.",
  "Berlin tap water verdict, preliminary: Munich wins, but Berlin's is fine. The dramatic warnings were dramatic.",
  "Fahrtwind update: 'Kummerspeck' — grief bacon — has entered the top three German words list.",
  "Sofia taught me to tape my fingers properly after two years of doing it wrong. Two YEARS.",
  "The shisha bar got new double-apple stock straight from Cairo. The corner table knows my order before I sit.",
  "Found a 1988 Cairo guidebook at a Munich flea market. The city in it is my parents' city. Bought it for Dad.",
  "The AE-1's light leak ate half the Prague roll — the surviving frames look haunted in the best way.",
  "Frau Schneider's German children's book plot twist: the hedgehog was the landlord all along. B1 cannot come soon enough.",
  "New rule discovered empirically: never grocery shop hungry at the Turkish market. I now own a kilo of pistachios.",
  "The Glockenspiel stopped me again today. Three years. Undefeated.",
  "The Kleinanzeigen buyer for the bookshelf ghosted twice, then showed up with exact change and a poem. Munich contains multitudes.",
  "My backpack's zipper died after six years and four countries. Repaired, not replaced. Loyalty.",
  "Podcast rotation update: dropped the embarrassing startup one, added a history of Cairo in twelve buildings. Balance restored.",
  "The Munich flat echo has a new trick: the mattress-on-floor era means I can hear my own alarm echo. Poetic. Annoying.",
  "Tariq's oud got a new string set. Midnight Umm Kulthum quality up fifteen percent, neighbor complaints steady.",
  "Berlin döner ranking update: a wildcard entered — the place by Senefelderplatz does a mean dürüm. Rüyam remains champion.",
  "Plant decision made: a snake plant, per Katrin — 'survives neglect and gaslighting.' Named it Ozymandias.",
  "The dm hand cream for Mom exists in three variants. Photographed all three labels. Awaiting maternal adjudication.",
  "Egypt friendly next month — watching at the Sonnenallee bar with Tariq, table already reserved. Some rituals move cities.",
  // ── long documents, embedded commitments ──
  "Packing plan v1, drafted Saturday: books get banker's boxes from the Getränkemarkt (free, ask Tuesdays), electronics travel with me not the van, the AE-1 rides in the backpack padded with the Cairo scarf. Cellar books decision deadline July 20th — donate or ship, no third option. Label EVERYTHING with room names in German, the movers' request. Kitchen packs last; the moka pot packs never — it rides shotgun.",
  "Vienna call prep notes: open with the rebooking-chaos number (3,000 tickets a month), demo the misfiling fix live, do NOT promise a German-language UI before Q1. Send Herr Brandt the one-pager by July 21st. If pricing comes up: 950 for new pilots, Leipzig grandfathered — say it without flinching.",
  "YC application war room notes from Sunday: the one-liner is locked ('Fahras gives support teams a memory'), Karim owns the metrics section until July 24th, I owe the founder story rewrite by July 26th, video re-record only if an interview invite comes. Application freeze July 29th, submit July 31st morning. Deadline discipline, no heroics.",
  "Wedding logistics doc, round one: flights booked October 6th to 13th, Zamalek keys secured, tailor slot to book by September 20th, toast draft due end of September, gift budget 200 euro — Omar gets the good film print framed, Salma's side gets the chocolate mountain. Free afternoon with Mom and Layla: October 8th, blocked, non-negotiable.",
  "Move-week master list: August 28th final pack-out check, August 29th cleaning crew at 9am — an exception to the no-mornings rule, pre-approved, once. August 30th the movers arrive 8am, confirmation MV-2214 — Tariq and I both ride Munich-side and drive behind the van. September 1st keys, September 2nd utilities switch with meter photos in BOTH flats, September 5th Anmeldung at 11:40.",
  // ── odds that round it to 150 ──
  "Elena Roth's fund newsletter quoted 'support is the new database' — either she reads our deck or great minds. The September coffee just got more interesting.",
  "Dr. Vogel's Nuremberg intro email sits starred and unanswered. Discipline is a to-do list that says no.",
  "The Fahras support inbox got its first unsolicited praise reply from an end customer of the Leipzig shop. Screenshot saved, printed, fridge.",
  "Herr Weber mailed a PAPER confirmation of the deposit on top of the email. Filed in the Germany folder, which is now two folders.",
  "The first thing going on the Berlin wall: the duplicate Karim made me of the framed Fahras founding napkin. The original stays with him in Munich.",
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
