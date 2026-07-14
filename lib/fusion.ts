import { spaceTag, supermemory, type Space } from "./supermemory";
import type { Sensitivity, TrustTier } from "./memory/contracts";

// Vague-query fusion + truth arbitration for /api/recall.
//
// Validated by three adversarial banks before shipping:
//   vague bank — 19/25 single-search baseline → 25/25 fused
//   truth bank — staleness, negation, near-dups, write lag, with the
//                controls that caught two bugs in early fix drafts
//                (day-only stamps inverted flips; dedup ate an update)
//   read bank  — grounded answering + honest abstains stay intact
//
// The semantic engine is the graph's extracted-memory view (the ranking
// the vague bank's 30/30 was earned on). Each memory carries a link to
// its source document via include.documents — that link supplies the
// told-timestamp truth arbitration runs on.
//
// Pipeline, in collision-safe order:
//   1. parallel lists: base + probes (filler-strip, negation-flip,
//      entity anchors) + rule lists (temporal, safety, fresh)
//   2. Reciprocal Rank Fusion — raw similarity is not comparable across
//      query embeddings; score-merging measurably evicted good hits
//   3. cluster-classify-collapse — near-identical candidates group;
//      groups differing in a negator/number/change-verb are CONFLICTS
//      (keep all, newest telling first), the rest are duplicates (best
//      survives, freed slots backfill)
//   4. dup-aware guaranteed seats — base top-3 may be added back, never
//      a twin of something the collapse already kept
//
// Everything runs concurrently against the local engine: ~30-90ms.

export type Hit = {
  documentId: string;
  memory: string;
  createdAt: string | null;
  similarity: number;
};

type Lean = {
  id: string;
  text: string;
  full: boolean;
  createdAt: string | null;
  status: string | null;
  story: string | null;
  due: string | null;
  type: string | null;
  // the ledger's own state (metadata.status): open | done for commitments
  ledger: string | null;
  entities: string | null;
  trust: TrustTier | null;
  sensitivity: Sensitivity;
  eventId: string | null;
};

type Corpus = {
  docs: Lean[];
  aliases: Map<string, string>;
  // Canonical external content is searchable source material, never user
  // memory. Supermemory may still return an extracted hit for it, so retain
  // an explicit deny set and apply it after every semantic probe.
  blockedIds: Set<string>;
};

const CORPUS_TTL = 120_000;
const corpusCache = new Map<string, { at: number; corpus: Corpus }>();
const contentCache = new Map<string, string>(); // content never changes after write

const str = (v: unknown) => (typeof v === "string" ? v : null);
const stripHintSuffix = (t: string) => t.replace(/\s*\(answers:[\s\S]*$/, "").trim();

// a fresh capture must be recallable immediately — the write pokes us
export function invalidateCorpus(space: Space) {
  corpusCache.delete(spaceTag(space));
}

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
  })) as {
    memories?: Array<{
      id: string;
      content?: string | null;
      status?: string | null;
      createdAt?: string;
      metadata?: Record<string, unknown> | null;
    }>;
  };
  const docs: Lean[] = [];
  const aliases = new Map<string, string>();
  const blockedIds = new Set<string>();
  for (const d of res.memories ?? []) {
    const m = d.metadata ?? {};
    if (m.type === "briefing") continue;
    const source = str(m.source)?.toLowerCase() ?? "";
    if (
      m.canonicalTrustTier === "external_content" ||
      source.includes("recall-web") ||
      source.startsWith("web:")
    ) {
      blockedIds.add(d.id);
      continue;
    }
    const hydrated = contentCache.get(d.id);
    docs.push({
      id: d.id,
      text: hydrated ?? d.content ?? "",
      full: hydrated !== undefined,
      createdAt: d.createdAt ?? null,
      status: d.status ?? null,
      story: str(m.storyDate),
      due: str(m.due),
      type: str(m.type),
      ledger: str(m.status),
      entities: str(m.entities),
      trust: str(m.canonicalTrustTier) as TrustTier | null,
      sensitivity: (["normal", "sensitive", "restricted"] as const).includes(
        str(m.canonicalSensitivity) as Sensitivity,
      )
        ? (str(m.canonicalSensitivity) as Sensitivity)
        : "normal",
      eventId: str(m.canonicalEventId),
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
  const corpus = { docs, aliases, blockedIds };
  corpusCache.set(tag, { at: Date.now(), corpus });
  return corpus;
}

async function hydrate(d: Lean): Promise<string> {
  if (d.full) return d.text;
  const cached = contentCache.get(d.id);
  if (cached !== undefined) return cached;
  try {
    // read-only GET is safe even while the doc is still processing
    const doc = (await supermemory.documents.get(d.id)) as { content?: string | null };
    const content = stripHintSuffix(doc.content ?? d.text);
    contentCache.set(d.id, content);
    return content;
  } catch {
    return stripHintSuffix(d.text);
  }
}

// ── query shaping ─────────────────────────────────────────────────
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

// ── truth arbitration ─────────────────────────────────────────────
const STOP = new Set(
  "the a an of on in at for to and or is are was were i my me we it this that with got has have had still user".split(" "),
);
// digits of ANY length count — "1:52" and "kilometer 18" are exactly the
// tokens that distinguish two tellings of the same race
const words = (t: string) =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !STOP.has(w)),
  );
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter || 1);
};
// 0.24 measured on the truth bank: retellings pair at 0.25-0.33,
// different-event twins and story-vs-context stay ≤0.20, conflicts 0.38+
const TWIN = 0.24;
// reversals AND revisions — "moved to Cafe Riche" carries no negator and
// no number, yet it's an update, not a retelling; without change-verbs
// the collapse classifies it as a duplicate and eats the new truth
const CHANGE =
  /\b(not|no longer|anymore|never|stopped|cancel|cancelled|quit|backed out|off|swore off|came? around|moved|moving|pushed|changed|switch(ed)?|resched|instead|relocat|postpon|renamed|raised|lowered|dropped to)\b/i;
