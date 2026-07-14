# Phase 8 — Relationship intelligence, repair, and adaptive humor

Phase 8 gives Recall memory of **its own side of the relationship** without
polluting facts about the user. It records promises Recall makes, outcomes,
specific mistakes, explicit boundaries, repair, bounded delivery feedback,
and shared-joke lifecycle. A rebuildable projection then constrains attention
and expression.

This layer is downstream of truth and attention:

```text
user evidence ──▶ current truth / threads / prospective
                         │
interaction events ──▶ relationship projection
                         │ repair + safe callback candidates
                         ▼
                unified attention policy
                         │ one action or silence
                         ▼
              relationship expression policy
                         │ tone / humor / repair constraints
                         ▼
                  ElevenLabs response
```

Personality never receives a side door around attention. A shared callback is
only visible to expression after attention authorizes it. An unresolved repair
is a required response constraint and suppresses every proactive aside.

## Three memories stay separate

1. **User memory** says what happened in the user's life and remains grounded
   in the canonical evidence/claim/belief ledger.
2. **Relationship memory** says what happened between Recall and the user:
   Recall promised something, repeated a reminder, received an explicit
   boundary, attempted repair, or developed a shared reference.
3. **Agent procedural memory** is a validated behavior change created only by
   an explicit boundary or an accepted repair. It is versioned with Recall's
   persona and never becomes a user trait.

For example, “Mahmoud dislikes repeated reminders” is not inferred. The
relationship ledger may instead preserve: “Recall repeated a reminder after
promising not to,” followed by the accepted procedural rule “cap non-urgent
reminders at one unless reopened.”

## Canonical events and projection

SQLite migration 6 adds:

- `memory_relationship_events` — append-only interaction evidence;
- `memory_relationship_evidence` — optional links to canonical user evidence;
- `memory_relationship_state` — rebuildable current projection;
- `memory_attention_relationship_evidence` — privacy-safe provenance from
  attention decisions to relationship events.

Supported relationship events are:

- `agent_promise` and `promise_outcome`;
- `recall_mistake` and `rupture`;
- `boundary`;
- `repair_attempt` and `repair_outcome`;
- `interaction_feedback`;
- `humor_episode` and `shared_reference`.

Allowed sources are deliberately narrow: `user_explicit`, `recall_observed`,
and `system_outcome`. External documents and web content cannot write
relationship authority. Every event is user/space scoped, idempotent when a
key is supplied, and may link only to active canonical evidence in the same
scope.

`lib/memory/relationship-engine.ts` replays the event stream into:

- open/kept/broken/cancelled Recall promises;
- active/revoked explicit boundaries;
- every rupture lifecycle plus one severity-prioritized active repair;
- bounded dialect dimensions with confidence;
- seed/shared/cooling/retired humor artifacts;
- procedural rules created by boundaries or accepted repair.

The projection is disposable. Deleting source evidence removes dependent
relationship events and attention traces transactionally, then rebuilding the
projection removes the learned behavior. A relationship event can also be
deleted directly through `DELETE /api/relationship`.

## Rupture and repair

The deterministic lifecycle is:

```text
mistake / broken promise ──▶ open
open + repair_attempt ─────▶ repairing
repairing + accepted ──────▶ resolved + validated policy patch
repairing + failed ────────▶ open
```

A repair never declares itself successful. Only an accepted/resolved outcome
closes the rupture. While open or repairing:

- attention receives a required repair constraint;
- proactive memory and callbacks are suppressed;
- the relationship expression policy disables jokes and teasing;
- the session opening acknowledges the specific unresolved failure before an
  agenda item, anniversary, or normal greeting;
- the instruction is to name the failure, own it, correct it, apologize once,
  and avoid self-pity or asking the user for reassurance.

Accepted repair may create one concrete procedural rule. Vague promises to “do
better” do not deserve policy authority.

## Stable persona and learned dialect

The stable persona is code-versioned as `recall-persona-v1`: warm, quick,
candid, curious, witty, useful, and explicitly not service theater. Learned
dialect can tune only:

- directness;
- verbosity;
- warmth;
- teasing;
- initiative.

