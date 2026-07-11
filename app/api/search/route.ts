import { NextResponse } from "next/server";

// The orb's window on the wider world, powered by Exa. Two modes:
//   answer — Exa /answer: one call, grounded prose + citations. Facts.
//   wire   — Exa /search with date filters (+ news category): dated
//            headlines with highlights. Anything where "when" matters;
//            the voice agent synthesizes the spoken take itself, so
//            recency questions cost zero extra LLM hops.
// A vague query never reaches Exa — the agent is told to ask a sharper
// question instead of padding thin results.

export const runtime = "nodejs";

const EXA = "https://api.exa.ai";
const TIMEOUT_MS = 12_000;

type Freshness = "day" | "week" | "month" | "any";

export type SearchSource = {
  title: string;
  url: string;
  domain: string;
  published: string | null;
  favicon: string | null;
  snippet: string | null;
};

// Words that carry search *intent* but no search *topic*. If nothing
// survives the strip, there is nothing to search for.
const FILLER = new Set(
  (
    "the a an of on in at for to and or is are was were whats what's what who when where how why " +
    "news latest new recent recently today now current update updates anything something stuff " +
    "things happening happened going tell me about look up search find internet web world online " +
    "check out please can you u it this that there any some more info information"
  ).split(" "),
);

function isVague(q: string) {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.filter((w) => !FILLER.has(w)).length === 0;
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sinceISO(freshness: Freshness) {
  const hours = freshness === "day" ? 36 : freshness === "week" ? 24 * 7 : 24 * 31;
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

async function exa(path: string, key: string, body: Record<string, unknown>) {
  const res = await fetch(`${EXA}${path}`, {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Exa ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

type ExaResult = {
  title?: string | null;
  url: string;
  publishedDate?: string | null;
  favicon?: string | null;
  summary?: string | null;
  highlights?: string[];
  text?: string | null;
};

const toSource = (r: ExaResult): SearchSource => ({
  title: r.title?.trim() || domainOf(r.url),
  url: r.url,
  domain: domainOf(r.url),
  published: r.publishedDate ?? null,
  favicon: r.favicon ?? null,
  snippet: (r.summary ?? r.highlights?.[0] ?? r.text ?? null)?.trim().slice(0, 320) ?? null,
});

// at most two results per domain — eight hits from one outlet is one hit
function dedupe(sources: SearchSource[], max: number) {
  const perDomain = new Map<string, number>();
  const out: SearchSource[] = [];
  for (const s of sources) {
    const n = perDomain.get(s.domain) ?? 0;
    if (n >= 2) continue;
    perDomain.set(s.domain, n + 1);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export async function POST(req: Request) {
  const started = Date.now();
  const key = process.env.EXA_API_KEY;
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    freshness?: Freshness;
    intent?: "news" | "fact";
  };
  const query = (body.query ?? "").trim();
  const freshness: Freshness = body.freshness ?? "any";
  const newsy = body.intent === "news";

  if (!query) return NextResponse.json({ mode: "error", error: "empty query" }, { status: 400 });
  if (isVague(query)) return NextResponse.json({ mode: "clarify", query });
  if (!key)
    return NextResponse.json({
      mode: "error",
      error:
        "Web search isn't configured yet — EXA_API_KEY is missing from .env.local (free key at dashboard.exa.ai).",
    });

  try {
    // wire mode: when did-it-happen matters, trust date-filtered results
    // over a synthesized answer that might lean on last month's web
    if (newsy || freshness === "day" || freshness === "week") {
      // type "fast" measured at ~0.8s vs "auto" ~2.7s, equally fresh results —
      // for a voice in mid-sentence that difference is the whole feature
      const data = await exa("/search", key, {
        query,
        type: "fast",
        numResults: 10,
        ...(newsy ? { category: "news" } : {}),
        ...(freshness !== "any" ? { startPublishedDate: sinceISO(freshness) } : {}),
        contents: { highlights: true },
      });
      let sources = dedupe(((data.results ?? []) as ExaResult[]).map(toSource), 6);
      // a hard date filter can strike out on niche topics — retry once, open
      if (!sources.length && freshness !== "any") {
        const retry = await exa("/search", key, {
          query,
          type: "fast",
          numResults: 10,
          ...(newsy ? { category: "news" } : {}),
          contents: { highlights: true },
        });
        sources = dedupe(((retry.results ?? []) as ExaResult[]).map(toSource), 6);
      }
      sources.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
      return NextResponse.json({
        mode: "wire",
        query,
        freshness,
        results: sources,
        tookMs: Date.now() - started,
      });
    }

    // answer mode: grounded prose with citations, one call. The [1][2]
    // markers link to citations the card already shows — spoken aloud
    // they're noise, so they go.
    const data = await exa("/answer", key, { query, text: false });
    const sources = dedupe(((data.citations ?? []) as ExaResult[]).map(toSource), 5);
    const answer =
      typeof data.answer === "string"
        ? data.answer
            .replace(/\[\d+(?:,\s*\d+)*\]/g, "")
            .replace(/\s+([.,;:!?])/g, "$1")
            .replace(/ {2,}/g, " ")
            .trim()
        : "";
    if (!answer && !sources.length)
      return NextResponse.json({ mode: "empty", query, results: [], tookMs: Date.now() - started });
    return NextResponse.json({
      mode: "answer",
      query,
      answer,
      results: sources,
      tookMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "search failed";
    const timedOut = /timeout|abort/i.test(msg);
    return NextResponse.json({
      mode: "error",
      query,
      error: timedOut ? "the web took too long to answer" : msg,
      tookMs: Date.now() - started,
    });
  }
}
