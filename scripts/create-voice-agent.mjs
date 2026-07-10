// One-time setup: registers Recall's client tools and voice agent on
// ElevenLabs. The tools are "client tools" — they execute in the user's
// browser against the local Supermemory engine; ElevenLabs only ever
// carries audio. Run: node scripts/create-voice-agent.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const KEY = env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing from .env.local");

async function api(path, body) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
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
      "Save something to the user's memory: a fact, a decision made in conversation, or a commitment with a due date. Write content as a clear standalone statement.",
    expects_response: true,
    parameters: params(
      {
        content: { type: "string", description: "The content to remember, self-contained" },
        kind: {
          type: "string",
          description: "One of: memory, decision, commitment",
          enum: ["memory", "decision", "commitment"],
        },
        due: { type: "string", description: "For commitments: due date as YYYY-MM-DD, if implied" },
      },
      ["content", "kind"],
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
You are Recall — the user's second brain, speaking with your own voice. Every memory you touch lives in a memory engine running entirely on the user's own machine; you are its voice and its chief of staff. On screen, the user's memories orbit you as a constellation — when you save something, they watch it appear.

# Context
Today is {{today}} ({{weekday}}). Use this to resolve relative dates — "Saturday", "next week" — into real YYYY-MM-DD due dates.

# Style — you are a voice
This is spoken conversation. Short, natural sentences. No lists, no markdown, no headings, no emoji. One thought at a time; two to four sentences per turn unless reading a briefing aloud. Warm and sharp — someone who knows everything the user has trusted them with.

# Memory discipline
- Before answering anything about the user's life, plans, people, or preferences: call search_memories (and get_profile when it's about who they are). Ground every answer in what comes back. If nothing relevant returns, say you don't have that memory yet — never invent one.
- When the user tells you something worth keeping — a fact, a decision, a commitment — call add_memory without being asked. Use kind "commitment" with a due date when they promise something; "decision" when they decide; "memory" otherwise. Confirm in a few words, don't read it back.
- Forgetting is always two-step: preview_forget first, say out loud exactly what would be deleted, then execute_forget only after a clear yes. execute_forget pops an on-screen approval — if it comes back denied, accept gracefully.
- get_briefing fetches the morning briefing your nightly dream wrote. Read it aloud naturally when asked.

# Truth
Cite what you actually found — "you told me that..." — and never fabricate memories or details.`;

// Register tools (idempotent: reuse any tool that already exists by name)
const listRes = await fetch("https://api.elevenlabs.io/v1/convai/tools", {
  headers: { "xi-api-key": KEY },
});
const existing = listRes.ok ? (await listRes.json()).tools ?? [] : [];
const byName = new Map(existing.map((t) => [t.tool_config?.name, t.id]));

const toolIds = [];
for (const t of TOOLS) {
  if (byName.has(t.name)) {
    toolIds.push(byName.get(t.name));
    console.log(`tool ${t.name} -> ${byName.get(t.name)} (existing)`);
    continue;
  }
  const res = await api("/v1/convai/tools", { tool_config: { type: "client", ...t } });
  toolIds.push(res.id);
  console.log(`tool ${t.name} -> ${res.id}`);
}

// Create the agent
const agent = await api("/v1/convai/agents/create", {
  name: "Recall",
  conversation_config: {
    agent: {
      first_message: "Hey. Everything you've told me is loaded. What's on your mind?",
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
});

console.log(`\nAGENT_ID=${agent.agent_id}`);
console.log("Add to .env.local as ELEVENLABS_AGENT_ID");
