import { generateObject } from "ai";
import { z } from "zod";
import { openrouter, MODEL_FLASH, MODEL_PRO } from "./ai";

export { redactSecrets } from "./memory/redaction";

// ── The write envelope ────────────────────────────────────────────
// One enrichment pass on every message before it becomes memory, so
// wisdom is encoded at write time instead of chased at read time.
// If this pass fails, the memory is stored raw — the enricher may
// hiccup, but a memory is never lost to it.

export const ENVELOPE_TYPES = [
  "fact",
  "taste",
  "decision",
  "commitment",
  "boundary",
  "safety",
  "event",
  "impression",
] as const;

export const EnvelopeSchema = z.object({
  text: z.string(),
  type: z.enum(ENVELOPE_TYPES),
  provenance: z.enum(["stated", "inferred", "affirmed"]),
  storyDate: z.string().nullable(),
  due: z.string().nullable(),
  valence: z.number().min(-1).max(1),
  intensity: z.number().min(0).max(1),
  salience: z.number().min(0).max(1),
  entities: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()),
        kind: z.enum(["person", "place", "thread", "thing"]),
      }),
    )
    .max(6),
  hints: z.array(z.string()).min(1).max(3),
  redacted: z.boolean(),
  // promises/deadlines found INSIDE a longer message — each becomes its
  // own ledger entry. Empty when the message itself IS the commitment.
  commitments: z
    .array(z.object({ content: z.string(), due: z.string().nullable() }))
    .max(5),
  // an intention whose due moment is contextual rather than calendrical:
  // "next time Vienna comes up, remind me about pricing". It remains a
  // commitment, but lives in the prospective ledger instead of today's
  // agenda and fires only when its topic returns in conversation.
  prospective: z
    .object({
      topic: z.string(),
      action: z.string(),
      firePolicy: z.literal("once"),
    })
    .nullable(),
  // when the message reschedules/replaces one of the OPEN ledger items
  // shown to the enricher: that item's number. The reschedule pattern —
  // "the Sofia meeting is tomorrow now" must retire the old telling, or
  // the ledger nags twice.
  supersedes: z.number().nullable(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

const RULES = `You are the write-side enricher of a personal memory system. One message arrives; you emit its envelope so the read side never has to guess. Output every field.

field rules:
- text: the memory cleaned for keeping, meaning intact. Keep any [redacted] markers exactly; set redacted=true if present. When type=commitment, text is the promise itself and nothing else.
- type, exactly one:
  safety = allergies, medical constraints, sobriety — a wrong suggestion causes harm. Outranks everything.
  boundary = an explicit don't/limit the user set ("never suggest X").
  commitment = the message IS a promise or a specific must-do, and says little else. A longer note or document that merely CONTAINS a deadline keeps its own type — the deadline goes into commitments[] instead. Recurring bills/routines are facts. Musing ("maybe someday") is never a commitment.
  taste = likes, dislikes, preferences, opinions ("I love/hate X").
  impression = a read on someone's inner state (stress, fear, mood) — not a preference, not a stated fact.
  decision = a choice the user made between options. But confirming/booking/scheduling something that must HAPPEN — an appointment, a reservation, a booking — is a commitment with its due date, never a decision.
  event = something that happened at a time.
  fact = stable information that fits none of the above.
- provenance: stated = said plainly; inferred = read between the lines / observed; affirmed = user confirmed a guess. Impressions about someone who "seems" some way are inferred.
- storyDate: when the CONTENT happened or will happen (YYYY-MM-DD, or YYYY-MM / YYYY when coarser), resolved against today — never the ingest date. "last summer" in 2026 → 2025. null if timeless.
- due: commitments only — resolve relative dates against today using the weekday given ("by Sunday" = the next Sunday). null otherwise.
- valence −1..1, intensity 0..1: what the moment cost or meant emotionally.
- salience 0..1: identity, relationships, health, hard deadlines high; trivia low.
- entities: who and what this is about; alternate spellings as aliases of one entity. kind: person (a human) · place (city, neighborhood, venue, country) · thread (an ongoing storyline — a move, a pilot, an application, a course) · thing (org, product, object, team).
- hints: 1-3 rephrasings or questions this memory answers, using DIFFERENT words than the original.
- commitments: promises or hard deadlines buried INSIDE a longer message (notes, documents), each as a standalone statement with its due date resolved. One-time obligations only — recurring bills, rent, and routines are facts of life, never ledger items. Empty when there are none — or when the whole message is itself the commitment (then use type=commitment instead).
- prospective: a forward memory whose trigger is a future CONTEXT rather than a date — "next time Vienna comes up, remind me to ask about pricing", "when I mention Layla again, ask how the interview went". Output {topic, action, firePolicy:"once"}; topic is the shortest specific person/place/project/thread phrase that should trigger it, action is what Recall must say or ask. Set type=commitment, due=null, commitments=[] and keep the full intention in text. null for ordinary reminders, dated promises, and statements that merely contain words like "next time" without asking Recall to remember forward.
- supersedes: when an "open ledger" list is provided and the message RESCHEDULES or REPLACES one of those items — same errand, new day/time/terms — output that item's number. It must be the same task: a different errand for the same person is NEVER a supersede ("send Brandt the contract" does not supersede "send Brandt the one-pager"). null when no list is given, or nothing matches, or the message merely mentions an item.`;

async function callEnricher(model: string, prompt: string, timeoutMs: number): Promise<Envelope> {
  const { object } = await generateObject({
    // route to the fastest provider — slow upstreams were the main
    // source of enrichment timeouts. Reasoning must be OFF: providers
    // began serving hybrid-reasoning deepseek variants (2026-07-12)
    // that burn the whole token budget thinking before the JSON,
    // nulling every envelope.
    model: openrouter(model, {
      extraBody: { provider: { sort: "throughput" }, reasoning: { enabled: false } },
    }),
    schema: EnvelopeSchema,
    system: RULES,
    prompt,
    temperature: 0,
    // an envelope is ~700 tokens — but a long note's envelope echoes the
    // note in its text field, so the ceiling scales with the input.
    // Without any cap the SDK asks for the model's whole 65k window and
    // OpenRouter's affordability pre-check rejects the call whenever
    // credits run low.
    maxOutputTokens: prompt.length > 1400 ? 4500 : 2000,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  return object;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Local-date convention everywhere: this server runs on the user's own
// machine, so the machine's "today" IS the user's today.
export function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

// Providers occasionally disagree on whether "next Friday" means the
// coming Friday or the one after it. The Writer already knows today's
// exact local date, so explicit next-weekday commitments do not need a
// model opinion: resolve the next occurrence strictly after today. The same
// rule applies to explicit by/on weekdays; providers occasionally return the
// adjacent calendar date even while classifying the commitment correctly.
const NAMED_WEEKDAY =
  /\b(?:next|by|on|before)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;

function pinNextWeekdayDue(envelope: Envelope | null, raw: string, today: string): Envelope | null {
  if (!envelope || envelope.type !== "commitment") return envelope;
  const named = [...raw.matchAll(NAMED_WEEKDAY)].map((match) => match[1].toLowerCase());
  const unique = [...new Set(named)];
  if (unique.length !== 1) return envelope;
  const target = WEEKDAYS.findIndex((day) => day.toLowerCase() === unique[0]);
  const [year, month, day] = today.split("-").map(Number);
  const base = new Date(year, month - 1, day, 12);
  const diff = (target - base.getDay() + 7) % 7 || 7;
  base.setDate(base.getDate() + diff);
  return { ...envelope, due: base.toLocaleDateString("en-CA") };
}

const FIRST_PERSON_STATE = /\bI(?:'m| am| feel| think| have|'ve)\b/i;
const TEMPORARY_STATE =
  /\b(anxious|stressed|overwhelmed|exhausted|burned out|falling behind|afraid|scared|sad|low|angry|frustrated|excited|hopeful|lonely)\b/i;

export function pinTemporarySelfStateType(
  envelope: Envelope | null,
  raw: string,
): Envelope | null {
  if (!envelope || (envelope.type !== "fact" && envelope.type !== "event")) return envelope;
  if (!FIRST_PERSON_STATE.test(raw) || !TEMPORARY_STATE.test(raw)) return envelope;
  return { ...envelope, type: "impression" };
}

// a note that smells of deadlines but enveloped with zero commitments
// is the enricher's one measured flake (~1 run in 4) — worth one
// second opinion, and only then. The nose is wide on purpose: any
// concrete date or obligation word ("on July 20th", "due", "cannot
// miss") counts — a false sniff costs one cheap extra call.
const DEADLINE_SMELL =
  /\b(due|deadline|cannot miss|must not miss|by (mon|tues|wednes|thurs|fri|satur|sun)[a-z]*)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.? \d{1,2}(st|nd|rd|th)?\b|\d{4}-\d{2}-\d{2}/i;

export async function enrich(
  rawContent: string,
  source: string,
  today: string,
  openLedger: string[] = [],
): Promise<Envelope | null> {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  // the enricher sees the open ledger so a retelling can retire the item
  // it replaces — semantic matching where similarity thresholds can't
  // tell "the Sofia meeting moved" from "a different errand for Sofia"
  const ledgerBlock = openLedger.length
    ? `\nopen ledger:\n${openLedger
        .slice(0, 20)
        .map((c, i) => `${i + 1}. ${c.slice(0, 110)}`)
        .join("\n")}\n`
    : "";
  const prompt = `today: ${today} (${weekday})\nsource: ${source}\n${ledgerBlock}\nmessage:\n${rawContent.slice(0, 6000)}`;
  // some inputs are deterministically slow to envelope (dense notes with
  // embedded commitments) — the budget must outlast them. Typical calls
  // finish in 3-7s; the ceiling only matters when it would otherwise
  // null a perfectly good envelope. Documents get even more room.
  const timeoutMs = rawContent.length > 1200 ? 40_000 : 25_000;

  // hedged race, quality-ordered. Utterances go flash-first (speed);
  // documents go PRO-first — flash providers wobble on embedded-
  // commitment extraction under the full schema (measured 2026-07-12:
  // buried deadlines vanish 2 runs in 3), and nobody is waiting on the
  // async document path. Either way the laggard launches on a timer (or
  // instantly on failure) and the first success wins.
  // a spoken utterance never carries a newline; notes and dropped files
  // do — and they're where embedded commitments hide
  const isDoc = rawContent.length > 800 || rawContent.includes("\n");
  const firstModel = isDoc ? MODEL_PRO : MODEL_FLASH;
  const secondModel = isDoc ? MODEL_FLASH : MODEL_PRO;
  const hedgeMs = isDoc ? 8_000 : 3_500;
  const raceOnce = () => new Promise<Envelope | null>((resolve) => {
    let done = false;
    let secondStarted = false;
    let firstFailed = false;
    let secondFailed = false;
    const finish = (v: Envelope) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const giveUp = (err: unknown) => {
      if (!done) {
        done = true;
        console.warn(
          "envelope: enrichment failed, storing raw —",
          err instanceof Error ? err.message : err,
        );
        resolve(null);
      }
    };
    const onSecondFail = (e: unknown) => {
      secondFailed = true;
      if (firstFailed) giveUp(e);
    };
    const startSecond = () => {
      if (done || secondStarted) return;
      secondStarted = true;
      clearTimeout(timer);
      callEnricher(secondModel, prompt, timeoutMs).then(finish).catch(onSecondFail);
    };
    callEnricher(firstModel, prompt, timeoutMs)
      .then(finish)
      .catch((e) => {
        firstFailed = true;
        if (secondFailed) giveUp(e);
        else startSecond();
      });
    const timer = setTimeout(startSecond, hedgeMs);
  });

  // policy, enforced deterministically: recurring bills and routines are
  // never ledger items. The models agree ~half the time; the filter
  // agrees always.
  const RECURRING =
    /\b(each|every|per)\s+(month|week|day|year|morning|evening)\b|\b(monthly|weekly|yearly|annually)\b/i;
  const dropRecurring = (e: Envelope | null): Envelope | null =>
    e ? { ...e, commitments: e.commitments.filter((c) => !RECURRING.test(c.content)) } : e;

  const first = pinTemporarySelfStateType(
    pinNextWeekdayDue(dropRecurring(await raceOnce()), rawContent, today),
    rawContent,
  );
  // the one measured flake: a deadline-smelling note enveloped with an
  // empty commitments[] (~1 run in 4). Under the full 11-field schema
  // BOTH models sometimes drop buried deadlines; under a minimal schema
  // neither does (measured 3/3). So the second opinion asks exactly one
  // question with exactly two fields.
  if (
    first &&
    isDoc &&
    first.type !== "commitment" &&
    first.commitments.length === 0 &&
    DEADLINE_SMELL.test(rawContent)
  ) {
    try {
      const { object } = await generateObject({
        model: openrouter(MODEL_PRO, {
          extraBody: { provider: { sort: "throughput" }, reasoning: { enabled: false } },
        }),
        schema: z.object({
          commitments: z
            .array(z.object({ content: z.string(), due: z.string().nullable() }))
            .max(5),
        }),
        system:
          "Find the one-time promises and hard deadlines buried in this note — appointments, submissions, registrations, each as one standalone statement with its due date resolved against today (YYYY-MM-DD, null if undated). Recurring bills, rent, and routines are facts of life, never commitments. Empty array if there are truly none.",
        prompt: `today: ${today}\n\nnote:\n${rawContent.slice(0, 6000)}`,
        temperature: 0,
        maxOutputTokens: 800,
        abortSignal: AbortSignal.timeout(20_000),
      });
      const found = object.commitments.filter((c) => !RECURRING.test(c.content));
      if (found.length > 0) return { ...first, commitments: found };
    } catch {
      // the first envelope stands — words are already safe
    }
  }
  return first;
}