const CRITICAL =
  /\b(\d+|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function collapse(results: Hit[]): Hit[] {
  const groups: Hit[][] = [];
  for (const r of results) {
    const g = groups.find((grp) => jaccard(words(grp[0].memory), words(r.memory)) >= TWIN);
    if (g) g.push(r);
    else groups.push([r]);
  }
  const out: Hit[] = [];
  for (const g of groups) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    const diff: string[] = [];
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const wa = words(g[i].memory);
        const wb = words(g[j].memory);
        for (const t of wa) if (!wb.has(t)) diff.push(t);
        for (const t of wb) if (!wa.has(t)) diff.push(t);
      }
    const conflicting =
      CHANGE.test(diff.join(" ")) || CRITICAL.test(diff.join(" ")) || g.some((r) => CHANGE.test(r.memory));
    if (conflicting) {
      // keep all versions, newest telling first — the answerer sees the
      // history and the timestamps arbitrate
      g.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      out.push(...g);
    } else {
      // true duplicates: one slot, but the union of what they said —
      // a dropped retelling once carried the only copy of the answer
      const [head, ...rest] = g;
      const extras = [
        ...new Set(rest.map((r) => r.memory).filter((t) => t && t !== head.memory)),
      ];
      out.push(
        extras.length
          ? { ...head, memory: `${head.memory} — also told as: ${extras.join(" · ")}`.slice(0, 900) }
          : head,
      );
    }
  }
  return out;
}

// ── search ────────────────────────────────────────────────────────
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type MemResult = {
  id?: string;
  memory?: string;
  chunk?: string;
  similarity?: number;
  documents?: Array<{ id?: string; createdAt?: string }>;
};

