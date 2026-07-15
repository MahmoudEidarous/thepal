# Phase 11.5 — Memory integration closure

This phase closes the boundary between Recall's pre-foundation Supermemory corpus and the canonical memory architecture. SQLite remains the source of truth; Supermemory Local remains the semantic mirror and retrieval layer.

## Completed migration

- 434 personal Supermemory documents were classified in a read-only dry run.
- 403 legacy evidence documents were adopted into the canonical ledger.
- 8 documents were already canonical.
- 14 embedded `#ledger` derivatives and 9 generated briefings were skipped.
- No provider document was duplicated, rewritten, or deleted.
- The final canonical personal corpus contains 411 active events with successful mirror and projection jobs.
- The replay produced 721 provenance-backed beliefs, 155 life threads, and 1 prospective trigger.
- The rebuilt continuity kernel is 1,658 estimated tokens, below the 5,000-token hard limit.

Counts above record the July 15, 2026 migration and will naturally change as Recall is used.

## Safety and authority rules

Legacy evidence is imported conservatively:

- Direct Recall app and voice tellings retain `user_direct` authority.
- Old impressions, inferred records, agent output, and dream/consolidation observations become Recall-authored observations. They never become direct user truth.
- User-approved document drops remain external document quotes.
- Web material remains external content.
- Only commitments explicitly marked open remain actionable; closed or unmarked historical commitments import as memory.
- Generated briefings and embedded ledger derivatives are rebuildable output, not evidence, so they are excluded.

Every adopted event preserves its Supermemory provider ID, original type, provenance, lifecycle status, story date, entities, and a stable metadata hash. Existing Supermemory documents become the canonical event's mirror instead of being re-added.

## Failure and replay behavior

The migration is idempotent by provider ID. Raw evidence and mirror identity are committed before claim extraction. If extraction or replay stops, rerunning the command finds incomplete projection jobs and resumes them without appending another event.

Open-ended model time boundaries are normalized at the extraction boundary. Retroactive corrections cannot produce impossible end-before-start belief intervals. Beliefs, threads, prospective state, and the continuity kernel remain rebuildable projections over preserved evidence.

## Backups and recovery

Every apply run creates a private directory under `.recall/backups/` containing:

- a transactionally consistent `memory.sqlite` snapshot;
- a complete JSON snapshot of personal, work, health, and eval Supermemory spaces;
- SHA-256 hashes and recovery notes in `manifest.json`.

To recover, stop Recall, replace `.recall/memory.sqlite` with the chosen snapshot, then restore provider documents from the matching corpus snapshot only if provider recovery is also required. Backup and migration reports are private runtime artifacts and are intentionally Git-ignored.

## Evaluation isolation and health

Production health now evaluates only `personal`, `work`, and `health`. Eval queues remain visible separately but cannot make healthy personal memory report `action_required`. The reset command removes eval-only canonical rows and provider documents and cannot target a user space.

The closure cleanup removed 238 eval canonical events and 133 eval Supermemory documents while preserving all personal history.

## Commands

```bash
# Read-only classification report
npm run memory:legacy:dry-run

# Back up, adopt legacy evidence, replay projections, and rebuild the kernel
npm run memory:legacy:apply

# Remove isolated evaluation residue
npm run memory:eval:reset

# One definitive release gate: 951 regression checks, production build,
# eval cleanup, and live SQLite/Supermemory/kernel/ElevenLabs readiness
npm run memory:preflight

# Fast operational check when the full release gate is unnecessary
npm run memory:preflight:runtime
```

## Validation record

- 18 release suites: 951 checks passed.
- Production Next.js build: passed, including TypeScript and all 45 routes.
- Runtime readiness: SQLite integrity clean; user mirror and projection queues drained; legacy import blockers zero; legacy documents remaining zero; eval corpus clean; live foundation healthy; ElevenLabs presence variables, expressive v3, speculative turn taking, and `skip_turn` active.

Deep conversational experience testing can now evaluate the connected architecture rather than a split legacy/canonical memory system.
