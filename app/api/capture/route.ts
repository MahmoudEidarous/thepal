import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { enrich, localToday, redactSecrets, type Envelope } from "@/lib/envelope";
import { fusedRecall, invalidateCorpus, type Hit } from "@/lib/fusion";
import { openCommitments, setLedgerStatus } from "@/lib/ledger";

// ── conflict-aware filing ─────────────────────────────────────────
// "This changes what I knew." A new telling that collides with an older
// memory gets ANNOTATED at write time — the filing card shows what it
// updates, the agent can grin at the flip. The old memory is never
// rewritten or deleted: this is the honest slice of reconsolidation.
// Change-language in the user's own words is the trigger; without it,
// only a near-restatement (very high similarity) counts as an update.
const CHANGE_HINT =
  /\b(actually|instead|no longer|not anymore|anymore|moved|moving|changed|switch(ed)?|turns out|correction|scratch|forget (that|the|it)|never ?mind|new plan|re-?decided|decided on|going with|went with|settled on|updat(e|ed|ing)|wrong|after all|from now on|these days|now)\b/i;

function findConflict(
  probe: Hit[],
  newText: string,
  envelope: Envelope | null,
): { id: string; text: string; told: string | null } | null {
  // reschedules ride the supersede net — whenever the enricher named a
  // ledger item this telling replaces, that net owns the collision
  if (envelope?.type === "commitment" || typeof envelope?.supersedes === "number") return null;
  const changeSpoken = CHANGE_HINT.test(newText);
  const entNames = (envelope?.entities ?? [])
    .flatMap((e) => [e.name, ...e.aliases])
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 2);
  let best: { id: string; text: string; told: string | null; sim: number } | null = null;
  for (const c of probe) {
    // the ledger's paperwork and the night editor's prose never conflict
    if (!c.memory || /^(Done|Cancelled):/.test(c.memory) || /^Good morning/i.test(c.memory))
      continue;
    const overlap = entNames.some((n) => c.memory.toLowerCase().includes(n));
    const qualifies = changeSpoken
      ? (overlap && c.similarity >= 0.6) || c.similarity >= 0.74
      : c.similarity >= 0.82;
    if (!qualifies) continue;
    if (!best || c.similarity > best.sim)
      best = { id: c.documentId, text: c.memory.slice(0, 200), told: c.createdAt, sim: c.similarity };
  }
  return best ? { id: best.id, text: best.text, told: best.told } : null;
}

