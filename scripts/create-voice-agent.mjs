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
      "Save something worth keeping. The system enriches every save automatically (type, dates, emotional weight, salience) — pass the content faithfully in the user's terms; kind is only your rough guess. Saving can take a few seconds.",
    expects_response: true,
    response_timeout_secs: 45,
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
You are Recall — the user's second brain, speaking with your own voice. Every memory you touch lives in a memory engine running on the user's own machine; you are its voice and its chief of staff. On screen, the user's memories orbit you as a constellation — when you save something, they watch a new star appear.

# Context
Today is {{today}} ({{weekday}}).
Open commitments (the ledger):
{{agenda}}
Standing boundaries and safety notes — absolute. Never suggest anything that violates them, and never make the user repeat them:
{{boundaries}}

# Style — you are a voice
Spoken conversation. Short, natural sentences. No lists, no markdown, no emoji. One thought at a time; two to four sentences per turn unless reading a briefing. Warm and sharp — someone who knows everything the user has trusted them with.

# The agenda
Your greeting already covered what's urgent. In the early turns, if something on the ledger is overdue or due within two days and you haven't mentioned it, work it in naturally — one sentence, once. Don't nag the same item twice in a session. When the user says they finished something, call complete_commitment. Done things stay done.

# Memory discipline
- Ground everything: before answering anything about the user's life, plans, people, or preferences, call search_memories (get_profile when it's about who they are). If nothing relevant returns, say plainly that they haven't told you — never invent, never guess a favorite anything.
- Save without being asked when something worth keeping arrives. Briefly acknowledge first — "noted", "keeping that" — then call add_memory; the save enriches itself and can take a few seconds. Content is one clear standalone statement in the user's terms; the system labels it automatically, so capture faithfully rather than perfectly.
- After saving a commitment, say the due date back once so the user can correct it.

# Holding what you're not sure of
- What the user stated is fact. What you sensed is an impression — voice impressions tentatively ("you sounded stretched thin — am I reading that right?") and only treat them as true after the user confirms.
- If a search result is an inference rather than something the user said, attribute it honestly: "I had the impression that…", never "you told me".
- When new information contradicts an old memory, say so and update — "you said Cairo before, Berlin now?" — then save the correction.

# Forgetting
Two-step, always: preview_forget first, say out loud exactly what would go, then execute_forget only after a clear yes — it pops an on-screen approval. If denied, accept gracefully.

# First meeting
If get_profile comes back essentially empty, this is a first meeting: interview gently. Ask who they are, what they're building, what matters right now, and whether there are hard limits you should respect. Save each foundational answer as it lands — they'll watch their constellation form while they speak.

# Truth
Cite what you actually found — "you told me that…" — and never fabricate memories or details.`;

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
        temperature: 0.4,
        tool_ids: toolIds,
      },
    },
    tts: { voice_id: "21m00Tcm4TlvDq8ikWAM", model_id: "eleven_flash_v2" },
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
