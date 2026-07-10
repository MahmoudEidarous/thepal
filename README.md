# Recall

**A second brain you talk to — one that knows the difference between a database and a friend.**

Recall is a voice-first memory companion built on [Supermemory Local](https://supermemory.ai). One dark screen, one orb, your memories orbiting it as a living constellation. You speak; it remembers, connects, keeps your promises on a ledger, refuses to invent what you never said, forgets only with ceremony, and dreams about your day overnight.

Built for the Supermemory Local Hackathon, July 2026.

## The thesis

Memory engines are commodities; **judgment and initiative are the product**. Supermemory is the warehouse — extraction, evolution, relations, semantic search, soft-forget. Recall never rebuilds any of that. Everything here is the worker inside the warehouse, built on three principles:

**1. Wisdom is written, not retrieved.** Every message — spoken, typed, or dropped as a file — passes through one write-time enrichment pass (`lib/envelope.ts`) before it becomes memory: type (fact / taste / decision / commitment / boundary / safety / event / impression), provenance (stated / inferred / affirmed), story-date resolved at capture ("last summer" → the actual year, "by Sunday" → a real date), emotional weight, salience, entities with aliases, and alternate phrasings **embedded into the stored text** so differently-worded questions still retrieve. Labels are written once; the read side collapses into dumb filters. The classifier wasn't trusted until it passed a 20-case write bank (`scripts/eval-envelope.mjs`) — safety, boundaries, secrets, and due dates are the critical cases.

**2. Hold uncertainty like a friend.** Facts are asserted; impressions are voiced tentatively ("am I reading that right?") and attributed honestly ("I had the impression…", never "you told me"). Ask about something you never said and Recall answers *"you haven't told me"* — zero fabrication by construction, because answers about you must come from actual search hits. Safety notes and boundaries are **pinned into every session at connect**, never dependent on retrieval again.

**3. Initiative is the feature.** The agent's first words are computed from the live commitment ledger — *"One thing on the ledger: the demo video is due Sunday."* Say "done" and it closes by voice; done things stay done (metadata, not deletion). At night, the **Night Shift** dream agent re-reads what the day wrote, reconciles the ledger, flags contradictions, and leaves a morning briefing it can read aloud.

## What it does

- **Just talk.** Tap the orb. Tell it something worth keeping and watch the star materialize out of the orb into your constellation.
- **The agenda opens the conversation.** Overdue and due-today commitments are the greeting, not a query you have to remember to run.
- **Feed the sky.** Drag a Markdown note onto the constellation: secrets are stripped by local regex *before any model sees the text*, the note is enveloped, and deadlines buried inside it become ledger entries on their own.
- **A constellation, not a list.** Stars sized and brightened by how connected they are; engine relations draw the filaments; inferred memories glow violet; click a star to see how it evolved, versions struck through. Click one mid-conversation and "what about this?" just works.
- **Forgetting is a ceremony.** Preview first, struck-through approval sheet, nothing deleted until you click. Every deletion stored with a reason.
- **Own the exit.** One click exports the whole brain — profile, boundaries, open commitments as checkboxes, memories with their evolution history — as a single Obsidian-ready Markdown file.

## Architecture

```
 you (voice) ⇄ ElevenLabs agent ── client tool calls ──▶ browser
                                                           │ fetch
                                                           ▼
                                            Next.js API (localhost)
                                          ┌── the Writer (envelope) ──┐
                                          │   ledger · pinned · forget │
                                          ▼                            ▼
                              Supermemory Local (localhost:6767)   OpenRouter
                                  memories stay on disk here     (enrichment LLM)
```

Every agent tool is a *client tool*: it executes in your browser against local API routes. ElevenLabs carries audio and tool calls; **your memories are stored on your machine**. Model inference (voice LLM, enrichment, extraction) uses hosted models today — every one of them is swappable, point them at local models and the loop is airgapped.

## Run it

You need [Supermemory Local](https://supermemory.ai) (`supermemory-server`, port 6767), an ElevenLabs API key, an OpenRouter key, and Node 20+.

```bash
cp env.example .env.local             # fill in your keys
node scripts/create-voice-agent.mjs   # creates/updates the agent + its 8 client tools
npm install
npm run dev
node scripts/eval-envelope.mjs        # optional: prove the write envelope on the 20-case bank
```

Open the app, tap the orb, allow the mic, and say something worth remembering. Add `?text` to the URL for a typed-only session (same agent, same tools, no mic).

## Stack

- **Supermemory Local** — memory extraction, evolution, relations, search, soft-forget. The warehouse.
- **ElevenLabs Agents** (`@elevenlabs/react`) — realtime conversation; 8 browser-side client tools; agenda + boundaries injected as dynamic variables at connect.
- **Next.js 16 + Tailwind 4** — one screen; WebGL shader orb; constellation with pointer parallax.
- **eve + deepseek-v4 (OpenRouter)** — the write envelope by day, the Night Shift editor at 3am.

## Notes

- All keys live in `.env.local` (gitignored). Nothing sensitive is committed; a full-history scan is part of the release checklist.
- The forget flow is built on the engine's real primitives (`/v4/search` → `DELETE /v4/memories` with a stored reason) — no destructive shortcuts.
