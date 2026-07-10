import { supermemory } from "./supermemory";

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
  const docs = await supermemory.documents.list({
    containerTags: [tag],
    limit: 100,
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
  const open = (await listDocs(tag)).filter(
    (d) => d.metadata?.type === "commitment" && d.metadata?.status === "open",
  );
  // list truncates content — commitments are few, fetch them whole
  const full = await Promise.all(
    open.map(async (d) => {
      const got = (await supermemory.documents
        .get(d.id)
        .catch(() => null)) as { content?: string | null } | null;
      return {
        id: d.id,
        content: stripHints(got?.content ?? d.content ?? d.title ?? d.summary ?? ""),
        due: typeof d.metadata?.due === "string" ? (d.metadata.due as string) : null,
        metadata: (d.metadata ?? {}) as Record<string, unknown>,
      };
    }),
  );
  return full.filter((c) => c.content);
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
// Done things stay done — they're history, not deletions.
export async function allCommitments(tag: string): Promise<LedgerItem[]> {
  const docs = (await listDocs(tag)).filter((d) => d.metadata?.type === "commitment");
  const full = await Promise.all(
    docs.map(async (d) => {
      const got = (await supermemory.documents
        .get(d.id)
        .catch(() => null)) as { content?: string | null } | null;
      return {
        id: d.id,
        content: stripHints(got?.content ?? d.content ?? d.title ?? d.summary ?? ""),
        due: typeof d.metadata?.due === "string" ? (d.metadata.due as string) : null,
        status: (d.metadata?.status === "done" ? "done" : "open") as "open" | "done",
        completedAt:
          typeof d.metadata?.completedAt === "string" ? (d.metadata.completedAt as string) : null,
        createdAt: d.createdAt,
      };
    }),
  );
  return full.filter((c) => c.content);
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
