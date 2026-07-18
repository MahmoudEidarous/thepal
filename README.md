# 🌌 thepal

> **A local-first memory ledger engine built on Supermemory Local.**  
> *A canonical SQLite database, semantic search mirror, write-time enrichment pass, and relationship state machine that make local AI memory exact, grounded, and self-directing.*

---

`thepal` is built on a core thesis: **Memory infrastructure is not the product; judgment, continuity, and initiative are.** 

Instead of relying on naive vector search over chat history transcripts, `thepal` utilizes a structured local **SQLite evidence ledger** coupled with a high-speed **Supermemory Local** semantic search mirror. It resolves facts, extracts commitments, tracks relationship state, and implements a unified attention gating flow—all running privately on your own machine.

Built for the **Supermemory Local Hackathon, July 2026**.

---

## 🧠 Memory Engine Architecture

The memory engine uses a multi-tier pipeline to ensure zero hallucination, strict factual grounding, and high-integrity search recall.

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

### 4. Background Claim Extraction (`extract_and_project`)
Every canonical event transaction kicks off an asynchronous background job:
*   **Schema-Validated Claims**: Parses the redacted raw event to extract subject/predicate/object claims containing polarity, modality, valid time, and scope.
*   **Trust Policies**: Only `user_direct` evidence can create safety constraints, boundaries, or write permanent beliefs about the user. Document-derived data (`external_content`) or model observations (`recall_observation`) remain tentative and can never overwrite user-asserted facts.

### 5. Two-Step Deletion Flow (Forgetting Ceremony)
Deletions run through a two-step transactional consent flow:
*   **Preview**: Creates a short-lived token and reports affected belief keys, claim counts, and source text.
*   **Execution**: Consumes the token, tombstones the event, deletes derived claims, clears dependent beliefs, and re-projects the ledger while queueing a vector purge job in Supermemory Local.

### 6. Unified Attention Gating (`lib/memory/attention-engine.ts`)
To take initiative without becoming noisy or annoying, proactive candidates (obligations, follow-ups, anniversaries) must clear 8 strict security gates:
*   `user_permission` & `memory_space` validation.
*   `source_grounding` (must be backed by direct database evidence).
*   `sensitivity` filters (e.g., medical safety limits).
*   `cooldown` metrics to prevent conversational spam.
*   `repair_priority` (any database-logged relationship "rupture" blocks all proactive remarks until a repair is resolved).

### 7. Relational State Engine
Tracks the system's own interactions and relational status with the user:
*   Logs promises made by the assistant, mistakes, repair cycles, and shared humor boundaries.
*   Relational transactions are stored in a separate ledger table to keep system-action metadata decoupled from actual user-profile facts.

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
