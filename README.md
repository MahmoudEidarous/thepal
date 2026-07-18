# 🌌 thepal

> **An AI Friend with Perfect Local Memory.**  
> *Samantha ("Her") meets a sharp-witted, candid best friend. Built entirely on Supermemory Local.*

---

`thepal` is a voice-first memory companion that runs locally on your machine. Featuring a responsive, meteor-flecked WebGL constellation visualization, `thepal` speaks naturally, remembers every detail of your life, keeps your promises on a structured ledger, and roasts you like a real friend when you're forgetful.

Built for the **Supermemory Local Hackathon, July 2026**.

---

## ⚡ The Core Pillars

### 1. 🎙️ Organic Respiration & Sighs (Samantha Style)
`thepal` sounds like there is a chest moving air in the room. By injecting realistic non-lexical guidelines into ElevenLabs, the agent will:
*   Take a soft breath before answering a long question.
*   Gasp lightly when surprised.
*   Let out a quiet sigh `[sighs]` when reflecting or thinking.

### 2. 🎭 Uncensored Close-Friend Persona
Say goodbye to corporate AI assistant pleasantries. `thepal` talks to you like a genuine best friend:
*   **Banned**: *"Certainly!"*, *"Great question!"*, *"I am happy to help!"*.
*   **Authentic Vernacular**: Uses contractions, casual slang, and natural swearing (*shit, fuck, damn, ass*) when expressing real emotion, humor, or frustration.
*   **Playful Banter**: Roasts you if you forget your own appointments or change your mind.

### 3. ⏳ Dynamic "Inner Monologue" Latency Masking
Instead of dead silence while database tools run, the Pal speaks a quick, context-aware, organic filler thought *while* the lookup executes:
*   *Example (Roast)*: `[sighs] "Wait, you actually forgot that? Let me check the database..."`
*   *Example (Puzzled)*: `[chuckles] "Wait, what? Let me pull up what you said about him..."`
*   Keeps the conversation flowing seamlessly without robotic pauses.

### 4. 📟 Brand-Logo Diagnostics Panel
Hover over the logo text **`the pal`** in the top-left corner—the indicator dot turns green and pulses. **Click it** to slide open a beautiful, retro-futuristic monospace developer HUD overlay read live from the SQLite database. It tracks:
*   SQLite integrity status (`ok`).
*   Active ledger records (Events, Claims, Resolved Beliefs, Life Threads, and Reminders).
*   Active Supermemory Mirror sync counts.

### 5. 🛡️ Absolute Privacy & Local Ownership
Your data lives under your own roof:
*   Every memory passes through a local write-time enrichment pass (`lib/envelope.ts`) resolving relative times (e.g., *"this Sunday"* → calendar dates).
*   Private boundaries are pinned in-session, never sent to external LLMs.
*   Forgetting is a ceremony: preview struck-through items before confirming deletion.
*   Export your entire brain as a single **Obsidian-ready Markdown** file.

---

## 🏗️ Architecture

```
                 You (Voice/Mic) 
                       │
                       ▼
             ElevenLabs Realtime Agent
                       │
             (browser client tools)
                       │
                       ▼
            Next.js Server (localhost)
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
 SQLite Ledger (.recall/)      Supermemory Local (port 6767)
  (Canonical Truth)             (Semantic Search Mirror)
```

Every voice agent tool is executed browser-side against local API endpoints, keeping all personal memory vectors and ledgers on your own machine.

---

## 🚀 Getting Started

### Prerequisites
*   [Supermemory Local Server](https://supermemory.ai) running on port `6767`.
*   ElevenLabs API Key & OpenRouter API Key.
*   Node.js 22.5+.

### Setup & Run
1.  **Clone & Configure environment**:
    ```bash
    cp env.example .env.local
    # Edit .env.local to fill in your API keys
    ```
2.  **Register the Voice Agent & client tools**:
    ```bash
    node scripts/create-voice-agent.mjs
    ```
3.  **Install dependencies**:
    ```bash
    npm install
    ```
4.  **Start the developer server**:
    ```bash
    npm run dev -- -p 3001
    ```
5.  **Run preflight checks**:
    ```bash
    npm run memory:preflight:runtime
    ```

Open your browser to **[http://localhost:3001](http://localhost:3001)**, click the central orb, and start talking!

---

## 🛠️ The Stack
*   **Supermemory Local** — Vector search, memory extraction, and relational mapping.
*   **ElevenLabs ConvAI** — Realtime conversational voice streaming with browser-side client tools.
*   **Next.js 16 + Tailwind CSS** — Gorgeous minimalist front-end, WebGL shader orb, and pointer-parallax stars.
*   **SQLite** — Canonical database for threads, attention, relationship logs, and diagnostics.
