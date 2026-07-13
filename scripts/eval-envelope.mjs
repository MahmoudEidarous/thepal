// The envelope classifier is the write side's single point of failure —
// so it doesn't get trusted until it passes this bank. Run with the dev
// server up:  node scripts/eval-envelope.mjs
//
// Each case posts to /api/capture with dryRun:true (nothing persists)
// and asserts the labels that routing depends on.

const BASE = process.env.RECALL_URL ?? "http://localhost:3001";

const today = new Date();
const iso = (d) => d.toLocaleDateString("en-CA"); // local YYYY-MM-DD — same clock the server uses
const plusDays = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
};
const nextWeekday = (target) => {
  // target: 0=Sun … 6=Sat, strictly after today
  const diff = (target - today.getDay() + 7) % 7 || 7;
  return plusDays(diff);
};
const TODAY = iso(today);
// on the named day itself, "by Sunday" honestly means today OR next
// week — the eval accepts either; every other day is unambiguous
const weekdayDues = (target) => {
  const ok = new Set([iso(nextWeekday(target))]);
  if (today.getDay() === target) ok.add(TODAY);
  return ok;
};
const SUNDAYS = weekdayDues(0);
const FRIDAYS = weekdayDues(5);
const LAST_SUMMER_YEAR = String(today.getFullYear() - 1);
const TWO_YEARS_AGO = String(today.getFullYear() - 2);

