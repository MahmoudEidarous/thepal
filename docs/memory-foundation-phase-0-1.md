# Recall memory foundation — Phases 0 and 1

This is the first incremental slice of the canonical architecture. It does not replace Supermemory or change retrieval. It establishes a durable first-party evidence receipt before the existing enrichment and indexing path runs.

## Invariants

1. Every event entering `/api/capture` is appended to local SQLite before model or network work.
2. Secrets are redacted before either SQLite or a hosted model sees the payload.
3. The event row is evidence; processing state lives in a separate retryable job row.
4. Supermemory remains the semantic document/index layer and carries the canonical event ID on mirrored documents.
5. External documents, web findings, Recall inferences, and user statements retain different trust tiers.
6. A failed Supermemory write leaves the canonical event intact and retries with bounded backoff.
7. `dryRun` evaluations create no canonical or semantic data.

## Rollout and rollback

`RECALL_MEMORY_FOUNDATION_MODE` controls the write path:

- `required` (default) — SQLite must accept the canonical event before Recall acknowledges the capture.
- `shadow` — attempt the canonical write, but fall back to the previous Supermemory-first path if SQLite itself cannot open or commit. Provider failures after a successful ledger write still remain durable and retryable.
- `off` — bypass SQLite and use the previous capture path. This is the immediate rollback switch; no migration or code revert is required.

`dryRun` bypasses all three modes and remains side-effect free.

## Local storage

- Default database: `.recall/memory.sqlite`
- Override: `RECALL_MEMORY_DB_PATH=/absolute/or/project-relative/path.sqlite`
- SQLite uses foreign keys, WAL, a busy timeout, and `synchronous=FULL`.
- `.recall/` is ignored by Git.

## Operational endpoint

- `GET /api/memory/foundation` — schema/integrity/counts plus sanitized pending and dead jobs.
- `POST /api/memory/foundation` with `{ "limit": 2 }` — manually reconcile due jobs.
- Add `"retryDead": true` to the POST body to explicitly requeue parked jobs after the provider recovers.
- The existing live feed also provides a lightweight heartbeat for background reconciliation.

## Verification

Run `npm run eval:memory-foundation`. The replay requires no dev server, model, or Supermemory process. It covers contract validation, source trust, local redaction, transactional receipts, payload hashing, idempotency, job leases, retry backoff, stale-job recovery, mirror linkage, restart durability, SQLite integrity, and the frozen claim/belief projection contracts.

The complete Phase 0 regression baseline is recorded in `scripts/fixtures/memory-regression-manifest.json`. All four suites are merge gates for later phases.

## Phase boundaries

- **Phase 0 — contracts and safety rails:** versioned event, claim, and belief schemas; trust taxonomy; secret redaction; deterministic fixtures; regression manifest; rollout switch.
- **Phase 1 — canonical evidence ledger:** transactional SQLite events and jobs; canonical receipt; idempotency; Supermemory mirror linkage; bounded recovery and operational visibility.

Claims and beliefs are contract-only in Phase 0. Their materialized tables and rebuildable projectors deliberately begin in Phase 2; the evidence ledger remains the source of truth.

## Deliberately unchanged

- Fusion retrieval and result ranking
- Supermemory extraction and profile behavior
- Commitment/prospective/anniversary UX
- ElevenLabs session behavior
- Corrections, temporal beliefs, threads, attention, and relationship intelligence

Those move in later phases only after this foundation passes its exit criteria.
