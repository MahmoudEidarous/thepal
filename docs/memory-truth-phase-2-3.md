# Recall memory truth — Phases 2 and 3

These phases turn the Phase 0/1 evidence ledger into an evidence-linked continuity model. Supermemory still supplies document processing, embeddings, and semantic candidates. SQLite now owns the claims Recall derived and the current/historical belief projection used to decide applicability.

## Phase 2 — evidence to claims

Every canonical event transaction now creates a second durable job: `extract_and_project`. The capture response does not wait for it.

The asynchronous extractor:

1. reads the original redacted event—not a summary;
2. treats event text as untrusted data;
3. produces schema-validated subject/predicate/object claims;
4. carries polarity, modality, relation hint, valid time, scope, and extractor version;
5. generates stable claim IDs from the event and normalized claim;
6. replaces only the rebuildable claims belonging to that event.

Claims always point to their source event. They are not truth by themselves. External and document-derived claims may be retained for provenance while trust policy prevents them from becoming authoritative personal beliefs.

## Phase 3 — temporal truth and continuity

The deterministic projector groups claims by exact subject, normalized predicate, memory space, and applicability context. It then produces evidence-linked belief intervals.

Decision order:

1. An identical scoped proposition adds support.
2. An explicit correction, `supersede`, or `retract` closes the previous interval.
3. Stronger direct evidence can replace weaker inferred evidence.
4. Equally authoritative incompatible claims remain `conflicting`; recency alone does not invent certainty.
5. Weaker contradictory evidence remains `unknown` and cannot displace direct user truth.
6. Temporary or inferred applicability expires; the evidence and historical belief remain.

Every projection is replaceable and replayable from active evidence. The original event is never changed by ordinary consolidation.

## Trust policy

- `user_direct` can support durable personal beliefs.
- `user_approved` documents can support tentative non-user claims, but cannot write beliefs about the user.
- `recall_observation` is forced to inferred modality and remains tentative.
- `tool_output` can support scoped non-personal state but cannot outrank direct user evidence.
- `external_content` never enters the belief projection.
- Only direct user evidence can create safety constraints or boundaries.

This means a document containing “remember the user’s password” may exist as quarantined evidence, but it cannot become a user belief, persona rule, boundary, or safety instruction.

## Time and staleness

- Event `recordedAt`: when Recall learned the evidence.
- Claim `validTime`: when the proposition applies.
- Belief `validTime`: the interval during which the projected state applies.
- Belief `systemTime`: when Recall’s compiled understanding held.

Direct facts do not decay merely because they are old. Their current applicability closes when a correction, changed scope, or incompatible stronger evidence arrives. Inferred beliefs default to a 90-day applicability horizon. `emotion.state` is clamped to a day unless later phases promote a repeated, evidence-backed pattern. Retrieval checks applicability again at query time so a time-bounded state cannot remain active simply because no new event arrived overnight.

## Corrections

`POST /api/memory/corrections` accepts a canonical `targetEventId` and correction text. It appends a new `correction` event with `revisionOf` pointing at the prior telling. The prior event and Supermemory document are not rewritten.

For canonical documents, the existing `/api/amend` voice/tool path now uses the same append-and-project behavior. Pre-ledger documents retain the legacy amendment path so existing memories remain editable during migration.

## Deletions

Deletion is a two-step authority flow:

1. `POST /api/memory/deletions/preview` creates a short-lived, single-use consent token and reports the source excerpt, claim count, affected belief keys, and mirror presence.
2. `POST /api/memory/deletions/execute` consumes that token, removes source content, tombstones the event, deletes its claims, clears dependent beliefs, deterministically rebuilds from remaining evidence, and runs a durable Supermemory purge job.

The canonical payload becomes `[deleted by user]` with a new integrity hash. A minimal deletion audit stores only the event ID and execution time—not the deleted content. A purge/discovery job is always queued, even when no mirror row exists yet, which closes the race where a provider accepted a document immediately before deletion. `/api/forget` and canonical document deletion now run through this cascade; legacy Supermemory-only records keep the legacy deletion behavior.

## Retrieval integration

`POST /api/recall` now returns two layers:

- `beliefs`: applicable current or unresolved conflicting state from SQLite;
- `results`: semantic evidence candidates from Supermemory.

The voice tool places compiled truth before semantic history. Historical beliefs are excluded from current retrieval, while raw evidence remains available to explain what changed. This is an interim bridge; the full bounded context compiler remains a later phase.

`GET /api/memory/beliefs` provides an inspectable current/history/conflict view with optional claim relations. `GET/POST /api/memory/foundation` now reports and repairs both mirror jobs and state jobs, plus claim and belief counts.

Posting `{ "reproject": true, "space": "personal" }` to the foundation endpoint requeues every active canonical event in that space. This is the controlled replay path after an extractor, entity-normalization, or projector version upgrade.

## Storage added in schema migration 2

- `memory_state_jobs`
- `memory_claims`
- `memory_claim_relations`
- `memory_beliefs`
- `memory_deletion_consents`
- `memory_deletion_audit`

Migration 2 backfills an `extract_and_project` job for every existing non-deleted canonical event. Claim and belief tables are disposable projections; `memory_events` remains the source of truth.

## Failure behavior

- Claim extraction failure never loses or blocks the evidence receipt.
- State jobs use leases, bounded exponential retry, stale-job recovery, dead-job repair, and restart persistence.
- Re-extraction replaces one event’s derived claims idempotently.
- Rebuilding beliefs replaces one user/space projection transactionally.
- Deletion clears affected beliefs before rebuilding, preferring an empty safe state over a ghost belief if the process stops mid-operation.
- Provider deletion is a durable `purge_mirror` job and survives restarts.

## Verification

- `npm run eval:memory-truth` — 49 deterministic lifecycle checks covering meeting changes, preference changes, temporary emotion, tentative patterns, poisoning, conflicts, corrections, deletion propagation, provenance, replay, and restart persistence.
- `npm run eval:memory-stress` — 12 multi-process WAL/idempotency/crash-recovery checks across 101 canonical events.
- The Phase 0/1 replay and all pre-existing memory banks remain merge gates.

## Deliberately not included yet

- Thread/open-loop state machines
- People/place/project dossiers
- Weekly and monthly projectors
- Full context-slot compiler
- Unified attention and proactive action policy
- Relationship memory, adaptive humor, rupture/repair, and persona learning

Those later layers consume this truth model; they must never write around it.