export async function fusedRecall(opts: {
  q: string;
  space: Space;
  limit: number;
  threshold?: number;
  // drop hits whose source doc isn't in the listed corpus — briefing
  // extractions wear rephrased clothes no text filter can catch; the
  // corpus already excludes them at the metadata layer
  excludeUnlisted?: boolean;
}): Promise<Hit[]> {
  const { q, space, limit } = opts;
  const threshold = opts.threshold ?? 0.55;
  const tag = spaceTag(space);
  // the extracted-memory view, each hit linked to its source document —
  // the doc link carries the told-timestamp arbitration needs
  const searchOne = (query: string): Promise<Array<Hit & { rrfKey: string }>> =>
    supermemory.search
      .memories({
        q: query,
        containerTag: tag,
        limit,
        threshold,
        include: { documents: true },
      } as Parameters<typeof supermemory.search.memories>[0])
      .then((r) =>
        (((r as { results?: MemResult[] }).results ?? [])
          .map((x, i) => ({
            documentId: x.documents?.[0]?.id ?? x.id ?? `hit:${i}`,
            memory: stripHintSuffix(x.memory ?? x.chunk ?? ""),
            createdAt: x.documents?.[0]?.createdAt ?? null,
            similarity: x.similarity ?? 0,
            rrfKey: x.id ?? x.documents?.[0]?.id ?? `hit:${i}`,
          }))
          .filter((h) => h.memory)),
      )
      .catch(() => []);

  const corpusP = getCorpus(space).catch(
    (): Corpus => ({ docs: [], aliases: new Map<string, string>(), blockedIds: new Set<string>() }),
  );

  // probe variants — weights validated against the vague bank
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

  const toHit = async (d: Lean): Promise<Hit & { rrfKey: string }> => ({
    documentId: d.id,
    memory: await hydrate(d),
    createdAt: d.createdAt,
    similarity: 0,
    rrfKey: d.id,
  });

  // rule-based lists over write-time metadata
  const listsP: Array<Promise<{ results: Array<Hit & { rrfKey: string }>; w: number }>> = [];
  const temporal = temporalPrefixes(q);
  if (temporal) {
    const dueIntent = /\b(due|deadline|owe|must|need to)\b/i.test(q);
    const key = (d: Lean) => d.due ?? d.story ?? "9999";
    const dated = corpus.docs
      .filter((d) => temporal.prefixes.some((p) => d.story?.startsWith(p) || d.due?.startsWith(p)))
      .filter((d) => !dueIntent || d.due)
      .sort((a, b) => (temporal.sortDesc ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
    // a season query earns coverage of the whole season — round-robin
    // across its months, or five September errands starve October's
    // wedding out of the five seats
    let picked: Lean[];
    if (temporal.prefixes.length > 1) {
      const byMonth = new Map<string, Lean[]>();
      for (const d of dated) {
        const p = temporal.prefixes.find((x) => d.story?.startsWith(x) || d.due?.startsWith(x))!;
        const g = byMonth.get(p) ?? [];
        g.push(d);
        byMonth.set(p, g);
      }
      picked = [];
      for (let i = 0; picked.length < 5; i++) {
        let added = false;
        for (const p of temporal.prefixes) {
          const g = byMonth.get(p);
          if (g && i < g.length && picked.length < 5) {
            picked.push(g[i]);
            added = true;
          }
        }
        if (!added) break;
      }
    } else {
      picked = dated.slice(0, 5);
    }
    if (picked.length)
      listsP.push(Promise.all(picked.map(toHit)).then((results) => ({ results, w: temporal.w })));
  }
  if (MEDICAL.test(q)) {
    const safety = corpus.docs.filter((d) => d.type === "safety").slice(0, 6);
    if (safety.length)
      listsP.push(Promise.all(safety.map(toHit)).then((results) => ({ results, w: 2.2 })));
  }
  // dues list: "what's due", "deadline", "what do I owe" are ledger
  // questions in conversational clothes. At 400+ docs the surrounding
  // words ("weekend", "week") match a dozen bystander memories — the
  // typed ledger's open commitments cut through, nearest due first.
  let duesP: Promise<Array<Hit & { rrfKey: string }>> = Promise.resolve([]);
  if (/\b(due|deadline|overdue|owed?|owes)\b/i.test(q)) {
    const dues = corpus.docs
      .filter((d) => d.type === "commitment" && d.ledger === "open")
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
      .slice(0, 5);
    if (dues.length) {
      duesP = Promise.all(dues.map(toHit));
      listsP.push(duesP.then((results) => ({ results, w: 2.0 })));
    }
  }
  // fresh list: still-processing docs aren't searchable yet — a memory
  // told seconds ago must not produce "you never told me"
  {
    const qw = words(q);
    const pending = corpus.docs.filter(
      (d) => d.status && d.status !== "done" && d.status !== "failed",
    );
    if (pending.length) {
      listsP.push(
        Promise.all(pending.map(toHit)).then((results) => ({
          results: results.filter((h) => [...words(h.memory)].some((w) => qw.has(w))),
          w: 1.0,
        })),
      );
    }
  }

  const [baseSearch, probeSearch, ruleLists] = await Promise.all([
    searchOne(q),
    Promise.all(probes.map((p) => searchOne(p.q))),
    Promise.all(listsP),
  ]);
  const baseRaw = baseSearch.filter((hit) => !corpus.blockedIds.has(hit.documentId));
  const probeResults = probeSearch.map((results) =>
    results.filter((hit) => !corpus.blockedIds.has(hit.documentId)),
  );

  // rank with the memory view, SPEAK the source document. Extraction is
  // lossy — "grandmother owned a bakery" drops the bakery's name; the
  // envelope text keeps it. The extracted memory locates the right doc,
  // the doc's own words carry the details. Long docs (dropped files)
  // keep the extracted memory — a whole file is not an answer.
  const docsById = new Map(corpus.docs.map((d) => [d.id, d]));
  const speakDoc = async <T extends Hit>(h: T): Promise<T> => {
    const d = docsById.get(h.documentId);
    if (!d) return h;
    const text = await hydrate(d);
    if (!text || text.length > 700 || text === h.memory) return h;
    // A graph memory can be linked to several supporting documents and the
    // provider currently returns only the first. Usually the source envelope
    // is richer, but occasionally that first document is merely adjacent
    // (for example, an apartment-location memory linked first to its rent
    // note). Do not erase the correctly ranked fact with unrelated source
    // text; only speak the document when it actually supports the extraction.
    return jaccard(words(text), words(h.memory)) >= 0.12 ? { ...h, memory: text } : h;
  };
  const base = await Promise.all(baseRaw.map(speakDoc));
  for (let i = 0; i < probeResults.length; i++)
    probeResults[i] = await Promise.all(probeResults[i].map(speakDoc));

  // Reciprocal Rank Fusion — ranks, not raw scores
  const lists = [
    { results: base, w: 1.4 },
    ...probes.map((p, i) => ({ results: probeResults[i], w: p.w })),
    ...ruleLists.filter((l) => l.results.length),
  ];
  const rrf = new Map<string, { r: Hit & { rrfKey: string }; s: number }>();
  for (const { results, w } of lists)
    results.forEach((r, i) => {
      const e = rrf.get(r.rrfKey) ?? { r, s: 0 };
      e.s += w / (60 + i);
      rrf.set(r.rrfKey, e);
    });
  const fused = [...rrf.values()].sort((a, b) => b.s - a.s).map((e) => e.r);

  // collapse BEFORE seats — a seat must never resurrect a collapsed twin
  let kept: Hit[] = collapse(fused);

  // dup-aware guaranteed seats: base top-3 may be added back, but never
  // a twin of something the collapse already kept
  for (const b of base.slice(0, 3)) {
    const present = kept
      .slice(0, limit)
      .some(
        (r) =>
          r.documentId === b.documentId ||
          r.memory === b.memory ||
          jaccard(words(r.memory), words(b.memory)) >= TWIN,
      );
    if (!present) kept = [...kept.slice(0, limit - 1), b, ...kept.slice(limit - 1)];
  }
  // when the question asks what's owed, the two nearest open dues are in
  // the answer no matter what the words around them matched — same
  // dup-aware insertion as the base seats
  for (const b of (await duesP).slice(0, 2)) {
    const present = kept
      .slice(0, limit)
      .some(
        (r) =>
          r.documentId === b.documentId ||
          r.memory === b.memory ||
          jaccard(words(r.memory), words(b.memory)) >= TWIN,
      );
    if (!present) kept = [...kept.slice(0, limit - 1), b, ...kept.slice(limit - 1)];
  }
  if (opts.excludeUnlisted) kept = kept.filter((h) => docsById.has(h.documentId));
  return kept.slice(0, limit).map(({ documentId, memory, createdAt, similarity }) => ({
    documentId,
    memory,
    createdAt,
    similarity,
  }));
}

// ── the returning past ──────────────────────────────────────────────
// Deterministic anniversaries: memories whose story-date lands exactly
// N years, six months, or one month before today. No model in the loop —
// the past returns by arithmetic. Rides the same corpus cache as recall.

export type Anniversary = {
  text: string;
  when: string;
  storyDate: string;
  trust: TrustTier | null;
  sensitivity: Sensitivity;
  evidenceEventIds: string[];
};

// today minus n calendar months, or null when the day would roll over
// (July 31 minus a month is not July 1 — that day has no anniversary)
function monthsBack(today: string, n: number): string | null {
  const [y, m, d] = today.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, d));
  if (t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

export async function returningPast(space: Space, today: string): Promise<Anniversary[]> {
  const corpus = await getCorpus(space).catch(
    (): Corpus => ({ docs: [], aliases: new Map<string, string>(), blockedIds: new Set<string>() }),
  );
  const thisYear = Number(today.slice(0, 4));
  const mmdd = today.slice(5);
  const monthAgo = monthsBack(today, 1);
  const sixAgo = monthsBack(today, 6);
  const hits: Array<{ d: Lean; when: string; order: number }> = [];
  for (const d of corpus.docs) {
    // full dates only — "sometime in September 2019" has no today
    if (!d.story || d.story.length !== 10 || d.story >= today) continue;
    // the ledger's paperwork and open errands aren't the returning past
    if (d.type === "commitment") continue;
    if (d.story.slice(5) === mmdd) {
      const years = thisYear - Number(d.story.slice(0, 4));
      if (years >= 1)
        hits.push({
          d,
          when: years === 1 ? "a year ago today" : `${years} years ago today`,
          // more distance, more goosebumps — deeper years surface first
          order: -years,
        });
    } else if (sixAgo && d.story === sixAgo) hits.push({ d, when: "six months ago today", order: 1 });
    else if (monthAgo && d.story === monthAgo) hits.push({ d, when: "a month ago today", order: 2 });
  }
  hits.sort((a, b) => a.order - b.order);
  const out: Anniversary[] = [];
  for (const h of hits) {
    if (out.length >= 3) break;
    const text = (await hydrate(h.d)).slice(0, 180);
    // closure events are bookkeeping, not the past returning
    if (!text || /^(Done|Cancelled):/.test(text)) continue;
    out.push({
      text,
      when: h.when,
      storyDate: h.d.story!,
      trust: h.d.trust,
      sensitivity: h.d.sensitivity,
      evidenceEventIds: h.d.eventId ? [h.d.eventId] : [],
    });
  }
  return out;
}

// ── story mode ─────────────────────────────────────────────────────
// A tour through one thread of the user's life. The fused read path
// picks the chapters; story-dates put them in the order they were
// LIVED, not the order they were told. Coarse dates (YYYY, YYYY-MM)
// sort naturally as strings.

export type StoryBeat = {
  text: string;
  date: string; // YYYY[-MM[-DD]] — storyDate when the envelope found one
  dated: boolean; // true when anchored by a real story-date
  told: string | null;
  type: string;
  entities: Array<{ name: string; kind: string }>;
};

export async function storyRecall(opts: {
  q: string;
  space: Space;
  limit?: number;
}): Promise<StoryBeat[]> {
  const limit = opts.limit ?? 8;
  // a wide pool — the chapters worth telling are often not the top hits
  const [hits, corpus] = await Promise.all([
    fusedRecall({ q: opts.q, space: opts.space, limit: Math.max(limit * 2 + 4, 20) }),
    getCorpus(opts.space).catch(
      (): Corpus => ({ docs: [], aliases: new Map<string, string>(), blockedIds: new Set<string>() }),
    ),
  ]);
  // the topic must actually live in this corpus — nonsense peaks near
  // 0.57 similarity, real threads at 0.75+. No anchor, no story: better
  // to say so than narrate eight unrelated chapters with a straight face.
  if (!hits.some((h) => h.similarity >= 0.62)) return [];
  const byId = new Map(corpus.docs.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const beats: StoryBeat[] = [];
  for (const h of hits) {
    if (seen.has(h.documentId)) continue;
    seen.add(h.documentId);
    const doc = byId.get(h.documentId);
    const story = doc?.story ?? null;
    const date = story ?? h.createdAt?.slice(0, 10) ?? null;
    if (!date) continue;
    const entities: Array<{ name: string; kind: string }> = [];
    for (const part of (doc?.entities ?? "").split(",")) {
      const [names, kind] = part.trim().split("#");
      const name = names?.split("/")[0]?.trim();
      if (name) entities.push({ name, kind: kind?.trim() || "thing" });
    }
    beats.push({
      text: h.memory,
      date,
      dated: !!story,
      told: h.createdAt,
      type: doc?.type ?? "memory",
      entities: entities.slice(0, 3),
    });
  }
  // story-dated beats are the narrative spine, but only a nudge ahead —
  // a dated stray must not outrank a strong on-topic hit. Then a near-dup
  // pass: two tellings of the same race make one chapter, not two.
  const scored = beats
    .map((b, rank) => ({ b, key: rank - (b.dated ? 6 : 0) }))
    .sort((x, y) => x.key - y.key)
    .map((x) => x.b);
  // TWIN-level dedup on purpose: fusedRecall keeps retellings so truth
  // arbitration can compare them — a tour wants one chapter per happening
  const kept: StoryBeat[] = [];
  for (const b of scored) {
    if (kept.some((k) => jaccard(words(k.text), words(b.text)) > TWIN)) continue;
    kept.push(b);
    if (kept.length >= limit) break;
  }
  kept.sort((a, b) => a.date.localeCompare(b.date));
  return kept;
}
