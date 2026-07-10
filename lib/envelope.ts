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
  entities: z.array(z.object({ name: z.string(), aliases: z.array(z.string()) })).max(6),
  hints: z.array(z.string()).min(1).max(3),
  redacted: z.boolean(),
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
- text: the memory cleaned for keeping, meaning intact. Keep any [redacted] markers exactly; set redacted=true if present.
- type, exactly one:
  safety = allergies, medical constraints, sobriety — a wrong suggestion causes harm. Outranks everything.
  boundary = an explicit don't/limit the user set ("never suggest X").
  commitment = the user promised or must do a SPECIFIC thing. Recurring bills/routines are facts. Musing ("maybe someday") is never a commitment.
  taste = likes, dislikes, preferences, opinions ("I love/hate X").
  impression = a read on someone's inner state (stress, fear, mood) — not a preference, not a stated fact.
  decision = a choice the user made between options.
  event = something that happened at a time.
  fact = stable information that fits none of the above.
- provenance: stated = said plainly; inferred = read between the lines / observed; affirmed = user confirmed a guess. Impressions about someone who "seems" some way are inferred.
- storyDate: when the CONTENT happened or will happen (YYYY-MM-DD, or YYYY-MM / YYYY when coarser), resolved against today — never the ingest date. "last summer" in 2026 → 2025. null if timeless.
- due: commitments only — resolve relative dates against today using the weekday given ("by Sunday" = the next Sunday). null otherwise.
- valence −1..1, intensity 0..1: what the moment cost or meant emotionally.
- salience 0..1: identity, relationships, health, hard deadlines high; trivia low.
- entities: people/places/projects, alternate spellings as aliases of one entity.
- hints: 1-3 rephrasings or questions this memory answers, using DIFFERENT words than the original.`;

async function callEnricher(model: string, prompt: string, timeoutMs: number): Promise<Envelope> {
  const { object } = await generateObject({
    model: openrouter(model),
    schema: EnvelopeSchema,
    system: RULES,
    prompt,
    temperature: 0,
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
  try {
    return await callEnricher(MODEL_FLASH, prompt, 9_000);
  } catch {
    try {
      // flash occasionally stalls behind a slow provider — the retry
      // escalates to pro, which routes more reliably
      return await callEnricher(MODEL_PRO, prompt, 14_000);
    } catch (err) {
      console.warn(
        "envelope: enrichment failed, storing raw —",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
