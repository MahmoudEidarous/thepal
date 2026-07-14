# Phase 9 — Operational hardening and release replay

Phase 9 closes the memory build with operational confidence rather than a new
cognitive layer. Recall keeps the Phase 8 architecture unchanged: SQLite is
canonical, Supermemory Local is the semantic mirror, derived projections are
rebuildable, attention remains guarded, and relationship adaptation remains
guarded.

## One health contract

`GET /api/memory/foundation` now includes a privacy-safe `health` report. It
uses queue and SQLite integrity data already stored by the ledger; it adds no
database or telemetry service.

The report distinguishes:

- canonical SQLite corruption, which stops release;
- semantic mirror failure, where evidence is safe but retrieval is degraded;
- projection failure, where current truth or continuity is incomplete;
- deletion propagation failure, where canonical deletion succeeded but the
  provider mirror still needs confirmation;
- ordinary pending work, reported as `catching_up` rather than a failure.

Only counts, issue codes, and recovery instructions leave the server. Memory
text and raw provider errors do not. `POST /api/memory/foundation` remains the
manual recovery path: `retryDead: true` requeues durable work, while
`reproject: true` is reserved for rebuilding derived state when normal retry
is insufficient.

## One release command

`npm run eval:memory-release` executes the regression manifest in order. It
composes the three live integration banks with every deterministic architecture
bank—capture, temporal truth, threads, context, prospective continuity,
attention, relationship behavior, concurrency, and crash recovery—then adds
23 operational hardening checks.

The Phase 9 checks cover healthy, catching-up, and action-required states;
separate mirror/projection/deletion classification; durable retry; restart
survival; privacy-safe errors; temporary self-state normalization; and final
SQLite integrity. The release runner requires each suite's explicit success
marker as well as a zero exit code, preventing a tolerant legacy script from
creating a false green. The earlier replay banks remain the source of realistic
conversation cases, including meeting
changes, preference corrections, contextual reminders, temporary emotion,
low-confidence patterns, proactive silence, humor cooldown, repair, deletion,
and external-content poisoning.

Provider deletion is idempotent: a typed HTTP `404` means the mirror is already
absent and completes the purge job. Conflicts such as `409 still processing`
remain retryable. Error-message text alone is never trusted as proof.

## Release rule

Memory is ready only when all of the following are true:

1. `npm run eval:memory-release` passes.
2. `npm run build` passes.
3. Foundation health reports `healthy` and `releaseReady: true` after queues
   drain.
4. Attention and relationship modes remain `guarded` until reviewed session
   replays justify a deliberate rollout change.

## Deliberately not added

Phase 9 does not add a learned ranker, prosody diagnosis, engagement
optimization, autonomous outreach, a new database, multi-device sync, or new
memory types. Those require evidence from real use, explicit consent, and a
separate decision. The reliable foundation is complete without them.