// The Writer. Every memory — spoken, typed, or dropped as a file —
// passes through here once, gets its secrets stripped locally, and is
// wrapped in a write-time envelope (type, provenance, story-date, due,
// weight, salience, entities, phrasing hints). Labels are written now
// so the read side never has to reconstruct them later.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const raw = typeof body.content === "string" ? body.content.trim() : "";
    if (!raw) {
      return Response.json({ error: "content required" }, { status: 400 });
    }

    // secrets are removed on this machine, before any model sees them
    const { text: safe, redacted: preRedacted } = redactSecrets(raw);

    const today = localToday();
    const source = typeof body.source === "string" ? body.source : "recall-app";
    // the open ledger rides along so the enricher can spot a reschedule —
    // "the Sofia meeting is tomorrow now" retires the old telling instead
    // of nagging beside it
    const space = asSpace(body.space);
    // the conflict probe runs concurrently with enrichment — by the time
    // the envelope lands, we already know what this telling collides with
    const probeP: Promise<Hit[]> = fusedRecall({
      q: safe.slice(0, 300),
      space,
      limit: 6,
      excludeUnlisted: true,
    }).catch(() => []);
    const ledger = await openCommitments(spaceTag(space)).catch(() => []);
    const envelope: Envelope | null = await enrich(
      safe,
      source,
      today,
      ledger.map((c) => c.content),
    );
    const semanticConflict = findConflict(await probeP, safe, envelope);
    const supIdx = envelope?.supersedes;
    const priorCommitment =
      typeof supIdx === "number" && supIdx >= 1 && supIdx <= ledger.length
        ? ledger[supIdx - 1]
        : null;
    // A reschedule already has a stronger signal than vector similarity:
    // the enricher identified the exact open commitment it replaces. Turn
    // that same link into the visible, timestamped update receipt instead
    // of presenting commitments as a separate continuity mechanism.
    const conflict =
      semanticConflict ??
      (priorCommitment
        ? {
            id: priorCommitment.id,
            text: priorCommitment.content,
            told: priorCommitment.createdAt,
          }
        : null);

    // eval harness: return the envelope without persisting anything
    if (body.dryRun === true) {
      return Response.json({ envelope, preRedacted, ...(conflict ? { conflict } : {}) });
    }

    // the engine embeds what we store — writing the alternate phrasings
    // into the document makes retrieval phrasing-robust for free
    const hints = envelope?.hints?.length
      ? `\n\n(answers: ${envelope.hints.join(" · ")})`
      : "";
    // utterances get the cleaned text; whole documents keep their body —
    // the engine extracts many memories from them and needs all of it
    const content = (safe.length > 800 ? safe : (envelope?.text ?? safe)) + hints;

    const kindFallback = ["memory", "decision", "commitment", "briefing"].includes(body.kind)
      ? (body.kind as string)
      : "memory";

    const doc = await supermemory.add({
      content,
      containerTag: spaceTag(space),
      metadata: {
        source,
        type: envelope?.type ?? kindFallback,
        provenance: envelope?.provenance ?? "stated",
        salience: envelope?.salience ?? 0.5,
        valence: envelope?.valence ?? 0,
        intensity: envelope?.intensity ?? 0,
        redacted: envelope?.redacted || preRedacted,
        ...(envelope?.hints?.length ? { hints: envelope.hints.join(" · ") } : {}),
        ...(envelope?.storyDate ? { storyDate: envelope.storyDate } : {}),
        // "Name/alias#kind, Name2#kind" — the kind suffix makes the brain's
        // people/places/threads shelves possible without ever re-reading
        ...(envelope?.entities?.length
          ? {
              entities: envelope.entities
                .map((e) => `${[e.name, ...e.aliases].join("/")}#${e.kind ?? "thing"}`)
                .join(", "),
            }
          : {}),
        // the typed ledger: commitments open here, close by voice.
        // A telling that supersedes an open item IS that item moved —
        // it takes the retired one's seat on the agenda whatever type
        // the envelope gave it, or a reschedule would vanish the errand.
        ...(envelope?.type === "commitment" ||
        kindFallback === "commitment" ||
        typeof envelope?.supersedes === "number"
          ? {
              status: "open",
              ...(envelope?.due ?? (typeof body.due === "string" && body.due)
                ? { due: envelope?.due ?? body.due }
                : {}),
            }
          : {}),
        // prospective memory: still a commitment, but its due moment is
        // a future conversational context. The agenda excludes this mode;
        // the trigger matcher owns when it becomes relevant.
        ...(envelope?.prospective
          ? {
              triggerMode: "context",
              triggerTopic: envelope.prospective.topic.slice(0, 120),
              triggerAction: envelope.prospective.action.slice(0, 300),
              triggerFirePolicy: envelope.prospective.firePolicy,
              triggerCreatedAt: new Date().toISOString(),
            }
          : {}),
        // "this changes what I knew" — stamped atomically in the add
        // (a PATCH on a still-processing doc is silently eaten)
        ...(conflict
          ? {
              updates: conflict.id,
              updatesText: conflict.text.slice(0, 140),
              ...(conflict.told ? { updatesTold: conflict.told } : {}),
            }
          : {}),
      },
    });
    // the enricher named an open commitment this telling replaces — a
    // reschedule retires the old terms. The ledger nags exactly once.
    // The NAMING is the signal, not the envelope type: "the interview
    // moved to Tuesday" sometimes files as an event, and the old open
    // item must still retire or the agenda holds both days.
    let superseded: string | null = null;
    if (typeof supIdx === "number" && supIdx >= 1 && supIdx <= ledger.length) {
      const old = ledger[supIdx - 1];
      // setLedgerStatus rides the engine's sharp edges: settle races and
      // failed-immutable docs (rebirthed, never lost)
      await setLedgerStatus(spaceTag(space), old.id, {
        status: "superseded",
        supersededAt: today,
        supersededBy: doc.id,
      }).catch(() => {});
      superseded = old.content;
    }

    // commitments buried inside a longer note become their own ledger
    // entries — drop a document, and your agenda updates itself
    const embedded = (envelope?.commitments ?? []).filter(
      (c) => c.content.trim() && envelope?.type !== "commitment",
    );
    await Promise.all(
      embedded.map((c) =>
        supermemory
          .add({
            content: c.content.trim(),
            containerTag: spaceTag(space),
            metadata: {
              source: `${source}#ledger`,
              type: "commitment",
              provenance: envelope?.provenance ?? "stated",
              salience: 0.8,
              status: "open",
              ...(c.due ? { due: c.due } : {}),
            },
          })
          .catch(() => {}),
      ),
    );

    // a memory told seconds ago must be recallable seconds later — the
    // fusion's fresh-list only sees it if the corpus cache re-reads
    invalidateCorpus(space);
    return Response.json({
      ...doc,
      envelope: envelope ?? undefined,
      ...(superseded ? { superseded } : {}),
      ...(conflict ? { conflict } : {}),
    });
  } catch (err) {
    return apiError(err);
  }
}