It cannot change truth, safety, boundaries, Recall's identity, or the action
chosen by attention. Guarded mode applies only explicit user feedback. Active
mode may also apply a direction after three consistent implicit outcomes.
One implicit interaction remains tentative and inert. Teasing permission is
never assumed.

`RECALL_RELATIONSHIP_MODE` controls this rollout:

| Mode | Behavior |
| --- | --- |
| `shadow` | Preserve events and projection; apply no learned dialect. Repair and boundaries remain enforced. |
| `guarded` | Default. Apply explicit user feedback only. Shared callbacks remain shadow candidates. |
| `active` | Apply strong repeated implicit dialect and callbacks that independently pass attention. |

## Humor lifecycle

Humor is not a global “be funny” switch:

```text
seed ── user deliberately reuses it ──▶ shared
shared ── Recall callback ─────────────▶ 14-day cooldown
shared ── one negative outcome ────────▶ cooling
cooling ── second negative outcome ────▶ retired
```

One laugh is not permanent permission. A reference becomes shared only when
the user reuses or extends it. Eligibility also requires normal sensitivity,
no unresolved repair, no negative signal, no cooldown, and relevance to the
present turn. Attention treats it as a low-urgency relational candidate:
seriousness, crisis, focus, boundaries, user silence, stronger obligations,
or another candidate can all defeat it.

When authorized, the voice agent records actual callback use so the cooldown
and saturation state advance. It must transform the reference for the current
context and never repeat the original successful line verbatim. “No joke” is
always valid.

## APIs and voice integration

- `GET /api/relationship?space=personal` returns the current projection.
- Add `events=true` for the scoped source events.
- `POST /api/relationship` appends a validated relationship event and returns
  the rebuilt projection.
- `DELETE /api/relationship` deletes one event under user authority and
  rebuilds all behavior that depended on it.
- `POST /api/context/compile` now returns attention plus relationship state and
  expression policy.
- `POST /api/attention/decide` returns the focused attention decision and
  relationship expression packet.

The ElevenLabs agent has a narrow `record_relationship_event` client tool. It
is for concrete Recall promises, outcomes, mistakes, explicit user feedback,
repair, and deliberate user reuse of humor—not engagement inference. Like all
client tools, it runs in the browser against the local Next.js API.

## Privacy and user authority

- Relationship events are local SQLite state and are never mirrored to
  Supermemory.
- Supermemory remains semantic retrieval infrastructure; it has no authority
  over persona, repair, boundaries, humor, or relationship state.
- Attention audit stores event IDs, gates, and factors, never relationship
  text or response instructions.
- Canonical evidence deletion reports `affectedRelationship` and
  `affectedAttention`, then removes both dependency paths in one transaction.
- Relationship-event deletion reverses learned behavior on replay.
- Cross-user and cross-space provenance is rejected.

## Verification

`npm run eval:memory-relationship` runs 82 deterministic checks covering:

- source poisoning, latest-turn transcript evidence, Unicode speech, and scope isolation;
- stable persona versioning;
- Recall promise outcomes;
- multiple unresolved ruptures, severity priority, and accepted/failed repair;
- repair priority over attention and humor;
- explicit versus tentative/strong implicit dialect;
- boundaries remaining separate from user beliefs;
- seed/shared/cooling/retired humor state;
- serious-moment suppression, attention rollout, and two-week cooldown;
- privacy-safe relationship provenance in attention audit;
- canonical deletion and direct relationship deletion propagation;
- idempotency, restart durability, and SQLite integrity.

The complete deterministic memory bank is now **401 checks**: 64 foundation,
49 temporal truth, 49 threads, 39 context, 39 continuity, 67 attention, 82
relationship, and 12 stress/recovery.

## Deliberately postponed to Phase 9

- voice-prosody inference and emotional diagnosis;
- reinforcement or engagement-maximizing personality learning;
- automatic learning from laughs, session length, or silence;
- broad autonomous outreach or push notifications;
- a learned attention ranker;
- multi-device sync and Postgres migration;
- changing the stable persona without a versioned migration and replay bank.

Phase 9 should first add replay/observability over real sessions, consented
outcome capture, red-team prompt-injection cases, and production hardening. It
should not widen autonomy merely because the relationship projection exists.
