import { smRequest, supermemory } from "./supermemory";

// The typed ledger + pinned layer, read side: dumb filters over labels
// the Writer already attached. No retrieval, no guessing.

type Doc = {
  id: string;
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

// hints were written for the embedder, not for speech
export function stripHints(text: string): string {
  return text.split("\n\n(answers:")[0].trim();
}

async function listDocs(tag: string): Promise<Doc[]> {
  // high ceiling: at exactly N docs the oldest ones silently fall off —
  // which once dropped the first-ever completed commitment from history
  const docs = await supermemory.documents.list({
    containerTags: [tag],
    limit: 500,
    sort: "createdAt",
    order: "desc",
  });
  return (docs as { memories?: Doc[] }).memories ?? [];
}

export type OpenCommitment = {
  id: string;
  content: string;
  due: string | null;
  metadata: Record<string, unknown>;
};

export async function openCommitments(tag: string): Promise<OpenCommitment[]> {
  // the list index serves METADATA STALE after a PATCH (a completion or
  // supersede can read as still-open for minutes) — so candidates come
  // from the list, but truth comes from each document itself. The gets
  // were already needed for content; fresh metadata rides along free.
  const candidates = (await listDocs(tag)).filter((d) => d.metadata?.type === "commitment");
  const full = await Promise.all(
    candidates.map(async (d) => {
      const got = (await supermemory.documents.get(d.id).catch(() => null)) as {
        content?: string | null;
        metadata?: Record<string, unknown> | null;
      } | null;
      const md = (got?.metadata ?? d.metadata ?? {}) as Record<string, unknown>;
      return {
        id: d.id,
        content: stripHints(got?.content ?? d.content ?? d.title ?? d.summary ?? ""),
        due: typeof md.due === "string" ? (md.due as string) : null,
        metadata: md,
      };
    }),
  );
  return full.filter((c) => c.content && c.metadata.status === "open");
}

export type LedgerItem = {
  id: string;
  content: string;
  due: string | null;
  status: "open" | "done";
  completedAt: string | null;
  createdAt?: string;
};

// The full ledger, both sides: open promises and the done archive.
// Done things stay done — they're history, not deletions. Superseded
// and cancelled items leave the ledger views entirely; their documents
// keep the story in the graph.
export async function allCommitments(tag: string): Promise<LedgerItem[]> {
  // same staleness rule as openCommitments: list for candidates, the
  // document itself for the truth of its status
  const docs = (await listDocs(tag)).filter((d) => d.metadata?.type === "commitment");
  const full = await Promise.all(
    docs.map(async (d) => {
      const got = (await supermemory.documents.get(d.id).catch(() => null)) as {
        content?: string | null;
        metadata?: Record<string, unknown> | null;
      } | null;
      const md = (got?.metadata ?? d.metadata ?? {}) as Record<string, unknown>;
      return {
        id: d.id,
        content: stripHints(got?.content ?? d.content ?? d.title ?? d.summary ?? ""),
        due: typeof md.due === "string" ? (md.due as string) : null,
        status: (md.status === "done" ? "done" : "open") as "open" | "done",
        raw: typeof md.status === "string" ? (md.status as string) : "open",
        completedAt: typeof md.completedAt === "string" ? (md.completedAt as string) : null,
        createdAt: d.createdAt,
      };
    }),
  );
  return full
    .filter((c) => c.content && (c.raw === "open" || c.raw === "done"))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- raw is stripped, not used
    .map(({ raw, ...c }) => c);
}

// The one safe way to change a commitment's ledger state. Two engine
// truths make this non-trivial (both measured 2026-07-12): a PATCH that
// races processing is silently overwritten when it finalizes, and a
// PATCH against a FAILED doc returns 200 and changes nothing — a
// zombie no close could ever touch. So: wait for the doc to settle,
// PATCH the living, rebirth the failed (add first, delete after —
// nothing is ever lost).
export async function setLedgerStatus(
  tag: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  let doc: Doc | null = null;
  for (let i = 0; i < 8; i++) {
    doc = (await supermemory.documents.get(id).catch(() => null)) as Doc | null;
    const st = (doc as { status?: string | null } | null)?.status;
    if (!doc || !st || st === "done" || st === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!doc) return;
  const md = { ...(doc.metadata ?? {}), ...patch };
  const st = (doc as { status?: string | null }).status;
  if (st === "failed") {
    await supermemory.add({
      content: doc.content ?? doc.title ?? doc.summary ?? "",
      containerTag: tag,
      metadata: md as Record<string, string | number | boolean>,
    });
    await smRequest("DELETE", `/v3/documents/${id}`, undefined).catch(() => {});
    return;
  }
  await smRequest("PATCH", `/v3/documents/${id}`, { metadata: md });
}

// SAFETY and boundaries are pinned: injected into every session at
// connect, never dependent on retrieval again.
export async function pinned(tag: string): Promise<string[]> {
  return (await listDocs(tag))
    .filter((d) => d.metadata?.type === "safety" || d.metadata?.type === "boundary")
    .map((d) => stripHints(d.content ?? d.title ?? d.summary ?? ""))
    .filter(Boolean)
    .slice(0, 20);
}
