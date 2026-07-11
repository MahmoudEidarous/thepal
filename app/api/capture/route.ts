import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { enrich, localToday, redactSecrets, type Envelope } from "@/lib/envelope";
import { invalidateCorpus } from "@/lib/fusion";

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
    const envelope: Envelope | null = await enrich(safe, source, today);

    // eval harness: return the envelope without persisting anything
    if (body.dryRun === true) {
      return Response.json({ envelope, preRedacted });
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
      containerTag: spaceTag(asSpace(body.space)),
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
        // the typed ledger: commitments open here, close by voice
        ...(envelope?.type === "commitment" || kindFallback === "commitment"
          ? {
              status: "open",
              ...(envelope?.due ?? (typeof body.due === "string" && body.due)
                ? { due: envelope?.due ?? body.due }
                : {}),
            }
          : {}),
      },
    });
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
            containerTag: spaceTag(asSpace(body.space)),
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
    invalidateCorpus(asSpace(body.space));
    return Response.json({ ...doc, envelope: envelope ?? undefined });
  } catch (err) {
    return apiError(err);
  }
}
