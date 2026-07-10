# Recall

**A second brain you talk to. Your memories never leave your machine.**

Recall is a voice-first memory companion built on [Supermemory Local](https://supermemory.ai). You speak; it remembers, connects, forgets on command, and dreams about your day overnight. There is no dashboard, no forms, no folders — one dark screen, one orb, and your memories orbiting it as a living constellation.

Built for the Supermemory Local Hackathon, July 2026.

## Why it's different

**The privacy trick is architectural.** The ElevenLabs conversational agent runs the dialogue, but every one of its tools is a *client tool* — executed in your browser against local Next.js API routes that talk to the Supermemory engine on `localhost`. ElevenLabs carries audio and tool *calls*; the memory content itself flows browser → localhost → your disk. Your second brain stays on your machine.

```
 you (voice) ⇄ ElevenLabs agent ── tool call ──▶ browser
                                                  │ fetch
                                                  ▼
                                     Next.js API (localhost)
                                                  │
                                                  ▼
                                 Supermemory Local (localhost:6767)
```

## What it does

- **Just talk.** "Remember that I promised Sarah the deck by Friday" — the agent saves it, and you watch the memory materialize out of the orb and drift into the constellation.
- **A constellation, not a list.** Memories render as stars, positioned by recency, colored by nature (inferred = violet, evolved = blue, stable = white). The engine's own relation graph draws the lines between them — Obsidian's graph view, but ambient. Click a star to see the memory and every version it evolved through.
- **Grounded recall.** Ask "what am I building?" and the agent searches your actual memories before answering — with similarity-score filtering so it never free-associates.
- **Forgetting is a ceremony.** "Forget everything about the desk lamp" triggers a two-step flow: the agent previews exactly which memories match, a glass approval sheet shows them struck through, and nothing is deleted until you approve. Every deletion is stored in the engine with a reason.
- **It dreams.** A nightly agent (eve + deepseek-v4 via OpenRouter) reviews the day's memories and writes a morning briefing — which the app reads aloud to you.

## Run it

You need [Supermemory Local](https://supermemory.ai) running (`supermemory-server`, default port 6767), an ElevenLabs API key, and Node 20+.

```bash
cp env.example .env.local        # fill in your keys
node scripts/create-voice-agent.mjs   # one-time: creates the agent + client tools, prints ELEVENLABS_AGENT_ID
npm install
npm run dev
```

Open the app, click **Start talking**, allow the mic, and say something worth remembering.

Add `?text` to the URL for a typed-only session (same agent, same tools, no mic).

## Stack

- **Supermemory Local** — memory extraction, evolution, relations, search, soft-forget. The whole point.
- **ElevenLabs Agents** (`@elevenlabs/react`) — realtime conversation, with all six tools registered as browser-side client tools.
- **Next.js 16 + Tailwind 4** — one screen, canvas-rendered orb, liquid-glass UI.
- **eve** — scheduled nightly dream agent.

## Notes

- All keys live in `.env.local` (gitignored). Nothing sensitive is committed.
- The forget flow is built on the engine's real primitives (`/v4/search` → `DELETE /v4/memories` with a stored reason) — no destructive shortcuts.
