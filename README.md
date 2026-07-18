# 🌌 thepal

> **A local-first memory ledger engine and voice friend built on Supermemory Local.**  
> *A canonical SQLite database, semantic mirror, and write-time enrichment pass that make local AI memory exact, grounded, and self-directing.*

---

`thepal` is built on a core thesis: **Memory infrastructure is not the product; judgment, continuity, and initiative are.** 

Instead of relying on naive vector search and chat history, `thepal` utilizes a structured local **SQLite evidence ledger** coupled with a high-speed **Supermemory Local** semantic mirror. It resolves facts, extracts commitments, reconciles contradictions, and implements a unified attention gating flow—all running privately on your own machine.

Built for the **Supermemory Local Hackathon, July 2026**.

---

## 🧠 The Memory Engine (The Hero)

At the core of `thepal` is a multi-tier memory architecture designed to ensure zero hallucination, strict factual grounding, and high-integrity recall.

```
                 You (Voice / Files)
                          │
                          ▼
            Write-Time Enrichment Pass
             (Categorize, Date, Align)
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
 SQLite Ledger (.recall/)           Supermemory Local (port 6767)
  (Canonical Truth, Threads,         (High-speed Semantic Index
   Attentions, Relationships)         & Vector Search Mirror)
```

### 1. The SQLite Canonical Ledger
`thepal` does not treat vector search as the source of truth. Instead, it maintains a strict, relational SQLite database (`.recall/memory.sqlite`) tracking:
*   **Temporal Beliefs**: Facts structured as `subject · predicate: value` with confidence scores and conflict resolutions.
*   **Life Threads**: Ongoing, long-term narrative connections across sessions.
*   **Prospective Triggers**: Commitments and tasks anchored to specific calendar dates.
*   **Attention Decisions**: A history of proactive statements the agent considered, gating reasons, and outcomes.

### 2. Write-Time Enrichment Envelope (`lib/envelope.ts`)
No text enters the memory pool raw. Every input is classified, resolved, and structured:
*   **Type Parsing**: Categorized into `fact`, `taste`, `decision`, `commitment`, `boundary`, `safety`, `event`, or `impression`.
*   **Temporal Resolution**: Relative timestamps (*"next Friday at 4"*) are resolved to absolute ISO-8601 calendar dates at the moment of capture.
*   **Search Enrichment**: Key aliases, alternative phrasings, and query targets are embedded directly into the payload, ensuring differently-worded questions still trigger semantic matches.

### 3. Unified Attention Gating Flow (`lib/memory/attention-engine.ts`)
To take initiative without becoming annoying, the Pal processes memory candidates (e.g. obligations, anniversaries, thread follow-ups) through **8 strict security gates** before authorizing a proactive remark:
*   `user_permission` & `memory_space` matching.
*   `source_grounding` (must be backed by direct database evidence).
*   `sensitivity` limits (e.g., medical boundaries).
*   `cooldown` metrics to prevent conversational spam.
*   `repair_priority` (any database-logged "rupture" blocks all jokes until repair is resolved).

---

## 🎙️ The Voice & UI Experience (The Friend)

Sitting directly on top of this robust memory engine is the expressive, human-like voice interface:

### 1. Uncensored Close-Friend Persona
*   **No Assistant-Speak**: Banned words like *"Certainly!"* or *"I'm happy to help!"*.
*   **Banter & Roasts**: The Pal behaves like a real companion. It teases you if you forget things, uses casual vernacular, and naturally swears (*shit, fuck, damn*) if you do.
*   **Respiration**: Natively gasps, sighs, and takes realistic physical breaths during speech.

### 2. "Inner Monologue" Latency Masking
*   While database searches and vector matches execute, the Pal drops a quick, context-aware, organic filler thought to hold the line:
    *   *Example*: `[sighs] "Wait, you actually forgot that? Let me check the database..."`
    *   *Example*: `"Damn, let me dig into the work log for a second..."`

### 3. Logo-Click Diagnostics Panel
*   Click the **`the pal`** header logo in the UI to open a retro-monospace developer HUD showing live SQLite counts, database integrity checks, and mirror sync status.

---

## 🚀 Installation & Quickstart

### Prerequisites
*   [Supermemory Local Server](https://supermemory.ai) running on port `6767`.
*   ElevenLabs API Key & OpenRouter API Key.
*   Node.js 22.5+.

### Setup
1.  **Configure environment**:
    ```bash
    cp env.example .env.local
    # Edit .env.local and fill in keys
    ```
2.  **Build/Update ElevenLabs Realtime Voice Agent**:
    ```bash
    node scripts/create-voice-agent.mjs
    ```
3.  **Install dependencies**:
    ```bash
    npm install
    ```
4.  **Start the Next.js dev server**:
    ```bash
    npm run dev -- -p 3001
    ```
5.  **Run preflight checks**:
    ```bash
    npm run memory:preflight:runtime
    ```

Open **[http://localhost:3001](http://localhost:3001)** and connect your mic!
