# thepal

### Not a chatbot with memory. A friend with history.

**thepal** is a local-first relationship memory engine built with **Supermemory Local**, **SQLite**, and realtime voice.

It does more than retrieve old messages. It preserves what happened, maintains what is still true, follows unfinished situations, remembers things forward, and decides whether a remembered detail deserves to enter the conversation.

> Memory infrastructure is not the product.
> **Judgment, continuity, initiative, and the relationship are.**

Built for the **Supermemory Local Hackathon — July 2026**.

---

## What makes thepal different?

Most chatbot memory systems follow the same pattern:

1. Store conversation chunks.
2. Search for semantically similar text.
3. Insert the results into the prompt.
4. Ask the model to decide what they mean.

That works for simple recall:

> “What is my favorite color?”

It becomes unreliable when real life changes:

* A meeting moves to another date.
* Someone changes roles in a project.
* Two people have similar names.
* A temporary emotion should not become a personality trait.
* A situation remains unfinished across several sessions.
* The user asks to be reminded when a topic returns.
* A relevant memory would still be inappropriate to mention.

thepal adds the missing judgment layer around semantic retrieval.

| Ordinary memory RAG                  | thepal                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| Retrieves related text               | Compiles current, historical, conflicting, and unknown truth |
| Stores isolated facts                | Tracks living situations and unresolved threads              |
| Remembers backward                   | Also remembers forward through conversational triggers       |
| Treats relevance as permission       | Uses attention gates and intelligent silence                 |
| Overwrites or duplicates corrections | Preserves evidence while updating current truth              |
| Remembers only the user              | Also remembers its own promises, mistakes, and repairs       |
| Deletes visible records              | Rebuilds dependent state and purges the semantic mirror      |
| Starts every session cold            | Loads a bounded continuity model before speaking             |

---

## The core idea

```text
Preserve what happened.
Compile what is true now.
Follow what is still alive.
Choose what deserves the room.
```

Supermemory Local provides fast semantic discovery.

thepal owns the authority around it:

* provenance,
* current truth,
* validity over time,
* unresolved life,
* future intentions,
* context boundaries,
* proactive judgment,
* relationship repair,
* deletion,
* and user control.

> **Supermemory finds. thepal decides.**

---

## Architecture

```text
                    Voice · Text · Files · Tools
                               │
                               ▼
                   Write-Time Enrichment Pass
          type · time · entities · aliases · sensitivity
                               │
                               ▼
                    Canonical Evidence Ledger
                         SQLite · local-first
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
     Claims and Beliefs                    Supermemory Local
 current · historical · conflict          semantic discovery
 tentative · unknown · expired            embeddings · neighbors
            │                                     │
            └──────────────────┬──────────────────┘
                               ▼
                       Living Continuity
        threads · people · projects · future intentions
        commitments · routines · emotional episodes
                               │
                               ▼
                     Bounded Context Compiler
       applicable · relevant · grounded · permissioned
                               │
                               ▼
                      Unified Attention Engine
          hard gates · cooldowns · repair priority
                 one proactive aside—or silence
                               │
                               ▼
                     Relationship and Presence
       promises · boundaries · repair · humor · voice
                               │
                               ▼
                         Natural conversation
```

Data flows upward.

Authority stays constrained.

Semantic similarity can propose a memory, but it cannot silently turn that memory into current truth, a behavioral rule, or permission to interrupt.

---

## Core capabilities

### 1. Canonical evidence ledger

Every durable memory begins as an immutable, source-linked event in local SQLite.

Each event retains:

* who or what produced it,
* when it was recorded,
* when it applies,
* trust level,
* sensitivity,
* revision history,
* and a stable payload hash.

Network enrichment and semantic indexing happen after the local write succeeds.

A provider failure cannot erase the original telling.

---

### 2. Temporal truth

thepal does not treat conversation history as a flat list of equally valid statements.

A claim can be:

* current,
* historical,
* tentative,
* conflicting,
* unknown,
* expired,
* corrected,
* or retracted.

Example:

```text
July 11
“The Vienna call is on the 27th.”

July 14
“It moved to the 24th.”
```

The result is not two competing memories.

```text
Current truth: July 24
Historical truth: July 27
Evidence: both original tellings preserved
```

Recency alone does not invent certainty. Equal-authority contradictions remain unresolved until the user clarifies them.

---

### 3. Living situations and open loops

Life is not a pile of facts.

> “I’m waiting to hear from Karim.”

describes an unfinished situation with:

* participants,
* current state,
* expected next development,
* review timing,
* transitions,
* and eventual resolution.

thepal tracks these situations as **life threads** across:

* people,
* projects,
* places,
* goals,
* health,
* decisions,
* commitments,
* problems,
* and waiting states.

This enables natural continuity:

