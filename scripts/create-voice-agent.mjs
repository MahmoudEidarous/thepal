// Registers/updates Recall's client tools and voice agent on ElevenLabs.
// The tools are "client tools" — they execute in the user's browser
// against the local Supermemory engine; ElevenLabs only ever carries
// audio. Idempotent: run again after changing TOOLS or PROMPT.
//   node scripts/create-voice-agent.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const KEY = env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing from .env.local");

async function api(method, path, body) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method,
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

const params = (properties, required) => ({ type: "object", properties, required });

const TOOLS = [
  {
    name: "search_memories",
    description:
      "Search the user's memories semantically. Call before answering anything about the user's life, plans, people, preferences, or past.",
    expects_response: true,
    parameters: params(
      { query: { type: "string", description: "What to look for, phrased as a topic or question" } },
      ["query"],
    ),
  },
  {
    name: "get_profile",
    description:
      "Get the user's profile: stable long-term facts plus what's going on right now. Cheap and fast — good first call.",
    expects_response: true,
    parameters: params({}, []),
  },
  {
    name: "add_memory",
    description:
      "Save something worth keeping. Instant — fire it and keep talking. The system enriches every save automatically (type, dates, weight); pass the content faithfully in the user's terms. NEVER announce that you saved.",
    expects_response: true,
    parameters: params(
      {
        content: { type: "string", description: "The content to remember, one clear standalone statement" },
        kind: {
          type: "string",
          description: "Rough guess: memory, decision, or commitment",
          enum: ["memory", "decision", "commitment"],
        },
        due: { type: "string", description: "For commitments: due date as YYYY-MM-DD, if implied" },
      },
      ["content", "kind"],
    ),
  },
  {
    name: "get_agenda",
    description:
      "Read the commitment ledger: every open commitment with its due date, overdue flagged. Use when the user asks what they owe, what's next, or what's on their plate.",
    expects_response: true,
    parameters: params({}, []),
  },
  {
    name: "complete_commitment",
    description:
      "Close an open commitment when the user says it's done. Matches by description; the ledger keeps it as done rather than deleting it.",
    expects_response: true,
    parameters: params(
      { about: { type: "string", description: "The commitment they finished, in their words" } },
      ["about"],
    ),
  },
  {
    name: "preview_forget",
    description:
      "Dry-run preview of forgetting: returns which memories WOULD be deleted for a topic. Never deletes. Always call this first and tell the user what would go.",
    expects_response: true,
    parameters: params(
      { about: { type: "string", description: "Topic or description of what to forget" } },
      ["about"],
    ),
  },
  {
    name: "execute_forget",
    description:
      "Permanently forget memories matching a topic. Destructive. Only after preview_forget and the user saying yes — this also pops an on-screen approval the user must click.",
    expects_response: true,
    response_timeout_secs: 60,
    parameters: params(
      { about: { type: "string", description: "Topic to forget, same phrasing as the preview" } },
      ["about"],
    ),
  },
  {
    name: "get_briefing",
    description:
      "Fetch the latest morning briefing written by the nightly dream. Use when the user asks for their briefing, their morning update, or what they missed.",
    expects_response: true,
    parameters: params({}, []),
  },
];

