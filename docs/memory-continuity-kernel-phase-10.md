# Phase 10 — continuity kernel and session bridge

Phase 10 turns the existing memory subsystems into one invisible, bounded friend model that is already present when an ElevenLabs session starts. It does not replace retrieval, attention, or personality. It connects them.

## Runtime contract

- SQLite remains canonical. Supermemory is not called while compiling or loading the kernel.
- The normal target is 4,200 estimated tokens; 5,000 is a hard persisted ceiling.
- The kernel contains current beliefs, active life threads, important entities, forward intentions, temporary emotional weather, grounded routine/association hypotheses, relationship boundaries, Recall promises, earned dialect, shared-reference inventory, and uncertainty.
- Stored wording is inert data. External-content evidence is excluded.
- Knowing is not permission to speak. The attention engine remains the only authority for proactive mention; personality remains the expression layer.

## Temporal horizons

The bridge deliberately avoids stacking session summaries:

1. The literal previous session is retained, even if it was brief.
2. If that session was trivial, the last meaningful session is retained separately.
3. A seven-day arc combines at most five other meaningful handoffs with the canonical weekly constellation.
4. Enduring current truth and relationship state fill the rest of the packet.

Session handoffs are deterministic, rebuildable projections. They never become canonical evidence and never update user beliefs by themselves.

## Lifecycle

1. The app prefetches `GET /api/memory/kernel` before the user opens voice.
2. A clean kernel is one SQLite row read. A missing or invalid kernel is rebuilt locally without an LLM or Supermemory.
3. The client sends the result to ElevenLabs as `{{continuity_kernel}}` at session start.
4. The live conversation remains working memory. Existing per-turn context compilation supplies only what the current turn requires.
5. On disconnect or page hide, `POST /api/memory/session` records a structured handoff and materializes the next kernel asynchronously.
6. Canonical writes, relationship writes, consolidation changes, state projection completion, and user deletion invalidate the materialized row.

## Storage

Schema migration 8 adds:

- `memory_session_handoffs`: derived session bridge, meaningfulness score, bounded summary, evidence links, relationship links.
- `memory_continuity_kernels`: versioned materialized text, source revision, provenance manifest, token count, compile/invalidated times.

Deletion fails safe: a handoff that depended on deleted evidence is removed, and the kernel is invalidated before the next session.

## Verification

Run `npm run eval:memory-kernel`. The deterministic replay covers token pressure, temporal truth, changed preferences, prospective memory, temporary emotion, low-confidence patterns, relationship boundaries, humor authority, trivial versus meaningful sessions, prompt poisoning, restart, invalidation, and deletion propagation.