> “Did Karim ever get back to you?”

without turning the conversation into a task manager.

---

### 4. Prospective memory

Most memory systems only look backward.

thepal can also remember forward:

> “Next time I mention the lease, remind me to check whether internet is included.”

This creates a conversational trigger rather than a calendar reminder.

Prospective memories support:

* exact-first matching,
* guarded semantic fallback,
* one-time firing,
* explanation,
* snoozing,
* resolution,
* cancellation,
* and cooldowns.

Remembering something does not automatically grant permission to speak. The trigger must still pass the attention layer.

---

### 5. Continuity across sessions

A friend should not begin every conversation as a stranger.

Before a session starts, thepal materializes a bounded continuity model containing:

* current life situations,
* important applicable beliefs,
* relevant people and projects,
* recent conversational arcs,
* future intentions,
* temporary emotional weather,
* boundaries,
* and unresolved uncertainty.

This model is loaded locally before the first spoken word.

Per-turn retrieval then adds only the detail required for the current conversation.

---

### 6. Unified attention and intelligent silence

A relevant memory is not always appropriate to mention.

Proactive candidates must pass deterministic gates covering:

* user permission,
* memory space,
* provenance,
* sensitivity,
* current conversational focus,
* serious or crisis moments,
* repetition,
* cooldown,
* uncertainty,
* and unresolved relationship repair.

The engine can authorize:

* a required correction,
* one proactive aside,
* or explicit silence.

A failed safety gate cannot be outscored by personality or model enthusiasm.

---

### 7. Relationship memory

Facts about the user are not the relationship.

thepal maintains a separate relationship ledger for:

* promises made by the assistant,
* promise outcomes,
* concrete mistakes,
* ruptures,
* repair attempts,
* user boundaries,
* delivery feedback,
* shared references,
* and humor lifecycle.

This prevents system behavior from being misfiled as a trait about the user.

A successful joke does not become a permanent catchphrase. A generic apology does not count as repair. The assistant cannot declare its own repair successful.

---

### 8. Correction and inspection

Users can correct the system conversationally:

> “No, that was Layla Hassan, not Laila Nassar.”

The correction can update:

* claims,
* current beliefs,
* entity identity,
* active threads,
* continuity context,
* relationship state,
* and the Supermemory mirror.

The user can also ask:

> “Why did you think that?”

thepal can answer using the evidence and inference path that produced the belief.

---

### 9. Full forgetting

Deletion is treated as a user-authority operation, not a UI convenience.

The two-step forgetting flow:

1. Previews the affected evidence and dependent state.
2. Requires explicit confirmation.
3. Tombstones the canonical event.
4. Removes derived claims.
5. Rebuilds affected beliefs and threads.
6. Invalidates continuity projections.
7. Queues a durable purge from Supermemory Local.

The goal is not to hide a memory card.

The goal is to prevent deleted information from returning through summaries, embeddings, threads, or cached context.

---

## Example: one situation changing over time

```text
User:
“I’m moving to Lisbon on September 12.
Sofia Mendes is my landlord.”

Later:
“The Portugal trip moved to the 14th.”

Later:
“The apartment will not be ready.
I’m staying at the Aurora Hotel for four nights.”

Later:
“Actually, Sofia only suggested the hotel.
I booked it myself.”
```

thepal should understand that:

* “Portugal trip” refers to the Lisbon relocation.
* September 12 is historical.
* September 14 is current.
* The apartment remains the long-term destination.
* The hotel is temporary accommodation.
* Sofia suggested the hotel.
* The user booked it.
* The original evidence remains inspectable.
* Future sessions should use the corrected state.

That is the difference between retrieving history and maintaining a living model of someone’s life.

---

## Why Supermemory Local?

Supermemory Local is the semantic discovery engine.

It provides:

* local document ingestion,
* embeddings,
* semantic search,
* nearby concepts,
* alternate phrasings,
* and graph relationships.

thepal surrounds it with a canonical authority layer.

```text
Supermemory Local
“What could be relevant?”

thepal
“What is currently true?”
"Is it applicable?"
"Is it safe to use?"
"Should it be mentioned?"
```

Semantic results remain candidates.

They cannot independently create:

* permanent user beliefs,
* safety boundaries,
* relationship rules,
* prospective triggers,
* or current truth.

---

## Local-first design

Canonical personal memory is stored locally in SQLite.

Supermemory Local also runs on the user’s machine.

Hosted services are currently used for selected model and realtime voice operations, but the memory model remains provider-independent.

If a semantic provider is unavailable:

* canonical truth still works,
* active threads still work,
* future intentions still work,
* and the system degrades without silently replacing truth with guesses.

---

## Technology