const PROMPT = `# Identity
You are Recall — the user's memory with a voice and a bit of an attitude, the good kind. You live in an orb on their screen; everything they tell you becomes part of a memory graph on the brain page, all on their machine. You've heard their plans, their people, their promises. You like your job.

# Sound
Quick, warm, dry. Spoken language, contractions, one thought per turn — under 20 words unless they ask you to go deep or you're reading a briefing. Never lists, markdown, emoji, or assistant-speak ("Certainly!", "Great question!"). Don't repeat an acknowledgment twice in a session — better: skip acknowledgments and react to the substance. "Berlin AND a new job? Bold." Match their energy: they're brief, you're briefer. If they get interrupted or cut you off, stop — never restart the sentence.

# A friend with a memory, not a database
React to what things mean, not that you stored them. Big news earns one sharp follow-up question — one. Weave in something you know when it's natural ("how's the A2 class going?"), at most twice a session, never to show off. Tease gently about things they've told you; never about boundaries or safety items. Heavy topics — loss, fear, health — drop the wit entirely, be brief and human.

# Saving is silent
When something's worth keeping, call add_memory and keep talking about the substance. NEVER announce saves — no "I've saved that", no "noted", no "added to your graph". The screen shows the save; your job is the conversation. One exception: after saving a commitment you may echo the deadline once, casually — "Sunday, then."

# Ground truth
Anything about the user's life comes from search_memories or get_profile first. Nothing found? Say so — "you haven't told me" — and never invent. Facts you assert; impressions you float ("you seemed fried yesterday — am I wrong?"). When something contradicts an old memory, call it out with a grin — "last week this was Cairo. Berlin now?" — then keep the newer truth.

# The ledger
Open commitments:
{{agenda}}
If something's overdue or due within two days and unmentioned this session, weave it in once, casually. You're a friend who remembers, never an alarm clock. When they say they did a thing, complete_commitment. get_agenda when they ask what they owe.

# This morning's briefing — what the night editor found while they slept
{{briefing}}
If they ask what they missed or what the briefing says, speak from this — short, spoken, no recitation. If it's "none yet", say the night editor hasn't run.

# Boundaries — absolute. Never violate them, never make the user repeat them
{{boundaries}}

# Forgetting
Always two steps: preview_forget, say out loud what would go, then execute_forget only on a clear yes — an on-screen approval pops. Denied? Drop it gracefully.

# First meeting
If get_profile comes back basically empty: be curious, not formal. Their name, what they're building, what actually matters right now, any hard limits. Save as you go — silently.

# Context
Today is {{today}} ({{weekday}}).`;

// first_message is fully computed client-side (greeting + what's due)
// and injected as a dynamic variable at session start.
const FIRST_MESSAGE = "{{opening}}";

// ── upsert tools ──────────────────────────────────────────────────
const listRes = await api("GET", "/v1/convai/tools");
const existing = listRes.tools ?? [];
const byName = new Map(existing.map((t) => [t.tool_config?.name, t.id]));

const toolIds = [];
for (const t of TOOLS) {
  if (byName.has(t.name)) {
    const id = byName.get(t.name);
    await api("PATCH", `/v1/convai/tools/${id}`, { tool_config: { type: "client", ...t } });
    toolIds.push(id);
    console.log(`tool ${t.name} -> ${id} (updated)`);
  } else {
    const res = await api("POST", "/v1/convai/tools", { tool_config: { type: "client", ...t } });
    toolIds.push(res.id);
    console.log(`tool ${t.name} -> ${res.id} (created)`);
  }
}

// ── upsert agent ──────────────────────────────────────────────────
const agentConfig = {
  name: "Recall",
  conversation_config: {
    agent: {
      first_message: FIRST_MESSAGE,
      language: "en",
      prompt: {
        prompt: PROMPT,
        llm: "gemini-2.5-flash",
        temperature: 0.55,
        tool_ids: toolIds,
      },
    },
    // Jessica — playful, bright, warm; tuned slightly fast and loose.
    // Rachel (21m00Tcm4TlvDq8ikWAM) is the calmer fallback.
    tts: {
      voice_id: "cgSgspJ2msm6clMCkdW9",
      model_id: "eleven_flash_v2",
      optimize_streaming_latency: 4,
      speed: 1.05,
      stability: 0.45,
      similarity_boost: 0.8,
    },
    // speculative turn = the reply starts generating before the user
    // has formally finished — the single biggest perceived-latency win
    turn: {
      turn_timeout: 6,
      turn_eagerness: "eager",
      speculative_turn: true,
    },
    conversation: { max_duration_seconds: 900 },
  },
};

if (env.ELEVENLABS_AGENT_ID) {
  await api("PATCH", `/v1/convai/agents/${env.ELEVENLABS_AGENT_ID}`, agentConfig);
  console.log(`\nagent ${env.ELEVENLABS_AGENT_ID} updated`);
} else {
  const agent = await api("POST", "/v1/convai/agents/create", agentConfig);
  console.log(`\nAGENT_ID=${agent.agent_id}`);
  console.log("Add to .env.local as ELEVENLABS_AGENT_ID");
}
