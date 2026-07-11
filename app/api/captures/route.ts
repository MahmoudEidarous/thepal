import { supermemory, spaceTag } from "@/lib/supermemory";
import { apiError, asSpace } from "@/lib/validate";
import { stripHints } from "@/lib/ledger";

type Doc = {
  id: string;
  content?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

// documents.list truncates content to ~50 chars — the full text (and the
// embedded hints) only comes back from documents.get. Content never changes
// after write, so a process-level cache makes the hydration one-time.
const contentCache = new Map<string, string>();

async function hydrate(d: Doc): Promise<string> {
  const cached = contentCache.get(d.id);
  if (cached !== undefined) return cached;
  try {
    const doc = (await supermemory.documents.get(d.id)) as { content?: string | null };
    const content = doc.content ?? d.content ?? "";
    contentCache.set(d.id, content);
    return content;
  } catch {
    return d.content ?? d.summary ?? d.title ?? "";
  }
}

async function pooled<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// Everything you've fed the brain, with its write-time envelope —
// type, provenance, salience, weight, dates, entities, hints.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tag = spaceTag(asSpace(url.searchParams.get("space")));
    const docs = await supermemory.documents.list({
      containerTags: [tag],
      limit: 500,
      sort: "createdAt",
      order: "desc",
    });
    const all = ((docs as { memories?: Doc[] }).memories ?? []).filter(
      (d) => d.metadata?.type !== "briefing",
    );
    const contents = await pooled(all, 8, hydrate);
    const captures = all
      .map((d, i) => ({
        id: d.id,
        createdAt: d.createdAt,
        status: d.status ?? null,
        text: stripHints(contents[i]),
        meta: (d.metadata ?? {}) as Record<string, unknown>,
      }))
      .filter((c) => c.text);
    return Response.json({ captures });
  } catch (err) {
    return apiError(err);
  }
}