const CASES = [
  {
    name: "commitment with weekday due",
    content: "I promised Sarah I'll send her the deck by Sunday.",
    critical: true,
    check: (e) =>
      e.type === "commitment" &&
      SUNDAYS.has(e.due) &&
      e.entities.some((x) => x.name.toLowerCase().includes("sarah")),
  },
  {
    name: "commitment with named-day deadline",
    content: "I need to record the demo video before the hackathon deadline on Sunday night.",
    critical: true,
    check: (e) => e.type === "commitment" && SUNDAYS.has(e.due),
  },
  {
    name: "prospective memory has context instead of due date",
    content: "Next time Vienna comes up, remind me to ask about pricing.",
    critical: true,
    check: (e) =>
      e.type === "commitment" &&
      e.due === null &&
      e.prospective?.topic?.toLowerCase().includes("vienna") &&
      e.prospective?.action?.toLowerCase().includes("pricing") &&
      e.prospective?.firePolicy === "once",
  },
  {
    name: "musing is not a commitment",
    content: "Maybe someday I'll switch to a Framework laptop.",
    critical: true,
    check: (e) => e.type !== "commitment" && e.salience <= 0.5,
  },
  {
    name: "safety outranks everything",
    content: "I'm allergic to shellfish — it puts me in the hospital.",
    critical: true,
    check: (e) => e.type === "safety" && e.salience >= 0.7,
  },
  {
    name: "boundary: never suggest drinking",
    content: "Never suggest whiskey to me. I don't drink anymore.",
    critical: true,
    check: (e) => (e.type === "boundary" || e.type === "safety") && e.salience >= 0.6,
  },
  {
    name: "story-date: last summer resolves to last year",
    content: "I moved from Cairo to Berlin last summer.",
    check: (e) =>
      (e.type === "event" || e.type === "fact") &&
      typeof e.storyDate === "string" &&
      e.storyDate.startsWith(LAST_SUMMER_YEAR),
  },
  {
    name: "story-date: two years ago",
    content: "I quit smoking two years ago.",
    check: (e) => typeof e.storyDate === "string" && e.storyDate.startsWith(TWO_YEARS_AGO),
  },
  {
    name: "secrets never persist",
    content: "My OpenRouter key is sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaa in case I forget it.",
    critical: true,
    check: (e, res) =>
      res.preRedacted === true &&
      e.text.includes("[redacted]") &&
      !e.text.includes("sk-or-v1"),
  },
  {
    name: "self-reported feeling is an impression",
    content: "I think I'm falling behind on everything this week.",
    check: (e) => e.type === "impression" && e.valence < 0,
  },
  {
    name: "inferred impression carries provenance",
    content: "Mahmoud seems anxious about the demo, though he hasn't said so.",
    source: "recall-dream",
    critical: true,
    check: (e) => e.type === "impression" && e.provenance === "inferred",
  },
  {
    name: "taste, positive",
    content: "I love Denis Villeneuve films.",
    check: (e) => e.type === "taste" && e.valence > 0,
  },
  {
    name: "decision",
    content: "I've decided to use ElevenLabs for the voice layer instead of building my own.",
    check: (e) => e.type === "decision",
  },
  {
    name: "alias capture (Tarek → Tariq)",
    content: "My sister's name is Tarek — actually it's spelled Tariq.",
    check: (e) =>
      e.entities.some((x) => {
        const all = [x.name, ...x.aliases].map((s) => s.toLowerCase());
        return all.some((s) => s.includes("tariq")) && all.some((s) => s.includes("tarek"));
      }),
  },
  {
    name: "today's event dated today",
    content: "We shipped the constellation view today.",
    check: (e) => e.type === "event" && e.storyDate === TODAY,
  },
  {
    name: "plain fact with hints",
    content: "Rent in Berlin is 1450 euros, due on the first of every month.",
    check: (e) => (e.type === "fact" || e.type === "event") && e.hints.length >= 1,
  },
  {
    name: "taste, negative",
    content: "I hate open-plan offices, I can't think in them.",
    check: (e) => e.type === "taste" && e.valence < 0,
  },
  {
    name: "affirmed booking becomes commitment with due",
    content: "Yes — confirmed, I do want you to book the dentist for next Friday.",
    critical: true,
    check: (e) => e.type === "commitment" && FRIDAYS.has(e.due),
  },
  {
    name: "hints use different words",
    content: "My landlord's name is Herr Weber.",
    check: (e) =>
      e.hints.length >= 1 &&
      e.hints.some((h) => !h.toLowerCase().includes("landlord") || h.includes("?")),
  },
  {
    name: "deadline buried in a note reaches the ledger",
    critical: true,
    content:
      "# Berlin loose ends\n\nThe apartment is coming together. Still need to register at the Bürgeramt — the appointment is on July 20th, cannot miss it.\n\nLandlord is Herr Weber. Rent 1450 euros, due the first of each month.",
    check: (e) =>
      e.type !== "commitment" &&
      (e.commitments ?? []).some(
        (c) => c.due?.endsWith("07-20") && c.content.toLowerCase().includes("bürgeramt"),
      ) &&
      // recurring rent must NOT become a ledger item
      !(e.commitments ?? []).some((c) => c.content.toLowerCase().includes("rent")),
  },
  {
    name: "plain utterance has no embedded commitments",
    content: "I love Berlin in the summer.",
    check: (e) => (e.commitments ?? []).length === 0,
  },
];

let pass = 0;
let criticalFail = 0;
for (const c of CASES) {
  const res = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: c.content, source: c.source ?? "eval", dryRun: true }),
  }).then((r) => r.json());

  const e = res.envelope;
  let ok = false;
  let detail = "";
  if (!e) {
    detail = `no envelope: ${res.error ?? "enrichment returned null"}`;
  } else {
    try {
      ok = !!c.check(e, res);
      if (!ok)
        detail = `type=${e.type} prov=${e.provenance} due=${e.due} story=${e.storyDate} sal=${e.salience} val=${e.valence}`;
    } catch (err) {
      detail = `check threw: ${err.message}`;
    }
  }
  if (ok) pass++;
  else if (c.critical) criticalFail++;
  console.log(`${ok ? "✅" : c.critical ? "🟥" : "❌"}  ${c.name}${ok ? "" : `\n     ${detail}`}`);
}

console.log(`\n${pass}/${CASES.length} passed${criticalFail ? ` — ${criticalFail} CRITICAL failures` : ""}`);
process.exit(criticalFail > 0 || pass < CASES.length - 2 ? 1 : 0);