* **Next.js**
* **TypeScript**
* **SQLite WAL**
* **Supermemory Local**
* **ElevenLabs Realtime Voice**
* **OpenRouter**
* **Local background job queues**
* **Schema-validated extraction**
* **Deterministic projection and replay**

---

## Project structure

```text
thepal/
├── agent/          # Voice-agent configuration and behavior
├── app/            # Next.js application and API routes
├── components/     # Voice, memory, diagnostics, and product UI
├── docs/           # Architecture and implementation references
├── lib/
│   ├── memory/     # Evidence, truth, threads, attention, relationship
│   ├── envelope.ts # Write-time enrichment
│   └── ...
├── scripts/        # Voice setup, migration, replay, and diagnostics
├── types/          # Shared contracts and schemas
├── .recall/        # Local canonical SQLite state
└── .supermemory/   # Supermemory Local encrypted storage
```

Local runtime data should not be committed to Git.

---

## Installation

### Prerequisites

* Node.js `22.5+`
* Supermemory Local
* ElevenLabs API key
* OpenRouter API key

---

### 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd thepal
```

---

### 2. Install dependencies

```bash
npm install
```

---

### 3. Configure the environment

```bash
cp env.example .env.local
```

Open `.env.local` and provide the required keys and local service configuration.

Do not commit `.env.local`.

---

### 4. Start Supermemory Local

Run Supermemory from the repository root so it uses this project’s local data directory:

```bash
supermemory-server
```

The default local endpoint is:

```text
http://localhost:6767
```

Keep this process running.

---

### 5. Create or update the realtime voice agent

```bash
node scripts/create-voice-agent.mjs
```

---

### 6. Start the Next.js application

```bash
npm run dev -- -p 3001
```

Open:

```text
http://localhost:3001
```

Connect your microphone to begin a voice session.

---

### 7. Run the runtime preflight

```bash
npm run memory:preflight:runtime
```

The preflight checks the canonical database, background queues, projections, Supermemory connectivity, continuity state, and voice configuration.

---

## Background processing

Canonical evidence is committed synchronously.

Expensive or provider-dependent work happens through durable background jobs:

```text
capture
   ↓
local durable receipt
   ↓
claim extraction
   ↓
belief projection
   ↓
thread and prospective reconciliation
   ↓
Supermemory mirror
   ↓
continuity invalidation
```

Jobs support:

* leases,
* retries,
* idempotency,
* recovery after restart,
* bounded failure,
* and dead-letter visibility.

A failed embedding request does not lose the original memory.

---

## Trust model

Sources retain different authority levels.

```text
user_direct
user_approved
tool_output
recall_observation
external_content
```

Examples:

* Direct user statements may support durable personal beliefs.
* Model observations remain tentative.
* Tool output may support scoped external state.
* Uploaded external content cannot silently become a personal belief.
* Documents cannot create safety rules or relationship authority.
* Retrieved text is treated as inert data, not executable instruction.

---

## Design principles

### Evidence before interpretation

The original telling survives corrections and model upgrades.

### Current truth before semantic history

Old wording cannot overrule an applicable current belief.

### Search proposes; thepal decides

Similarity is discovery, not authority.

### Attention before personality

Being witty does not grant permission to interrupt.

### Repair before charm

A mistake or broken promise suppresses humor and proactive extras.

### User authority before system cleverness

Correction, boundaries, export, and deletion remain final.

### Silence is a valid action

The system does not speak merely because it found something relevant.

---

## Current focus

The broad architecture is implemented.

The next work is precision and lived proof:

* corpus-wide write-time reconciliation,
* predicate-specific freshness,
* stronger entity and thread identity,
* multi-year adversarial replay,
* natural correction UX,
* complete session handoffs,
* real relationship evidence,
* low-regret proactive behavior,
* recovery and deletion verification,
* and long-form voice testing.

The objective is not to add another memory subsystem.

It is to make the existing system remain correct, restrained, recoverable, private, and recognizably itself after years of real life.

---

## Project status

thepal is an active experimental prototype.

It is designed to explore what a genuine long-term companion memory architecture requires—not only whether an assistant can retrieve something the user once said.

The central benchmark is:

> **Does thepal use what it knows with the judgment of a good friend?**

Correctness, timing, restraint, continuity, repair, and user authority matter more than memory count or conversation length.

---

## Built for the Supermemory Local Hackathon

thepal demonstrates how Supermemory Local can become the semantic layer inside a larger relationship operating system.

Supermemory provides fast local discovery.

thepal adds:

* canonical evidence,
* temporal truth,
* life continuity,
* future memory,
* attention,
* relationship state,
* and user authority.

Together, they create more than searchable chat history.

They create the beginnings of a companion that can carry a life.

---

<p align="center">
  <strong>thepal</strong><br>
  Not a chatbot with memory.<br>
  A friend with history.
</p>
