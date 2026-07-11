import { supermemory, spaceTag, type Space } from "@/lib/supermemory";

// Vague-query fusion for /api/recall — validated on 25 very hard cases
// (baseline 19/25 → 25/25 with the agent's rephrase layer on top).
//
// One semantic search can't resolve "what's my sister up to?",
// "anything due end of August?" or "what should no doctor give me?".
// So the base query fans out into parallel probes — filler-stripped,
// entity-anchored (the envelope stores "Layla/my sister" as one entity),
// negation-flipped ("unsigned" → "need to sign") — plus two rule-based
// lists over write-time metadata: a temporal router (month/season words →
// storyDate/due filters) and a safety booster (medical context always
// surfaces type=safety). Lists are fused with Reciprocal Rank Fusion —
// raw similarity scores are NOT comparable across query embeddings, and
// naive score-merging measurably evicted good base hits. The base
// query's top-3 keep guaranteed seats: probes may add, never evict.
// Everything runs concurrently: ~20-90ms on the local engine.

type Lean = {
  id: string;
  text: string;
  full: boolean;
  story: string | null;
  due: string | null;
  type: string | null;
};

type Corpus = { docs: Lean[]; aliases: Map<string, string> };

export type Hit = { documentId?: string; id?: string; memory?: string; chunk?: string };

const CORPUS_TTL = 120_000;
const corpusCache = new Map<string, { at: number; corpus: Corpus }>();
const contentCache = new Map<string, string>(); // content never changes after write

const str = (v: unknown) => (typeof v === "string" ? v : null);

// metadata-only list — fast; full text is hydrated per matched doc only
async function getCorpus(space: Space): Promise<Corpus> {
  const tag = spaceTag(space);
  const cached = corpusCache.get(tag);
  if (cached && Date.now() - cached.at < CORPUS_TTL) return cached.corpus;
  const res = (await supermemory.documents.list({
    containerTags: [tag],
    limit: 500,
    sort: "createdAt",
    order: "desc",
  })) as { memories?: Array<{ id: string; content?: string | null; metadata?: Record<string, unknown> | null }> };
  const docs: Lean[] = [];
  const aliases = new Map<string, string>();
  for (const d of res.memories ?? []) {
    const m = d.metadata ?? {};
    if (m.type === "briefing") continue;
    const hydrated = contentCache.get(d.id);
    docs.push({
      id: d.id,
      text: hydrated ?? d.content ?? "",
      full: hydrated !== undefined,
      story: str(m.storyDate),
      due: str(m.due),
      type: str(m.type),
    });
    // "Layla/my sister#person, Kasr Al Ainy hospital/Kasr Al Ainy#place"
    const raw = str(m.entities);
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const [names] = part.trim().split("#");
      if (!names) continue;
      const all = names.split("/").map((s) => s.trim()).filter(Boolean);
      for (const a of all) if (a.length > 2) aliases.set(a.toLowerCase(), all[0]);
    }
  }
  const corpus = { docs, aliases };
  corpusCache.set(tag, { at: Date.now(), corpus });
  return corpus;
}

async function hydrate(d: Lean): Promise<string> {
  if (d.full) return d.text;
  const cached = contentCache.get(d.id);
  if (cached !== undefined) return cached;
  try {
    const doc = (await supermemory.documents.get(d.id)) as { content?: string | null };
    const content = (doc.content ?? d.text).split("\n\n(answers:")[0].trim();
    contentCache.set(d.id, content);
    return content;
  } catch {
    return d.text;
  }
}

