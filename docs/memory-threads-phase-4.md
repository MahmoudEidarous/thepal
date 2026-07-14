# Recall memory architecture — Phase 4

Phase 4 adds **living threads and open loops**. It does not replace evidence,
claims, beliefs, Supermemory, the commitment ledger, prospective memory, or the
voice persona. It projects those foundations into inspectable situations that
can evolve over time.

The invariant is:

```text
canonical events -> evidence-local claims -> temporal beliefs -> life threads
```

Threads are rebuildable views. They never become a second source of truth.

## What shipped

- Schema migration 3 with `memory_threads` and
  `memory_thread_transitions`.
- Typed contracts for thread kinds, lifecycle states, grounded current state,
  expected-next events, commitment references, resolution, and transitions.
- A deterministic `memory/thread-engine` that groups trusted temporal beliefs
  into stable situations.
- Thread kinds for projects, relationships, places, routines, decisions,
  goals, problems, health situations, and pure waiting states.
- Lifecycle states: `emerging`, `open`, `waiting`, `blocked`, `resolved`, and
  `dormant`.
- Durable transition history for creation, state updates, status changes, and
  inactivity-based dormancy.
- Grounded current state with belief keys, canonical event IDs, confidence,
  participants, expected-next state, commitment references, last meaningful
  change, and next-review time.
- Automatic projection inside the existing durable state-job pipeline.
- Transaction-safe deletion behavior: a tombstone clears stale threads before
  returning, then the remaining evidence rebuilds the scoped projection.
- Deletion previews now disclose affected thread IDs.
- Commitment completion/cancellation now creates canonical evidence through
  the write broker instead of living only as Supermemory metadata.
- A Node.js route handler at `GET /api/memory/threads`.
- A deterministic 49-check replay suite.

## Canonical ownership

SQLite remains canonical. Supermemory remains the recoverable semantic mirror.

`memory_threads` stores a disposable current projection. Its rows may be
deleted and regenerated from active canonical events, claims, and beliefs. The
same is true of `memory_thread_transitions`: the transition log is inspectable,
but deterministic replay owns its contents.

No thread operation silently edits an event, claim, or belief.

## Thread identity

Named non-user subjects use their canonical entity ID as the thread anchor.
That means a project can move from `waiting.for` to `project.status=resolved`
without becoming two threads. Lifecycle predicates may change; situation
identity does not.

User-subject situations such as goals, problems, symptoms, and pure waiting
states use a typed, normalized object/context anchor so unrelated situations do
not collapse into a generic `user:local` thread.

Thread IDs are deterministic UUIDs derived from user, space, and anchor. A
replay or restart therefore produces the same ID.

## Lifecycle rules

1. A thread begins only from a threadable, projected belief. A topic mention is
   not sufficient.
2. Explicit lifecycle language controls `waiting`, `blocked`, `resolved`, and
   `dormant` states.
3. A correction or changed belief updates the existing thread and preserves
   all supporting tellings.
4. Equally authoritative contradiction keeps thread confidence
   `conflicting`; conflict cannot fabricate resolution.
5. Three supported recurring observations can promote a routine from
   `emerging` to `open`. The belief remains tentative unless the user confirms
   it.
6. Inactivity may change an unresolved thread to `dormant`. It never changes it
   to `resolved`.
7. Waiting and blocked threads receive a longer dormancy window than ordinary
   open threads.
8. A resolved thread has an evidence-backed resolution record and no next
   review time.
9. If resolution evidence is deleted, replay falls back to the prior grounded
   state.
10. External-content claims rejected by the belief trust policy cannot create,
    close, or alter a thread.

## Expected next and commitments

Current `meeting.scheduled_for`, `expected.next`, and `waiting.for` beliefs can
produce an expected-next record. An open canonical commitment with a due date
can also provide it.

Commitments are references, not duplicated truth. A canonical completion event
marks the reference done or cancelled. A correction to a commitment marks the
older reference superseded. Context-triggered prospective memories remain in
their own lifecycle and are deliberately excluded from thread commitments.

## API

```http
GET /api/memory/threads?space=personal
GET /api/memory/threads?space=work&active=true
GET /api/memory/threads?space=personal&status=waiting
GET /api/memory/threads?space=personal&kind=relationship
GET /api/memory/threads?space=personal&id=<thread-id>&transitions=true
```

Query filters:

- `space`: existing Recall memory space.
- `id`: exact thread ID.
- `status`: one lifecycle state.
- `kind`: one thread kind.
- `active=true`: exclude resolved and dormant threads.
- `limit`: thread limit.
- `transitions=true`: include the transition projection.
- `transitionLimit`: transition limit.

The route rebuilds locally before reading. This materializes pre-migration
memories and applies time-based dormancy even when no new event arrived.

## Synchronous and asynchronous behavior

Canonical capture is still synchronous and local. Claim extraction, belief
projection, thread projection, and Supermemory mirroring remain durable jobs.

Inside state reconciliation:

```text
claim extraction
  -> replace event claims
  -> rebuild temporal beliefs for user + space
  -> rebuild threads for user + space
  -> close durable state job
```

If any projection step fails, the job retries with the existing bounded
backoff. Threads cannot report a successfully processed version that beliefs
did not finish producing.

Deletion is stricter: the scoped thread view is cleared in the tombstone
transaction so deleted evidence cannot remain visible through a stale thread
after a crash. Beliefs and threads are then rebuilt from surviving evidence.

## Extractor additions

The claim extractor now recognizes narrow lifecycle predicates:

```text
thread.status      project.status     goal / goal.status
problem / problem.status              waiting.for / waiting.status
expected.next      health.symptom     health.plan / health.status
```

The prompt explicitly prohibits inventing an open loop from a mere topic
mention. Named situations remain entity subjects wherever the message supplies
one.

## Failure posture

- No evidence: no thread.
- Conflicting closure: unresolved with `conflicting` confidence.
- Inactivity: dormant, never resolved.
- Temporary emotion: not a thread.
- Prospective trigger: not a commitment reference.
- External prompt injection: excluded before thread projection.
- Deleted evidence: stale projection cleared transactionally and rebuilt.
- Process restart: projection and transition rows persist; replay stays
  deterministic.

## Evaluation

Run:

```bash
npm run eval:memory-threads
```

The suite covers:

- meeting reschedule without thread forking;
- waiting-to-resolved identity continuity;
- blocked-to-resolved transitions;
- deletion preview and deterministic fallback;
- dormancy without fabricated closure;
- routine evidence thresholds;
- external-content poisoning;
- unresolved equal-authority conflict;
- commitment completion and prospective-memory separation;
- temporary emotion isolation;
- byte-for-byte replay determinism;
- state-job integration;
- restart persistence and SQLite integrity.

The thread suite is part of the frozen regression manifest alongside the
foundation, truth, stress, prospective, commitment, and envelope suites.

## Deliberately not in Phase 4

- Threads are not yet compiled into every text/voice turn. That is Phase 5's
  context compiler.
- Threads do not proactively interrupt the user. The attention engine comes
  after compiled context and runs in shadow first.
- No LLM decides thread closure, dormancy, or current truth.
- No fuzzy cross-entity merging. Alias/entity resolution must remain
  explainable before it can merge anchors.
- No people/place/project dossier UI, weekly constellation, or monthly arc yet;
  those are rebuildable views to add beside the Phase 5 compiler.
- No prosody, adaptive humor, relationship repair, or learned attention.

Phase 4 supplies the missing continuity primitive: Recall can now answer, from
grounded state, **what situation is still alive, what changed, what it is
waiting for, and whether it truly ended**.
