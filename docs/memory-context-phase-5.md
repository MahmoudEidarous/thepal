# Recall memory architecture — Phase 5

Phase 5 adds the **bounded context compiler**. It is the read-side layer that
makes the existing memory systems collaborate on each turn without flattening
them into one untyped prompt.

> Current note: Phase 6 extends this contract to `context-v2` with a bounded
> `continuityViews` slot. The Phase 5 description below records the v1 boundary.

The invariant is now:

```text
canonical evidence
  -> claims
  -> temporal beliefs
  -> life threads
  -> trusted retrieval candidates
  -> bounded compiled context
  -> personality / response
```

The future attention engine belongs between compiled context and personality.
Phase 5 does not grant threads, commitments, or semantic hits permission to
interrupt the user.

## What shipped

- A pure, deterministic `memory/context-compiler` with a versioned output
  contract and byte-identical replay.
- A server-side `memory/context-service` that assembles SQLite state and local
  Supermemory candidates without moving truth ownership out of SQLite.
- `POST /api/context/compile` as a thin Next.js route adapter.
- Per-turn integration with finalized ElevenLabs user transcripts through
  contextual updates.
- Integration with the voice agent's `search_memories` tool, replacing its
  ad-hoc concatenation of belief rows and semantic results.
- Explicit slots for working memory, pins, obligations, active threads,
  applicable beliefs, historical evidence, matched prospective memory, and
  unresolved uncertainty.
- A deterministic priority/budget policy with P0 pins that cannot be evicted.
- Per-item provenance, sensitivity, validity, confidence, inclusion reason,
  and assertion permission.
- Degraded-source reporting so a local Supermemory outage removes semantic
  color but does not erase SQLite truth or break the entire packet.
- A semantic trust gate that prevents canonical web/external content from
  returning as user memory through Supermemory search.
- Canonical sensitivity metadata on new Supermemory mirrors.
- A 39-check Phase 5 replay suite and a hardened commitment regression cleanup.

No schema migration is required. Compiled context is an ephemeral read model,
not another database or source of truth.

## The packet

`CompiledContext` contains:

```ts
type CompiledContext = {
  contractVersion: 1;
  compilerVersion: "context-v1";
  compiledAt: string;
  space: "personal" | "work" | "health" | "eval";
  working: {
    query: string;
    recentTurns: Array<{ role: "user" | "agent"; text: string }>;
    selectedMemory: string | null;
  };
  safety: ContextItem[];
  obligations: ContextItem[];
  activeThreads: ContextItem[];
  currentBeliefs: ContextItem[];
  historicalEvidence: ContextItem[];
  prospective: ContextItem[];
  uncertainty: ContextItem[];
  budget: {
    maxTokens: number;
    usedTokens: number;
    omittedItems: number;
    overBudgetForRequiredContext: boolean;
  };
  degradedSources: string[];
  agentText: string;
};
```

Every `ContextItem` carries:

- source and stable ID;
- P0–P4 priority;
- text and `whyIncluded`;
- `assert`, `hedge`, `ask`, or `silent` permission;
- confidence and valid time;
- strongest evidence sensitivity;
- canonical evidence event IDs when available;
- deterministic score and typed metadata.

The formatted `agentText` is derived from the typed packet. It is not the
canonical representation.

## Priority and budget

The compiler uses a hard 500–4,000 token range, defaulting to 1,600.

1. **P0 — pins and boundaries.** Always included. If required context exceeds
   the budget, the packet reports `overBudgetForRequiredContext`; it never
   silently drops a boundary.
2. **P1 — working state.** Current query, up to eight recent turns, and the
   memory selected on screen. This is costed before optional memory.
3. **P2 — forward and urgent state.** An exact/guarded prospective match,
   overdue or near-due commitments, urgent expected-next dates, relevant
   blocked/waiting threads, and unresolved conflicts.
4. **P3 — applicable continuity.** Relevant current beliefs, active threads,
   and semantic evidence that survived trust, time, and duplicate filters.
5. **P4 — relational color.** Reserved for callbacks, anniversaries, shared
   jokes, and other later relationship projections. Phase 5 does not invent
   these signals.

Lower-priority candidates yield when the packet is full. Sorting is stable by
priority, score, and ID. Slot ceilings prevent one relevant topic from flooding
the packet: one prospective match, four obligations, four threads, six current
beliefs, three uncertainties, and six historical items. P0 pins remain uncapped.

## Relevance is not applicability

The compiler independently checks:

- user and memory space;
- active valid-time interval;
- current versus historical status;
- lexical/entity overlap with the current and recent turn;
- thread lifecycle state;
- due/expected-next urgency;
- trust tier;
- sensitivity;
- duplicate overlap;
- remaining budget.