// question scaffolding that carries no retrieval signal
const FILLER =
  /\b(what|whats|what's|when|when's|whens|why|how|did|do|does|was|were|is|are|the|thing|that|this|with|on|it|i|we|my|me|ever|again|go|up|to|a|an|of|for|about|remember|you|know|tell|called|call|still|sitting|left|anything|something)\b|[?'’—-]/gi;
const strip = (q: string) => q.replace(FILLER, " ").replace(/\s+/g, " ").trim();

// "unsigned" never appears in memories, "sign" does — each negation flip
// becomes a to-do-shaped probe ("need to sign")
const unstems = (q: string) =>
  [...q.matchAll(/\bun([a-z]{3,})\b/gi)].map((m) => m[1].replace(/ed$|d$/, ""));

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const SEASONS: Record<string, number[]> = {
  spring: [2, 3, 4],
  summer: [5, 6, 7],
  fall: [8, 9, 10],
  autumn: [8, 9, 10],
  winter: [11, 0, 1],
};

// month/season/relative-time words → storyDate/due prefixes. An explicit
// month or season is the user asking BY DATE — strong; "coming up" is weak.
function temporalPrefixes(q: string, today = new Date()) {
  const low = q.toLowerCase();
  const ym = (mi: number) => {
    const y = today.getFullYear() + (mi < today.getMonth() ? 1 : 0); // past month → next year
    return `${y}-${String(mi + 1).padStart(2, "0")}`;
  };
  const sortDesc = /\b(end of|late)\b/.test(low);
  const mi = MONTHS.findIndex((m) => low.includes(m));
  if (mi >= 0) return { prefixes: [ym(mi)], w: 2.4, sortDesc };
  const season = Object.keys(SEASONS).find((s) => low.includes(s));
  if (season) return { prefixes: SEASONS[season].map(ym), w: 2.4, sortDesc };
  if (/\b(this|next) (week|weekend|month)|tomorrow|coming up|soon\b/.test(low))
    return { prefixes: [today.toISOString().slice(0, 7)], w: 0.9, sortDesc };
  return null;
}

const MEDICAL =
  /\b(surgery|surgeon|doctor|doctors|hospital|medical|emergency|ambulance|operation|injured|prescri|medication|sick)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hitId = (r: Hit) => r.documentId ?? r.id ?? (r.memory ?? r.chunk ?? "").slice(0, 60);

export async function fusedRecall(opts: {
  q: string;
  space: Space;
  limit: number;
  threshold?: number;
}): Promise<Hit[]> {
  const { q, space, limit } = opts;
  const threshold = opts.threshold ?? 0.55;
  const tag = spaceTag(space);
  const searchOne = (query: string): Promise<Hit[]> =>
    supermemory.search
      .memories({ q: query, containerTag: tag, limit, threshold })
      .then((r) => ((r as { results?: Hit[] }).results ?? []))
      .catch(() => []);

  const corpusP = getCorpus(space).catch(() => ({ docs: [], aliases: new Map<string, string>() }));

  // probe variants — weights validated against the hard-case bank
  const stripped = strip(q);
  const probes: Array<{ q: string; w: number }> = [];
  if (stripped && stripped.toLowerCase() !== q.toLowerCase()) probes.push({ q: stripped, w: 0.8 });
  for (const stem of unstems(q).slice(0, 2)) probes.push({ q: `need to ${stem}`, w: 0.8 });

  const corpus = await corpusP;
  const matched: string[] = [];
  for (const [alias, canonical] of corpus.aliases) {
    if (matched.includes(canonical)) continue;
    if (new RegExp(`\\b${escapeRe(alias)}\\b`, "i").test(q)) matched.push(canonical);
    if (matched.length >= 2) break;
  }
  for (const m of matched) {
    probes.push({ q: `${m} ${stripped}`.trim(), w: 0.8 });
    probes.push({ q: m, w: 0.6 }); // the entity alone — its memories carry the answer
  }

  // rule-based lists over write-time metadata
  const listsP: Array<Promise<{ results: Hit[]; w: number }>> = [];
  const temporal = temporalPrefixes(q);
  if (temporal) {
    const dueIntent = /\b(due|deadline|owe|must|need to)\b/i.test(q);
    const key = (d: Lean) => d.due ?? d.story ?? "9999";
    const dated = corpus.docs
      .filter((d) => temporal.prefixes.some((p) => d.story?.startsWith(p) || d.due?.startsWith(p)))
      .filter((d) => !dueIntent || d.due)
      .sort((a, b) => (temporal.sortDesc ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))))
      .slice(0, 5);
    if (dated.length)
      listsP.push(
        Promise.all(dated.map(async (d) => ({ documentId: d.id, memory: await hydrate(d) }))).then(
          (results) => ({ results, w: temporal.w }),
        ),
      );
  }
  if (MEDICAL.test(q)) {
    const safety = corpus.docs.filter((d) => d.type === "safety").slice(0, 6);
    if (safety.length)
      listsP.push(
        Promise.all(safety.map(async (d) => ({ documentId: d.id, memory: await hydrate(d) }))).then(
          (results) => ({ results, w: 2.2 }),
        ),
      );
  }

  const [base, probeResults, ruleLists] = await Promise.all([
    searchOne(q),
    Promise.all(probes.map((p) => searchOne(p.q))),
    Promise.all(listsP),
  ]);

  // Reciprocal Rank Fusion — ranks, not raw scores
  const lists = [
    { results: base, w: 1.4 },
    ...probes.map((p, i) => ({ results: probeResults[i], w: p.w })),
    ...ruleLists,
  ];
  const rrf = new Map<string, { r: Hit; s: number }>();
  for (const { results, w } of lists)
    results.forEach((r, i) => {
      const id = hitId(r);
      const e = rrf.get(id) ?? { r, s: 0 };
      e.s += w / (60 + i);
      rrf.set(id, e);
    });
  let fused = [...rrf.values()].sort((a, b) => b.s - a.s).map((e) => e.r);
  // base top-3 keep guaranteed seats — probes may add, never evict
  for (const b of base.slice(0, 3))
    if (!fused.slice(0, limit).some((r) => hitId(r) === hitId(b)))
      fused = [...fused.slice(0, limit - 1), b, ...fused.slice(limit - 1)];
  return fused.slice(0, limit);
}
