import { smPost, smRequest, spaceTag, supermemory } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { enrich, localToday, redactSecrets } from "@/lib/envelope";
import { invalidateCorpus } from "@/lib/fusion";
import { stripHints } from "@/lib/ledger";

type SearchResponse = {
  results?: Array<{
    id: string;
    memory?: string;
    chunk?: string;
    similarity?: number;
    documents?: Array<{ id?: string }>;
  }>;
};

type Doc = {
  id: string;
  content?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
};

// a doc mid-pipeline must never be PATCHed — the engine loses writes
// that race its own processing. Anything settled is fair game.
const SETTLED = new Set(["done", "completed", "failed"]);

// Backs the voice agent's edit_memory tool. "Actually, it's Friday, not
// Thursday" is a correction, not a new fact — so the original document
// is rewritten in place and re-enveloped, with an audit trail of what
// it used to say. One memory per call: corrections are surgical.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const correction = typeof body.correction === "string" ? body.correction.trim() : "";
    if (!query || !correction) {
      return Response.json({ error: "query and correction required" }, { status: 400 });
    }
    const space = asSpace(body.space);
    const tag = spaceTag(space);

    const found = await smPost<SearchResponse>("/v4/search", {
      q: query,
      containerTag: tag,
      limit: 5,
      threshold: 0.5,
      include: { documents: true },
    });
    const ranked = (found.results ?? [])
      .filter((r) => (r.memory ?? r.chunk) && (r.documents?.[0]?.id ?? r.id))
      .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));

    // pick the target: best confident match that the USER actually told.
    // The system's own bookkeeping — ledger completion events, briefings —
    // is derived, never the object of a correction.
    let doc: Doc | null = null;
    let similarity = 0;
    for (const r of ranked) {
      // higher bar than forgetting: forget previews on screen before it
      // acts, amend acts on its match. At 400+ docs a nonsense query can
      // graze 0.62 (measured 0.624); real corrections sit 0.73–0.89.
      if ((r.similarity ?? 0) < 0.7) break;
      const candidate = (await supermemory.documents
        .get(r.documents?.[0]?.id ?? r.id)
        .catch(() => null)) as Doc | null;
      if (!candidate) continue;
      const md = (candidate.metadata ?? {}) as Record<string, unknown>;
      if (md.source === "recall-ledger" || md.type === "briefing") continue;
      doc = candidate;
      similarity = r.similarity ?? 0;
      break;
    }
    if (!doc) {
      return Response.json(
        {
          error: "no memory confidently matches that",
          candidates: ranked.slice(0, 3).map((r) => r.memory ?? r.chunk),
        },
        { status: 404 },
      );
    }
    if (doc.status && !SETTLED.has(doc.status)) {
      // told seconds ago, still in the pipeline — the caller should file
      // the correction as a fresh telling instead (latest telling wins)
      return Response.json(
        { busy: true, match: stripHints(doc.content ?? "") },
        { status: 409 },
      );
    }

    const before = stripHints(doc.content ?? "");
    // dryRun: which memory WOULD be rewritten — for eval harnesses and
    // anything that wants to look before it leaps. Nothing changes.
    if (body.dryRun === true) {
      return Response.json({ match: before, similarity });
    }
    const today = localToday();
    // secrets are stripped on this machine before any model sees them
    const { text: safe, redacted: preRedacted } = redactSecrets(correction);
    const envelope = await enrich(safe, "recall-voice#amend", today);

    const hints = envelope?.hints?.length ? `\n\n(answers: ${envelope.hints.join(" · ")})` : "";
    const content = (envelope?.text ?? safe) + hints;
    const prev = (doc.metadata ?? {}) as Record<string, unknown>;
    const isCommitment = envelope?.type === "commitment" || prev.type === "commitment";
    await smRequest("PATCH", `/v3/documents/${doc.id}`, {
      content,
      metadata: {
        ...prev,
        type: envelope?.type ?? prev.type ?? "memory",
        provenance: envelope?.provenance ?? "stated",
        salience: envelope?.salience ?? prev.salience ?? 0.5,
        valence: envelope?.valence ?? 0,
        intensity: envelope?.intensity ?? 0,
        redacted: envelope?.redacted || preRedacted,
        ...(envelope?.hints?.length ? { hints: envelope.hints.join(" · ") } : {}),
        ...(envelope?.storyDate ? { storyDate: envelope.storyDate } : {}),
        ...(envelope?.entities?.length
          ? {
              entities: envelope.entities
                .map((e) => `${[e.name, ...e.aliases].join("/")}#${e.kind ?? "thing"}`)
                .join(", "),
            }
          : {}),
        // an amended commitment stays on the ledger — only its terms move
        ...(isCommitment
          ? {
              status: prev.status === "done" ? "done" : "open",
              ...(envelope?.due ? { due: envelope.due } : {}),
            }
          : {}),
        // the audit trail: what it said, and when it stopped saying it
        amendedAt: today,
        amendedFrom: before.slice(0, 200),
      },
    });

    invalidateCorpus(space);
    return Response.json({
      before,
      after: envelope?.text ?? safe,
      envelope: envelope ?? undefined,
    });
  } catch (err) {
    return apiError(err);
  }
}