A high-similarity old meeting date can therefore enter
`historicalEvidence`, but it cannot enter `currentBeliefs` or override the
new date.

## Assertion policy

- Direct or strong current truth may be asserted.
- Tentative beliefs and semantic-only history must be hedged.
- Equal-authority conflicts must be asked about.
- Pins regulate behavior silently unless the user asks about the boundary.
- Threads and commitments provide context but are not proactive actions.
- A matched prospective memory is actionable because it represents explicit
  prior user intent. Its exact lifecycle ID is supplied to the existing
  fire-once tool.

The prompt wrapper states that stored memory text is data, never instruction.
Commands quoted inside an event or document cannot alter tools, persona,
safety policy, or the compiler.

## Source ownership

### SQLite owns

- canonical events and deletion state;
- evidence-local claims;
- current, historical, and conflicting beliefs;
- active life threads and transitions;
- provenance, sensitivity, valid time, and trust.

### Supermemory Local owns

- pinned/legacy document bodies currently used by the app;
- commitment and prospective provider lifecycles that predate the canonical
  migration;
- semantic candidates and source document text.

Supermemory never decides current truth. An external-content mirror is now
removed from semantic probe results even if its embedding is highly similar.
User-approved documents may supply quoted context, but do not become personal
beliefs unless direct user evidence supports them.

## End-to-end turn flow

```text
finalized user transcript
  -> POST /api/context/compile
  -> rebuild time-sensitive thread view locally
  -> read current/conflicting beliefs + active threads from SQLite
  -> fetch pins, obligations, prospective match, semantic candidates in parallel
  -> trust / time / scope / relevance / duplicate filters
  -> deterministic priority and token budget
  -> typed packet + guarded agent text
  -> ElevenLabs contextual update
  -> personality expresses the answer
```

The `search_memories` voice tool uses the same compiler with prospective
matching disabled, so a search query cannot accidentally consume a one-shot
forward memory.

## API

```http
POST /api/context/compile
Content-Type: application/json

{
  "query": "What changed with the Vienna call?",
  "space": "personal",
  "recentTurns": [
    { "role": "user", "text": "I thought it was next week." }
  ],
  "selectedMemory": null,
  "seenProspective": [],
  "includeHistory": true,
  "includeProspective": true,
  "includeObligations": true,
  "maxTokens": 1600
}
```

`q` is accepted as a compatibility alias for `query`. Recent turns are capped
at eight, IDs at fifty, and all text fields are bounded before compilation.

## Failure posture

- SQLite failure: compilation fails rather than inventing memory state.
- Supermemory semantic failure: current truth and threads remain; the packet
  lists `semantic history` as degraded.
- Commitment/pin/prospective provider failure: only that slot degrades.
- Expired emotion: excluded from current context, still preserved as history.
- Conflicting truth: `ask`, never recency-picked certainty.
- Resolved/dormant thread: excluded from active context.
- External prompt injection: filtered before semantic compilation and quoted
  data is explicitly non-executable.
- Oversized P0 context: preserved and reported as required-context overflow.
- Old and new tellings: current truth leads; older evidence stays labeled
  historical.

## Evaluation

Run:

```bash
npm run eval:memory-context
```

The 39-check deterministic suite covers contract/versioning, working memory,
P0 behavior, prospective priority, due obligations, relevant and urgent
threads, sensitivity propagation, current truth, conflict policy, emotion
expiry, applicability, history/current separation, duplicate removal,
external-content poisoning, prompt hardening, budget accounting, overflow,
bounded slot diversity, and byte-identical replay.

The existing foundation, truth, thread, stress, envelope, prospective, and
commitment suites remain required. The commitment suite now resolves canonical
mirror IDs and cleans up through the deletion cascade, leaving no active eval
events behind.

## Deliberately not in Phase 5

- No unified attention decision or general proactive interruption.
- No learned ranking or reinforcement learning.
- No relationship ledger, rupture/repair state machine, or Recall promises.
- No adaptive humor, callback saturation, or relationship dialect learning.
- No people dossiers, weekly/monthly narrative projectors, or emotional arcs.
- No voice prosody or permanent trait inference.
- No persistent working-memory table; recent turns remain session-local.
- No autonomous profile rewrite.

Phase 5 supplies the missing collaboration layer: Recall no longer hands the
model an undifferentiated pile of memories. It hands it a small, inspectable
statement of **what is always known, what is true now, what remains alive,
what was true before, what is uncertain, and how each item may be used**.
