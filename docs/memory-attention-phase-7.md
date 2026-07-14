# Phase 7 — Unified attention and intelligent silence

Phase 7 places a deterministic action policy between compiled memory and
Recall's personality. Retrieval still answers **what could matter**. Attention
now answers **what applies, whether now is interruptible, and whether speaking
is better than silence**. Personality is only allowed to choose wording after
that decision.

This is not Transformer attention and it is not another retrieval ranker. It
is an inspectable scheduler over current context, prospective memory,
obligations, life threads, returning past, temporal truth, pinned boundaries,
sensitivity, cooldowns, and user load.

## Runtime shape

```text
canonical events ──▶ beliefs / threads / prospective projections
       │                         │
       └────────▶ bounded context compiler ◀── Supermemory semantic evidence
                                      │
                         candidate generation
                                      │
                hard gates → utility trace → one-aside cap
                                      │
                     speak one thing / explicit silence
                                      │
                         personality chooses wording
```

The engine is deterministic. No model decides whether a stored item may cross
a boundary, whether a tentative pattern is strong enough, or whether an
anniversary should interrupt a serious turn.

## Candidate classes

Attention keeps two classes separate:

- **Required response constraints** protect correctness. Relevant temporal
  changes, unresolved conflicts, and future relationship-repair state can
  constrain the response without consuming the proactive-aside slot.
- **Proactive candidates** are optional interruptions. Exact/fuzzy prospective
  matches, due obligations, due life-thread reviews, and anniversaries compete
  for at most one slot.

This separation prevents an urgent reminder from displacing current truth and
prevents a truth correction from being treated like a notification.

## Hard gates

Every candidate records a pass/fail reason for these gates before scoring:

1. **User permission** — explicit quiet, goodbye, and silence requests stop
   proactive memory.
2. **Memory space** — candidates cannot cross the compiled space.
3. **Source grounding** — tentative or external evidence cannot justify a
   confident intervention.
4. **Sensitivity** — restricted evidence never surfaces proactively; sensitive
   use is limited to an exact prospective instruction the user explicitly
   created.
5. **Pinned boundary** — an applicable explicit boundary overrides every score.
6. **Interruptibility** — crisis, serious moments, unfinished speech, focus
   mode, and unrelated direct tasks suppress asides.
7. **Repair priority** — an unresolved Recall mistake suppresses charm and all
   proactive memory until repair is handled.
8. **Cooldown** — candidate- and topic-level windows prevent nagging.

A score cannot override a failed gate.

## Utility trace

Eligible candidates retain the full deterministic calculation:

```text
helpfulness + urgency + actionability + relational value + repair value
− interruption cost − repetition cost − uncertainty − sensitivity risk − user load
```

Different candidate kinds have explicit thresholds and cooldowns. The decision
contains all candidates for replay review, the shadow winner, the one surfaced
candidate if any, and a human-readable reason when silence wins.

## Rollout modes

`RECALL_ATTENTION_MODE` controls only proactive surfacing:

| Mode | Behavior |
| --- | --- |
| `shadow` | Generate, gate, score, select, and persist; never surface a proactive aside. |
| `guarded` | Default. Surface only an **exact** prospective trigger. Everything else remains shadow data. |
| `active` | Allow every candidate class that passes gates and threshold. Use only after replay review. |

Required truth/repair constraints remain active in every mode because they are
response correctness, not experimentation with proactivity. Invalid
configuration fails closed to `guarded`.

## Persistence and privacy

SQLite schema migration 5 adds:

- `memory_attention_decisions` — mode, moment type, selected IDs, action,
  utility score, cooldown key, surface/silence result, and a compact policy
  trace.
- `memory_attention_evidence` — provenance links from a decision to canonical
  events.

The durable trace intentionally stores **no memory text, prompt instruction, or
generated response**. It stores IDs, factors, gates, and evidence links. When a
user deletes canonical evidence, dependent attention decisions are deleted in
the same transaction. Deletion preview reports the number of affected traces.

## APIs and modules

- `lib/memory/attention-engine.ts` — pure candidate generation, moment signals,
  gates, scoring, rollout, selection, and agent-policy formatting.
- `lib/memory/attention-service.ts` — composes bounded context, anniversaries,
  temporal changes, cooldown history, persistence, and the pure engine.
- `POST /api/context/compile` — now returns both bounded context and its
  attention decision; the voice path consumes this every finalized user turn.
- `POST /api/attention/decide` — focused decision endpoint used at session
  start and by internal diagnostics.
- `GET /api/attention/decide?space=personal&limit=50` — privacy-safe shadow
  audit feed with no memory content.

The response packet explicitly says that raw memories are evidence, not
permission to interrupt. `PROACTIVE SILENCE` means “answer the user's current
turn without an unsolicited memory aside,” not conversational dead air.

## Voice integration

The ElevenLabs configuration now receives an `attention` dynamic variable and
the latest per-turn decision through contextual updates. Raw agenda,
prospective, briefing, and anniversary inventories cannot independently grant
permission to speak.

At the guarded default:

- an exact “next time Vienna comes up…” match may be authorized;
- the agent must call `manage_prospective_memory(action=fire)` before delivery;
- a once-trigger is consumed only through its canonical lifecycle;
- fuzzy matches, obligations, life-thread follow-ups, and anniversaries are
  evaluated and logged but remain silent;
- ordinary replies, warmth, wit, and direct follow-up inside the user's current
  topic remain personality behavior, not memory interruptions.

## What Phase 7 deliberately does not do

- It does not learn an engagement-maximizing policy.
- It does not generate proactive copy from raw vector hits.
- It does not infer stable emotional traits from a serious word or one episode.
- It does not implement humor lifecycle, shared-joke saturation, relationship
  dialect, rupture detection, or durable repair state. Those are Phase 8.
- It does not enable broad check-ins merely because their score looks high.
- It does not make Supermemory a behavioral authority. Supermemory remains
  semantic retrieval and a mirror; Recall owns policy.

## Verification

`npm run eval:memory-attention` currently runs 67 deterministic checks covering:

- exact versus fuzzy rollout;
- shadow, guarded, and active modes;
- hard-gate compliance for crisis, seriousness, focus, goodbye, mid-thought,
  sensitivity, provenance, pinned boundaries, and repair priority;
- obligation, thread, anniversary, change, uncertainty, and prospective
  candidates;
- utility arithmetic, one-aside selection, cooldown expiry, and explicit
  silence;
- privacy-safe audit persistence and deletion propagation.

Together with the existing foundation, temporal truth, threads, context,
continuity, and crash-recovery suites, the deterministic bank is **319 checks**.

## Exit criteria before broader activation

Keep the default at `guarded` until replayed real sessions show:

- 100% hard-gate compliance;
- no external-content or cross-space proactive surfacing;
- no repeated candidate inside its cooldown;
- every decision can explain “why now” or “why silent”;
- reviewed false-positive rate below 5% for the next candidate class;
- exact prospective delivery is consumed once and only after successful fire;
- serious, crisis, goodbye, and user-quiet turns remain free of memory asides.

The next candidate class should be enabled one at a time. The recommended order
is due obligations, due thread reviews, then safe anniversaries. Phase 8 should
add relationship repair and humor state before callbacks or learned ranking are
allowed to influence attention.
