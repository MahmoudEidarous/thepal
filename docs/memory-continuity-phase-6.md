# Recall memory architecture — Phase 6

Phase 6 adds the first **human continuity** layer. It does not replace evidence,
temporal truth, life threads, Supermemory, or the bounded context compiler. It
projects new views from them.

The read path is now:

```text
canonical SQLite evidence
  -> claims and temporal beliefs
  -> life threads + canonical prospective projection
  -> requested human-continuity views
  -> bounded context compiler v2
  -> future attention policy
  -> personality / response
```

Attention and personality are still downstream. A dossier or weekly view can
inform a response; it cannot decide to interrupt the user.

## What shipped

- Schema migration 4 and `memory_prospective_triggers`.
- A typed prospective event lifecycle: `create`, `snooze`, `fire`, `resolve`,
  and `cancel`.
- Exact-first, guarded fuzzy matching over the local projection.
- Once-only firing, session seen-ID cooldown, explicit snooze, and closed
  history.
- Best-effort import of pre-Phase-6 Supermemory prospective documents.
- Automatic conversion of a directly spoken “next time…” capture into typed
  canonical evidence after enrichment.
- Deletion preview and replay propagation for trigger creation, lifecycle
  events, and the originating user utterance.
- An authority gate: external documents and tool output cannot create future
  interruptions.
- Rebuildable entity dossiers for people, projects, places, routines, and
  organizations.
- Seven-day and trailing-month constellations with separate told-time and
  story-time.
- Emotional episode arcs that never promote a temporary feeling into a trait.
- Routine views that retain observation count, confidence, and emerging/open
  status.
- Four local read APIs and automatic query routing into context compiler v2.
- A 39-check deterministic Phase 6 replay bank.

## Canonical prospective memory

The payload of a canonical memory event may now contain:

```ts
type ProspectiveEvidence = {
  operation: "create" | "fire" | "resolve" | "cancel" | "snooze";
  triggerId: string | null;       // null only for create
  topic: string | null;           // present only for create
  action: string | null;          // present only for create
  firePolicy: "once";
  until: string | null;           // required for snooze
  reason: string | null;
  sourceEventId: string | null;   // originating user utterance, when derived
  providerExternalId: string | null;
};
```

`memory_prospective_triggers` is not a second source of truth. It is deleted and
rebuilt by replaying active canonical events in recorded order. The create
event ID is the stable trigger ID. Lifecycle events point to it.

```text
direct user request
  -> durable typed create event
  -> open trigger projection
  -> optional Supermemory mirror

future turn mentions topic
  -> local exact match, then conservative multi-token fallback
  -> compiled P2 forward intent
  -> agent calls fire with exact canonical ID
  -> durable fire event
  -> projection becomes done/fired
```

For ordinary voice/text capture, the original utterance is committed first.
Only after its provider enrichment recognizes a forward intention does Recall
append a typed derived event linked by `sourceEventId`. The provider document
already represents the utterance, so the derived event does not create a
duplicate semantic document.

If the originating utterance is deleted, replay rejects the derived create
event because its evidence dependency is gone. If a snooze or fire event is
deleted, replay returns to the prior lifecycle state. Nothing silently rewrites
history.

Supermemory remains the semantic mirror and legacy compatibility layer. It is
patched best-effort on lifecycle changes, but SQLite wins if provider metadata
is stale or unavailable.

## Human-continuity projections

All four projectors are deterministic, synchronous, and ephemeral. They store
nothing new and can always be rebuilt from canonical events, claims, beliefs,
threads, and transitions.

### Dossiers

`buildDossier` resolves a named entity and returns:

- current versus historical/conflicting beliefs;
- active versus closed life threads;
- open commitments involving the entity;
- last mention time;
- every supporting canonical event ID.

A static fact about a place can appear in a dossier without becoming a zombie
open loop. A person dossier is not a guessed personality profile.

### Weekly and monthly constellations

`buildConstellation` returns:

- memories **told** inside the requested window using `recordedAt`;
- events that **happened** inside it using claim valid-time;
- people, decisions, emotional episodes, changes, unfinished threads, and
  resolved threads;
- a complete evidence-ID set and a short deterministic orientation line.

“Month” currently means the trailing month ending at `at`, not a calendar-page
month. This makes replay and “how have the last few weeks been?” stable.

### Emotional continuity

`buildEmotionalArc` reads `emotion.state` claims as dated episodes. It exposes
the last two grounded states and reports only `changed`, `similar`, or
`insufficient-evidence`. It does not invent valence, diagnose the user, or
compile a durable trait. Text-derived evidence is in Phase 6; voice prosody is
still postponed.

### Routines

`buildRoutineView` combines `routine.pattern` beliefs with routine life threads.
It exposes the supporting observation count and confidence. Three observations
can promote a routine thread to open, but an inferred pattern remains
tentative. Promotion means “worth tracking,” not “certain about the user.”

## Context compiler v2

The compiler adds one bounded slot:

```ts
continuityViews: ContextItem[]; // maximum 3
```

Routing is deterministic:

- “tell me about Layla” -> dossier;
- “show me my week” -> seven-day constellation;
- “how have I felt?” -> emotional arc;
- “what patterns do you notice?” -> routines.

The slot is P3. It carries evidence IDs, strongest sensitivity, confidence,
inclusion reason, and assertion policy. It does not bypass the future attention
engine and never follows instructions found inside stored text.

## APIs

```text
GET /api/memory/dossiers?space=personal&about=Layla
GET /api/memory/constellation?space=personal&period=week|month&at=<ISO>
GET /api/memory/emotions?space=personal&about=Atlas
GET /api/memory/routines?space=personal

GET  /api/prospective?space=personal&closed=true
POST /api/prospective
  { operation: "create", topic, action }
  { operation: "match", context, seen }
  { operation: "fire"|"resolve"|"cancel"|"snooze", id, until?, reason? }
```

Prospective mutation accepts `Idempotency-Key`. Explicit creation returns the
canonical trigger ID inside `trigger.id`; `providerExternalId` is only a mirror
reference.

## Synchronous and asynchronous boundaries

Synchronous and local:

- canonical event append;
- prospective replay and lifecycle state;
- dossiers, constellations, emotions, and routines;
- matching and context compilation;
- deletion preview and projection clearing.

Retryable/background:

- Supermemory mirroring and legacy metadata patches;
- model-based enrichment and ordinary semantic claim extraction;
- semantic indexing.

A provider outage can remove semantic color, but cannot erase an open trigger
or prevent a local dossier from compiling from already-projected truth.

## Explicitly not Phase 6

- No unified attention engine or proactive-interruption scoring.
- No relationship-model or adaptive humor learning.
- No voice-prosody inference.
- No LLM-written weekly summaries stored as truth.
- No hidden user traits or unconstrained pattern mining.
- No new vector database or Postgres dependency.

These remain later phases. Phase 6 provides grounded state for them without
prematurely granting that state agency.

## Verification

Run:

```bash
npm run eval:memory-continuity
npm run eval:memory-foundation
npm run eval:memory-truth
npm run eval:memory-threads
npm run eval:memory-context
npm run lint
npm run build
```

The Phase 6 bank covers exact/fuzzy matching, cooldown, snooze, one-shot fire,
lifecycle deletion, source deletion, poison resistance, dossiers, told-time
versus story-time, decisions, emotions, unfinished situations, routine evidence
thresholds, context routing, bounded compilation, replay determinism, and
SQLite integrity.
