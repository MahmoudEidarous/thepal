# 🌌 thepal

> **A local-first memory ledger engine and voice friend built on Supermemory Local.**  
> *A canonical SQLite database, semantic search mirror, and write-time enrichment pass that make local AI memory exact, grounded, and self-directing.*

---

`thepal` is a voice-first memory companion that runs entirely locally on your machine. Rather than relying on naive vector search over raw chat history, it operates on a structured **SQLite evidence ledger** coupled with a high-speed **Supermemory Local** semantic search mirror. 

---

## 🧠 The Memory Search & Ledger Engine

At the core of `thepal` is a multi-tier memory system designed to ensure zero hallucination, strict factual grounding, and high-integrity search recall.

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

### 1. Dual-Layer Retrieval (SQLite + Supermemory)
Every query triggers a dual-layer lookup:
*   **Beliefs**: Retrieves current, applicable, and validated database facts from the SQLite ledger.
*   **Results**: Fetches semantic search candidates from the Supermemory Local index.
*   *Grounding Policy*: SQLite beliefs always outrank and precede semantic results. If no direct user-asserted facts are found in the SQLite ledger, the system reports that it does not know, ensuring zero hallucination by construction.

### 2. Temporal Belief Intervals & Continuity
Instead of flat history strings, claims are projected into evidence-linked belief intervals in SQLite:
*   **Corrections & Supersedence**: Explicit corrections or updated statements close old belief intervals and open new ones. The original evidence is kept for historical context, but omitted from active retrieval.
*   **Staleness & Expiry**: Direct facts (like a birthdate or hometown) do not decay over time. Inferred or observational beliefs are clamped to a 90-day applicability horizon, and emotional state records expire within a day.
*   **Conflict Resolution**: Incompatible claims are marked as `conflicting`; recency alone does not invent certainty, and weaker contradictory evidence cannot overwrite direct user truth.

### 3. Write-Time Enrichment Envelope (`lib/envelope.ts`)
All inputs pass through a local classification pass before they are committed to database storage:
*   **Type Classification**: Classified into structured kinds (`fact`, `taste`, `decision`, `commitment`, `boundary`, `safety`, `event`, or `impression`).
*   **Temporal Resolution**: Resolves relative time expressions (*"next Friday at 4"*, *"last summer"*) into concrete calendar dates at the moment of capture.
*   **Search Optimization**: key aliases and alternative phrasings are embedded directly into the payload, ensuring differently-worded questions still trigger clean matches.

### 4. Unified Attention Gating (`lib/memory/attention-engine.ts`)
To take initiative without becoming noisy or annoying, proactive candidates (obligations, follow-ups, anniversaries) must clear 8 strict security gates:
*   `user_permission` & `memory_space` validation.
*   `source_grounding` (must be backed by direct database evidence).
*   `sensitivity` filters (e.g., medical safety limits).
*   `cooldown` metrics to prevent conversational spam.
*   `repair_priority` (any database-logged relationship "rupture" blocks all proactive remarks until a repair is resolved).

---

## 🎙️ The Voice Friend Interface

Sitting directly on top of the memory engine is an expressive, human-like voice interface:

### 1. Close-Friend Persona
*   **Direct & Candid**: Buns all formal assistant pleasantries (*"Certainly!"*, *"How can I help you today?"*). Speak with contractions and a casual, direct, close-friend dialect.
*   **Teasing & Banter**: The Pal roasts you if you forget your own plans, and uses natural, casual swearing if the vibe matches.
*   **Respiration**: Natively gasps, sighs, or takes a soft breath to sound physically present.

### 2. "Inner Monologue" Latency Masking
*   While database searches and vector matches execute, the Pal drops a quick, context-aware, organic filler thought to hold the line:
    *   *Example (Roast)*: `[sighs] "Wait, you actually forgot that? Let me check the database..."`
    *   *Example (Puzzled)*: `[chuckles] "Wait, what? Let me pull up what you said about him..."`

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
