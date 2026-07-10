// Seed a coherent demo life into Recall — every item passes through the
// real write envelope, so types, dues, hints, and entities are all earned.
// Usage: node scripts/seed-demo.mjs [baseUrl]
const BASE = process.argv[2] ?? "http://localhost:3001";

const LIFE = [
  "My name is Mahmoud. I'm an engineer — I moved from Cairo to Munich in 2023, and now I'm moving again, to Berlin.",
  "I quit my ML engineering job at Siemens in June to go full-time on my own thing. Scariest email I ever sent.",
  "I signed the lease for the Prenzlauer Berg apartment — move-in September 1st, 1450 euro warm. Herr Weber wants the deposit wired by August 1st.",
  "I met Tariq in 2019 at Ain Shams University. He's basically my brother at this point.",
  "My sister Layla starts her medical residency at Kasr Al Ainy hospital in Cairo this September. She's terrified of the night shifts.",
  "I told Layla I'd call her Sunday evening before her residency interview.",
  "Karim is my cofounder from the Cairo days. I was supposed to send him the updated pitch deck by July 10th and I still haven't.",
  "Mom's birthday is August 22nd. I need to order her that ceramic tagine she keeps hinting about before then.",
  "I'm allergic to penicillin. Ended up in the ER in 2019 because a doctor missed it on my chart.",
  "Don't ever schedule anything for me before 10am. I'm useless in the morning.",
  "Never bring up Dina unless I bring her up first.",
  "Flat whites in the morning, mint tea after dark. And I genuinely can't stand cilantro — tastes like soap to me.",
  "I shoot 35mm film, mostly on a Canon AE-1 I found at a Munich flea market. Digital feels too clean.",
  "Started German classes — A2 at the Volkshochschule, Tuesday and Thursday evenings.",
  "Dentist July 22nd at 3pm, the place on Kastanienallee.",
  "I need to renew my Egyptian passport before August 15th — the consulate booking system is a nightmare, so book early.",
  "My library book, The Idea Factory, is due back Monday.",
  "Ramy from the hackathon Discord wants to team up for the next one. Sharp guy, but he's canceled two calls on me already.",
  "I keep re-reading the Berlin lease at 2am. Maybe I'm more anxious about this move than I admit.",
];

let done = 0;
async function capture(content) {
  try {
    const r = await fetch(`${BASE}/api/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, source: "recall-app" }),
    });
    const d = await r.json();
    const e = d.envelope ?? {};
    console.log(
      `[${++done}/${LIFE.length}] ${e.type ?? "?"}${e.due ? ` due ${e.due}` : ""}${
        e.commitments?.length ? ` +${e.commitments.length} embedded` : ""
      } — ${content.slice(0, 56)}`,
    );
  } catch (err) {
    console.error(`FAILED — ${content.slice(0, 56)}: ${err.message}`);
  }
}

// concurrency 3 — the envelope call is the bottleneck
const queue = [...LIFE];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (queue.length) await capture(queue.shift());
  }),
);
console.log("seeded.");
