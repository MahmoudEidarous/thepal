import { generateObject } from "ai";
import { z } from "zod";
import { openrouter, MODEL_FLASH, MODEL_PRO } from "./ai";

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
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

// Secrets never leave the machine: this runs BEFORE the enrichment
// call, so keys and passwords are stripped locally, not by the LLM.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // openai / openrouter style
  /sk_[A-Za-z0-9]{16,}/g, // elevenlabs style
  /sm_[A-Za-z0-9]{16,}/g, // supermemory
  /gsk_[A-Za-z0-9]{16,}/g, // groq
  /csk-[A-Za-z0-9]{16,}/g, // cerebras
  /ghp_[A-Za-z0-9]{20,}/g, // github
  /AKIA[A-Z0-9]{12,}/g, // aws
  /xoxb-[A-Za-z0-9-]{20,}/g, // slack
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // jwt
  /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/gi,
];

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    if (re.test(out)) {
      redacted = true;
      out = out.replace(re, "[redacted]");
    }
    re.lastIndex = 0;
  }
  return { text: out, redacted };
}

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
- commitments: promises or hard deadlines buried INSIDE a longer message (notes, documents), each as a standalone statement with its due date resolved. One-time obligations only — recurring bills, rent, and routines are facts of life, never ledger items. Empty when there are none — or when the whole message is itself the commitment (then use type=commitment instead).`;

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

export async function enrich(
  rawContent: string,
  source: string,
  today: string,
): Promise<Envelope | null> {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const prompt = `today: ${today} (${weekday})\nsource: ${source}\n\nmessage:\n${rawContent.slice(0, 6000)}`;
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
  return new Promise<Envelope | null>((resolve) => {
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
}
