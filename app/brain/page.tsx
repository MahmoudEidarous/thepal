"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dust, GRAIN } from "@/components/atmosphere";
import { ContinuityBoard } from "@/components/continuity-board";
import { LifeGraphView } from "@/components/life-graph";
import { ThreadBoard, type ThreadBoardData } from "@/components/thread-board";
import { profileName, timeAgo } from "@/lib/format";
import type { ContinuityExperience } from "@/lib/memory/continuity-view";

type View = "graph" | "people" | "threads" | "continuity" | "ledger" | "captures";

type LedgerItem = {
  id: string;
  content: string;
  due: string | null;
  overdue?: boolean;
  dueToday?: boolean;
  completedAt: string | null;
};

type ProspectiveItem = {
  id: string;
  content: string;
  topic: string;
  action: string;
  snoozedUntil: string | null;
  createdAt: string | null;
};

type Capture = {
  id: string;
  createdAt?: string;
  status?: string | null;
  text: string;
  meta: Record<string, unknown>;
};

const TYPE_COLORS: Record<string, string> = {
  fact: "#6C9BF0",
  event: "#62B7E6",
  taste: "#EF7FB4",
  decision: "#52C79A",
  commitment: "#F2B03D",
  boundary: "#E9805E",
  safety: "#F05252",
  impression: "#A78BFA",
  memory: "#8B96B3",
};

// ── dates, the human way ──────────────────────────────────────────

function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDue(due: string, today: string): { text: string; tone: "late" | "now" | "soon" | "far" } {
  const diff = daysBetween(today, due);
  if (diff < 0) return { text: diff === -1 ? "1 day late" : `${-diff} days late`, tone: "late" };
  if (diff === 0) return { text: "today", tone: "now" };
  if (diff === 1) return { text: "tomorrow", tone: "now" };
  if (diff <= 7) {
    const [y, m, d] = due.split("-").map(Number);
    return { text: WEEKDAYS[new Date(y, m - 1, d).getDay()], tone: "soon" };
  }
  return { text: prettyDate(due), tone: "far" };
}

function dayLabel(createdAt: string, today: string): string {
  const day = new Date(createdAt).toLocaleDateString("en-CA");
  const diff = daysBetween(day, today);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  const d = new Date(createdAt);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const DUE_TONE: Record<string, string> = {
  late: "bg-red-500/15 text-red-300",
  now: "bg-amber-400/15 text-amber-200",
  soon: "bg-white/[0.07] text-zinc-300",
  far: "bg-white/[0.05] text-zinc-500",
};

export default function Brain() {
  const [view, setView] = useState<View>("graph");
  const [graphCount, setGraphCount] = useState(0);
  const [profileLines, setProfileLines] = useState<string[]>([]);
  const [ledger, setLedger] = useState<{
    open: LedgerItem[];
    done: LedgerItem[];
    prospective: ProspectiveItem[];
  } | null>(null);
  const [captures, setCaptures] = useState<Capture[] | null>(null);
  const [threadData, setThreadData] = useState<ThreadBoardData | null>(null);
  const [continuityData, setContinuityData] = useState<ContinuityExperience | null>(null);
  const [hintsFor, setHintsFor] = useState<Record<string, string[]>>({});
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [capQ, setCapQ] = useState("");
  const [personQ, setPersonQ] = useState("");
  const [personSel, setPersonSel] = useState<string | null>(null);
  const [lens, setLens] = useState<"told" | "lived">("told");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const today = localToday();

  // deep link: /brain?tab=ledger
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (
      t === "ledger" ||
      t === "captures" ||
      t === "people" ||
      t === "threads" ||
      t === "continuity"
    )
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL read after hydration
      setView(t);
  }, []);

  const loadLedger = useCallback(() => {
    fetch("/api/ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d) =>
          d &&
          setLedger({
            open: d.open ?? [],
            done: d.done ?? [],
            prospective: d.prospective ?? [],
          }),
      )
      .catch(() => {});
  }, []);

  const loadCaptures = useCallback(() => {
    fetch("/api/captures")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCaptures(d.captures ?? []))
      .catch(() => {});
  }, []);

  const loadThreads = useCallback(() => {
    fetch("/api/memory/threads?limit=500&transitions=true&transitionLimit=2000")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setThreadData(data))
      .catch(() => {});
  }, []);

  const loadContinuity = useCallback(() => {
    fetch("/api/memory/continuity?view=overview")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data && setContinuityData(data))
      .catch(() => {});
  }, []);

  // Everything loads up front — tab switches are instant, counts are live.
  // The graph owns its focused canonical + semantic request separately.
  useEffect(() => {
    loadLedger();
    loadCaptures();
    loadThreads();
    loadContinuity();
    const t = setInterval(() => {
      if (!document.hidden) {
        loadLedger();
        loadCaptures();
        loadThreads();
        loadContinuity();
      }
    }, 12_000);
    return () => clearInterval(t);
  }, [loadLedger, loadCaptures, loadThreads, loadContinuity]);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
         
        setProfileLines([...(d?.profile?.static ?? []), ...(d?.profile?.dynamic ?? [])]);
      })
      .catch(() => {});
  }, []);

  const name = useMemo(
    () =>
      profileName([...profileLines, ...(captures ?? []).map((c) => c.text)])?.toUpperCase() ??
      "YOU",
    [profileLines, captures],
  );

  async function completeItem(id: string) {
    setClosing(id);
    await fetch("/api/agenda/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setClosing(null);
    loadLedger();
  }

  async function manageProspective(
    id: string,
    operation: "resolve" | "cancel" | "snooze",
  ) {
    setClosing(id);
    await fetch("/api/prospective", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, id }),
    }).catch(() => {});
    setClosing(null);
    loadLedger();
  }

  async function revealHints(c: Capture) {
    const fromMeta = typeof c.meta.hints === "string" ? (c.meta.hints as string) : null;
    if (fromMeta) {
      setHintsFor((h) => ({ ...h, [c.id]: fromMeta.split(" · ") }));
      return;
    }
    const doc = await fetch(`/api/document?id=${encodeURIComponent(c.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const m = (doc?.content ?? "").match(/\(answers: ([\s\S]*?)\)\s*$/);
    setHintsFor((h) => ({ ...h, [c.id]: m ? m[1].split(" · ") : [] }));
  }

  // ── ledger groups ────────────────────────────────────────────────
  const groups = useMemo(() => {
    const open = ledger?.open ?? [];
    const late = open.filter((c) => c.due && c.due < today);
    const soon = open.filter((c) => c.due && c.due >= today && daysBetween(today, c.due) <= 7);
    const later = open.filter((c) => c.due && daysBetween(today, c.due) > 7);
    const someday = open.filter((c) => !c.due);
    return [
      { title: "overdue", items: late, accent: "text-red-300" },
      { title: "this week", items: soon, accent: "text-amber-200" },
      { title: "later", items: later, accent: "text-zinc-300" },
      { title: "no deadline", items: someday, accent: "text-zinc-500" },
    ].filter((g) => g.items.length > 0);
  }, [ledger, today]);

  // ── capture filters + day groups ─────────────────────────────────
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (captures ?? []).forEach((c) => {
      const t = String(c.meta.type ?? "memory");
      counts.set(t, (counts.get(t) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [captures]);

  const dayGroups = useMemo(() => {
    const needle = capQ.trim().toLowerCase();
    const shown = (captures ?? []).filter(
      (c) =>
        (!typeFilter || String(c.meta.type ?? "memory") === typeFilter) &&
        (!needle ||
          c.text.toLowerCase().includes(needle) ||
          String(c.meta.entities ?? "").toLowerCase().includes(needle)),
    );
    const out: Array<{ day: string; items: Capture[] }> = [];
    const push = (label: string, c: Capture) => {
      const last = out[out.length - 1];
      if (last && last.day === label) last.items.push(c);
      else out.push({ day: label, items: [c] });
    };
    if (lens === "lived") {
      // when it HAPPENED — the story-date the envelope wrote, not the
      // day you said it. The same memories, rearranged into a life.
      const storyKey = (c: Capture) =>
        typeof c.meta.storyDate === "string"
          ? (c.meta.storyDate as string)
          : c.createdAt
            ? new Date(c.createdAt).toLocaleDateString("en-CA")
            : "";
      const thisYear = today.slice(0, 4);
      const label = (sd: string) => {
        const y = sd.slice(0, 4);
        if (y !== thisYear) return y || "undated";
        const m = Number(sd.slice(5, 7));
        return m
          ? new Date(Number(y), m - 1, 1).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })
          : y;
      };
      shown
        .slice()
        .sort((a, b) => storyKey(b).localeCompare(storyKey(a)))
        .forEach((c) => push(label(storyKey(c)), c));
      return out;
    }
    shown.forEach((c) => push(c.createdAt ? dayLabel(c.createdAt, today) : "earlier", c));
    return out;
  }, [captures, typeFilter, capQ, today, lens]);

  const openCount = ledger?.open.length ?? 0;
  const lateCount = ledger?.open.filter((c) => c.due && c.due < today).length ?? 0;

  // ── people & places — the envelope tags entities on every write ──
  const people = useMemo(() => {
    type Ent = {
      name: string;
      aliases: Set<string>;
      items: Capture[];
      types: Map<string, number>;
      kinds: Map<string, number>;
    };
    const map = new Map<string, Ent>();
    const addTo = (e: Ent, c: Capture, kind: string) => {
      e.kinds.set(kind, (e.kinds.get(kind) ?? 0) + 1);
      if (e.items.includes(c)) return;
      e.items.push(c);
      const t = String(c.meta.type ?? "memory");
      e.types.set(t, (e.types.get(t) ?? 0) + 1);
    };
    for (const c of captures ?? []) {
      if (typeof c.meta.entities !== "string") continue;
      for (const raw of (c.meta.entities as string).split(", ")) {
        const [namesPart, kindPart] = raw.split("#");
        const kind = ["person", "place", "thread", "thing"].includes(kindPart)
          ? kindPart
          : "thing";
        const parts = (namesPart ?? "").split("/").map((s) => s.trim()).filter(Boolean);
        if (!parts[0]) continue;
        const key = parts[0].toLowerCase();
        const e =
          map.get(key) ??
          ({
            name: parts[0],
            aliases: new Set<string>(),
            items: [],
            types: new Map(),
            kinds: new Map(),
          } as Ent);
        parts.slice(1).forEach((a) => e.aliases.add(a));
        addTo(e, c, kind);
        map.set(key, e);
      }
    }
    // fold alias entries into their canonical owner ("Mom/Hoda" + "Hoda")
    for (const e of [...map.values()]) {
      for (const a of e.aliases) {
        const dupe = map.get(a.toLowerCase());
        if (dupe && dupe !== e) {
          dupe.items.forEach((c) =>
            addTo(e, c, [...dupe.kinds.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "thing"),
          );
          dupe.aliases.forEach((x) => e.aliases.add(x));
          map.delete(a.toLowerCase());
        }
      }
    }
    // fold same-kind name-subsets ("pilot" into "Leipzig pilot",
    // "German class" into "German A2 class") — the envelope names the
    // same storyline differently on different days
    {
      const ents = [...map.entries()];
      const topKind = (e: (typeof ents)[0][1]) =>
        [...e.kinds.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "thing";
      for (const [key, e] of ents) {
        const tokens = new Set(key.split(/\s+/));
        if (!map.has(key)) continue;
        const host = ents.find(
          ([k2, e2]) =>
            k2 !== key &&
            map.has(k2) &&
            topKind(e2) === topKind(e) &&
            // fold small into strictly bigger — never a city into its flat
            e2.items.length > e.items.length &&
            k2.split(/\s+/).length > tokens.size &&
            [...tokens].every((t) => k2.split(/\s+/).includes(t)),
        );
        if (host) {
          e.items.forEach((c) => addTo(host[1], c, topKind(e)));
          host[1].aliases.add(e.name);
          e.aliases.forEach((a) => host[1].aliases.add(a));
          map.delete(key);
        }
      }
    }
    return [...map.values()]
      .map((e) => ({
        name: e.name.charAt(0).toUpperCase() + e.name.slice(1),
        aliases: [...e.aliases].filter(
          (a) =>
            a.toLowerCase() !== e.name.toLowerCase() &&
            // the enricher occasionally hallucinates translated aliases
            !/[^ -ɏḀ-ỿ]/.test(a),
        ),
        items: e.items.slice().sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
        types: [...e.types.entries()].sort((a, b) => b[1] - a[1]),
        kind: [...e.kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "thing",
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [captures]);

  const selPerson = personSel ? people.find((p) => p.name === personSel) ?? null : null;
  const personCommitments = useMemo(() => {
    if (!selPerson || !ledger) return [];
    const names = [selPerson.name, ...selPerson.aliases].map((n) =>
      n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const re = new RegExp(`\\b(${names.join("|")})\\b`, "i");
    return ledger.open.filter((c) => re.test(c.content));
  }, [selPerson, ledger]);

  return (
    <div className="relative h-dvh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_640px_at_50%_45%,rgb(84_104_255/0.08),transparent_70%)]"
      />
      <Dust />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[45] opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />

      {/* chrome */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="flex items-baseline gap-1 text-[16px] font-semibold tracking-tight text-white transition-opacity hover:opacity-80"
        >
          recall
          <span className="inline-block size-[5px] rounded-full bg-blue-400" />
        </Link>

        <nav className="glass-chip flex max-w-[calc(100vw-120px)] items-center gap-1 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["graph", graphCount],
              ["people", people.length],
              ["threads", threadData?.rollup.active ?? 0],
              [
                "continuity",
                (continuityData?.overview?.routines.routines.length ?? 0) +
                  (continuityData?.overview?.anniversaries.memories.length ?? 0) +
                  (continuityData?.overview?.humor.artifacts.length ?? 0),
              ],
              ["ledger", openCount],
              ["captures", captures?.length ?? 0],
            ] as Array<[View, number]>
          ).map(([v, n]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-all " +
                (view === v
                  ? "bg-white/10 text-zinc-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]"
                  : "text-zinc-500 hover:text-zinc-200")
              }
            >
              {v}
              {n > 0 && (
                <span
                  className={
                    "font-mono text-[10px] " +
                    (v === "ledger" && lateCount > 0
                      ? "text-red-300"
                      : view === v
                        ? "text-zinc-400"
                        : "text-zinc-600")
                  }
                >
                  {n}
                </span>
              )}
            </button>
          ))}
        </nav>

        <Link
          href="/"
          className="glass-chip hidden rounded-full px-3.5 py-2 text-[12px] text-zinc-400 transition-colors hover:text-zinc-100 sm:block"
        >
          ← talk
        </Link>
      </header>

      {/* ── graph ─────────────────────────────────────────────── */}
      {view === "graph" && <LifeGraphView name={name} onCount={setGraphCount} />}

      {/* ── people & places — a page for everyone you mention ─── */}
      {view === "people" && (
        <div className="absolute inset-0 overflow-y-auto pb-24 pt-24">
          <div className="mx-auto flex w-[min(92vw,720px)] flex-col gap-6">
            {!selPerson ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <div>
                    <h1 className="text-[26px] font-light tracking-tight text-zinc-50">
                      People & places
                    </h1>
                    <p className="mt-1 text-[13.5px] text-zinc-500">
                      Everyone and everything your memory knows by name.
                    </p>
                  </div>
                  <input
                    value={personQ}
                    onChange={(e) => setPersonQ(e.target.value)}
                    placeholder="find someone"
                    className="glass-chip h-9 w-48 rounded-full px-4 text-[13px] text-zinc-100 transition-all placeholder:text-zinc-600 focus:border-white/25"
                  />
                </div>
                {(
                  [
                    ["person", "people"],
                    ["place", "places"],
                    ["thread", "threads — stories in motion"],
                    ["thing", "everything else"],
                  ] as const
                ).map(([kind, title]) => {
                  const group = people.filter(
                    (p) =>
                      p.kind === kind &&
                      (!personQ.trim() ||
                        [p.name, ...p.aliases]
                          .join(" ")
                          .toLowerCase()
                          .includes(personQ.trim().toLowerCase())),
                  );
                  if (!group.length) return null;
                  return (
                    <section key={kind}>
                      <h2 className="mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] uppercase tracking-[0.25em] text-zinc-500">
                        {title} <span className="text-zinc-600">{group.length}</span>
                      </h2>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {group.map((p) => (
                          <button
                            key={p.name}
                            onClick={() => setPersonSel(p.name)}
                            className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3.5 text-left transition-all hover:border-white/20 hover:bg-white/[0.06]"
                          >
                            <p className="truncate text-[14.5px] font-medium text-zinc-100">
                              {p.name}
                            </p>
                            {p.aliases.length > 0 && (
                              <p className="truncate text-[11px] text-zinc-600">
                                also {p.aliases.join(", ")}
                              </p>
                            )}
                            <p className="mt-1.5 flex items-center gap-2">
                              <span className="font-mono text-[10px] text-zinc-500">
                                {p.items.length} memor{p.items.length === 1 ? "y" : "ies"}
                              </span>
                              <span className="flex items-center gap-1">
                                {p.types.slice(0, 4).map(([t]) => (
                                  <span
                                    key={t}
                                    title={t}
                                    className="size-[6px] rounded-full"
                                    style={{ background: TYPE_COLORS[t] ?? TYPE_COLORS.memory }}
                                  />
                                ))}
                              </span>
                            </p>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </>
            ) : (
              <>
                <div>
                  <button
                    onClick={() => setPersonSel(null)}
                    className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-200"
                  >
                    ← everyone
                  </button>
                  <h1 className="mt-2 text-[26px] font-light tracking-tight text-zinc-50">
                    {selPerson.name}
                    {selPerson.aliases.length > 0 && (
                      <span className="ml-3 text-[13px] text-zinc-500">
                        also {selPerson.aliases.join(", ")}
                      </span>
                    )}
                  </h1>
                  <p className="mt-1 text-[13.5px] text-zinc-500">
                    {selPerson.items.length} memor
                    {selPerson.items.length === 1 ? "y" : "ies"} between you
                  </p>
                </div>

                {personCommitments.length > 0 && (
                  <section>
                    <h2 className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.25em] text-amber-200/80">
                      open between you
                    </h2>
                    <div className="glass divide-y divide-white/[0.055] rounded-2xl">
                      {personCommitments.map((c) => {
                        const due = c.due ? fmtDue(c.due, today) : null;
                        return (
                          <div key={c.id} className="flex items-center gap-3.5 px-5 py-3">
                            <span className="size-[7px] shrink-0 rounded-full bg-amber-300 shadow-[0_0_8px_1px_rgb(252_211_77/0.4)]" />
                            <p className="flex-1 text-[13.5px] leading-relaxed text-zinc-200">
                              {c.content}
                            </p>
                            {due && (
                              <span
                                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${DUE_TONE[due.tone]}`}
                              >
                                {due.text}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="flex flex-col gap-2">
                  {selPerson.items.map((c) => {
                    const type = String(c.meta.type ?? "memory");
                    const color = TYPE_COLORS[type] ?? TYPE_COLORS.memory;
                    const tentative = type === "impression";
                    return (
                      <article
                        key={c.id}
                        className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3"
                      >
                        <div className="flex items-baseline gap-2.5">
                          <span
                            className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]"
                            style={{ color }}
                          >
                            {type}
                          </span>
                          {tentative && (
                            <span className="text-[10.5px] italic text-zinc-600">
                              held loosely
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-[10.5px] text-zinc-600">
                            {typeof c.meta.storyDate === "string"
                              ? (c.meta.storyDate as string)
                              : c.createdAt
                                ? timeAgo(c.createdAt)
                                : ""}
                          </span>
                        </div>
                        <p
                          className={
                            "mt-1.5 text-[13.5px] leading-relaxed " +
                            (tentative ? "italic text-zinc-400" : "text-zinc-200")
                          }
                        >
                          {c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}
                        </p>
                      </article>
                    );
                  })}
                </section>
              </>
            )}
          </div>
        </div>
      )}

      {view === "threads" && <ThreadBoard data={threadData} />}

      {view === "continuity" && <ContinuityBoard data={continuityData} />}

      {/* ── ledger ────────────────────────────────────────────── */}
      {view === "ledger" && (
        <div className="absolute inset-0 overflow-y-auto pb-24 pt-24">
          <div className="mx-auto flex w-[min(92vw,600px)] flex-col gap-7">
            <div>
              <h1 className="text-[26px] font-light tracking-tight text-zinc-50">
                The ledger
              </h1>
              <p className="mt-1 text-[13.5px] text-zinc-500">
                {!ledger
                  ? "reading…"
                  : openCount === 0
                    ? "Nothing owed. Promise something out loud — it lands here."
                    : `${openCount} open promise${openCount === 1 ? "" : "s"}${
                        lateCount > 0 ? ` — ${lateCount} overdue` : ""
                      }. Check them off, or just tell me you did it.`}
              </p>
            </div>

            {ledger && ledger.prospective.length > 0 && (
              <section>
                <h2 className="mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] uppercase tracking-[0.25em] text-sky-300/80">
                  next time
                  <span className="text-zinc-600">{ledger.prospective.length}</span>
                </h2>
                <div className="glass divide-y divide-white/[0.055] rounded-2xl">
                  {ledger.prospective.map((trigger) => (
                    <div
                      key={trigger.id}
                      className={
                        "px-5 py-4 transition-opacity duration-500 " +
                        (closing === trigger.id ? "opacity-30" : "")
                      }
                    >
                      <div className="flex items-start gap-3.5">
                        <span className="mt-1.5 size-[7px] shrink-0 rounded-full bg-sky-300/90 shadow-[0_0_9px_1px_rgb(125_211_252/0.45)]" />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-sky-300/70">
                            when {trigger.topic} comes up
                          </p>
                          <p className="mt-1.5 text-[14.5px] leading-relaxed text-zinc-100">
                            {trigger.action}
                          </p>
                          {trigger.snoozedUntil && (
                            <p className="mt-1 font-mono text-[9.5px] tracking-[0.08em] text-zinc-600">
                              quiet until {trigger.snoozedUntil.slice(0, 10)}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 pl-[21px]">
                        <button
                          onClick={() => manageProspective(trigger.id, "resolve")}
                          disabled={closing === trigger.id}
                          className="rounded-full bg-emerald-300/[0.08] px-3 py-1.5 text-[10.5px] text-emerald-200/80 ring-1 ring-inset ring-emerald-300/[0.15] transition-colors hover:bg-emerald-300/[0.14]"
                        >
                          handled
                        </button>
                        <button
                          onClick={() => manageProspective(trigger.id, "snooze")}
                          disabled={closing === trigger.id}
                          className="rounded-full bg-white/[0.04] px-3 py-1.5 text-[10.5px] text-zinc-400 ring-1 ring-inset ring-white/[0.07] transition-colors hover:text-zinc-200"
                        >
                          tomorrow
                        </button>
                        <button
                          onClick={() => manageProspective(trigger.id, "cancel")}
                          disabled={closing === trigger.id}
                          className="rounded-full px-3 py-1.5 text-[10.5px] text-zinc-600 transition-colors hover:text-red-300"
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {groups.map((g) => (
              <section key={g.title}>
                <h2
                  className={`mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] uppercase tracking-[0.25em] ${g.accent}`}
                >
                  {g.title}
                  <span className="text-zinc-600">{g.items.length}</span>
                </h2>
                <div className="glass divide-y divide-white/[0.055] rounded-2xl">
                  {g.items.map((c) => {
                    const due = c.due ? fmtDue(c.due, today) : null;
                    return (
                      <div
                        key={c.id}
                        className={
                          "flex items-center gap-3.5 px-5 py-3.5 transition-opacity duration-500 " +
                          (closing === c.id ? "opacity-30" : "")
                        }
                      >
                        <button
                          onClick={() => completeItem(c.id)}
                          disabled={closing === c.id}
                          aria-label="Mark done"
                          title="Mark done"
                          className="group grid size-[20px] shrink-0 place-items-center rounded-full border border-white/25 transition-all hover:border-emerald-300/80 hover:bg-emerald-300/15"
                        >
                          <span className="text-[11px] leading-none text-emerald-300 opacity-0 transition-opacity group-hover:opacity-100">
                            ✓
                          </span>
                        </button>
                        <p className="flex-1 text-[14.5px] leading-relaxed text-zinc-100">
                          {c.content}
                        </p>
                        {due && (
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${DUE_TONE[due.tone]}`}
                            title={c.due ?? undefined}
                          >
                            {due.text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {ledger && openCount === 0 && ledger.prospective.length === 0 && (
              <div className="glass rounded-3xl p-8 text-center">
                <p className="text-[15px] font-light text-zinc-200">The ledger is clear.</p>
                <p className="mt-1.5 text-[12.5px] text-zinc-500">
                  Say “remind me to…” and it shows up here, dated.
                </p>
              </div>
            )}

            {ledger && ledger.done.length > 0 && (
              <section>
                <button
                  onClick={() => setShowDone((s) => !s)}
                  className="mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] uppercase tracking-[0.25em] text-emerald-300/70 transition-colors hover:text-emerald-200"
                >
                  kept <span className="text-zinc-600">{ledger.done.length}</span>
                  <span className="text-zinc-600">{showDone ? "▾" : "▸"}</span>
                </button>
                {showDone && (
                  <div className="flex flex-col">
                    {ledger.done.map((c) => (
                      <div key={c.id} className="flex items-center gap-3.5 px-5 py-2">
                        <span className="grid size-[20px] shrink-0 place-items-center rounded-full bg-emerald-400/15 text-[11px] leading-none text-emerald-300/80">
                          ✓
                        </span>
                        <p className="flex-1 text-[13.5px] leading-relaxed text-zinc-500 line-through decoration-zinc-700">
                          {c.content}
                        </p>
                        {c.completedAt && (
                          <span className="shrink-0 text-[11px] text-zinc-600">
                            {prettyDate(c.completedAt)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      )}

      {/* ── captures — every memory with its envelope ─────────── */}
      {view === "captures" && (
        <div className="absolute inset-0 overflow-y-auto pb-24 pt-24">
          <div className="mx-auto flex w-[min(92vw,640px)] flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <h1 className="text-[26px] font-light tracking-tight text-zinc-50">Captures</h1>
                <p className="mt-1 text-[13.5px] text-zinc-500">
                  Everything you&apos;ve told me, with the envelope it was written in.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="glass-chip flex items-center rounded-full p-0.5">
                  {(
                    [
                      ["told", "as told"],
                      ["lived", "as lived"],
                    ] as const
                  ).map(([k, t]) => (
                    <button
                      key={k}
                      onClick={() => setLens(k)}
                      className={
                        "rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all " +
                        (lens === k
                          ? "bg-white/10 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-200")
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <input
                  value={capQ}
                  onChange={(e) => setCapQ(e.target.value)}
                  placeholder="search captures"
                  className="glass-chip h-9 w-44 rounded-full px-4 text-[13px] text-zinc-100 transition-all placeholder:text-zinc-600 focus:border-white/25"
                />
              </div>
            </div>

            {captures && captures.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setTypeFilter(null)}
                  className={
                    "rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all " +
                    (!typeFilter
                      ? "bg-white/10 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-200")
                  }
                >
                  all <span className="font-mono text-[10px] opacity-60">{captures.length}</span>
                </button>
                {typeCounts.map(([t, n]) => {
                  const color = TYPE_COLORS[t] ?? TYPE_COLORS.memory;
                  const active = typeFilter === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(active ? null : t)}
                      className={
                        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all " +
                        (active ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-200")
                      }
                    >
                      <span className="size-[7px] rounded-full" style={{ background: color }} />
                      {t} <span className="font-mono text-[10px] opacity-60">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {!captures ? (
              <p className="text-[13px] text-zinc-600">opening the archive…</p>
            ) : captures.length === 0 ? (
              <p className="text-[14px] font-light text-zinc-400">Nothing captured yet.</p>
            ) : dayGroups.length === 0 ? (
              <p className="text-[13.5px] text-zinc-500">
                Nothing matches{capQ ? ` “${capQ.trim()}”` : ""} — try the search on the graph
                too; it looks inside every memory.
              </p>
            ) : (
              dayGroups.map((g) => (
                <section key={g.day}>
                  <div className="mb-4 flex items-center gap-4">
                    <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                      {g.day}
                    </h2>
                    <div className="h-px flex-1 bg-gradient-to-r from-white/[0.09] to-transparent" />
                  </div>
                  {/* the spine: a luminous thread; each memory a star on it,
                      its glow carrying the weight the envelope gave it */}
                  <div className="relative ml-[5px] flex flex-col pl-6">
                    <div
                      aria-hidden
                      className="absolute bottom-2 left-0 top-2 w-px bg-gradient-to-b from-white/[0.14] via-white/[0.05] to-transparent"
                    />
                    {g.items.map((c, idx) => {
                      const type = String(c.meta.type ?? "memory");
                      const closed = /^(Done|Cancelled):/.test(c.text);
                      const cancelled = c.text.startsWith("Cancelled:");
                      const archived =
                        c.meta.status === "superseded" || c.meta.status === "cancelled";
                      const color = closed
                        ? cancelled
                          ? "#8B96B3"
                          : "#52C79A"
                        : (TYPE_COLORS[type] ?? TYPE_COLORS.memory);
                      const sal =
                        typeof c.meta.salience === "number" ? (c.meta.salience as number) : 0.5;
                      const hints = hintsFor[c.id];
                      const long = c.text.length > 260;
                      const open = expanded[c.id];
                      const entities = [
                        ...new Set(
                          typeof c.meta.entities === "string"
                            ? (c.meta.entities as string)
                                .split(", ")
                                .map((e) => e.split("#")[0].split("/")[0])
                                .filter(Boolean)
                            : [],
                        ),
                      ];
                      const dot = 6 + sal * 4;
                      return (
                        <article
                          key={c.id}
                          className="row-in group relative -mx-3 rounded-2xl px-3 py-3 transition-colors duration-300 hover:bg-white/[0.025]"
                          style={{ animationDelay: `${Math.min(idx * 45, 450)}ms` }}
                        >
                          <span
                            aria-hidden
                            className="absolute top-[19px] rounded-full transition-shadow duration-300"
                            style={{
                              left: -24.5 - dot / 2,
                              width: dot,
                              height: dot,
                              background: archived ? "transparent" : color,
                              border: archived ? `1px solid ${color}88` : "none",
                              boxShadow: archived
                                ? "none"
                                : `0 0 ${Math.round(5 + sal * 12)}px ${Math.round(1 + sal * 2.5)}px ${color}${sal >= 0.7 ? "66" : "3d"}`,
                              opacity: archived ? 0.6 : 0.75 + sal * 0.25,
                            }}
                          />
                          <div className="flex items-baseline gap-x-2.5">
                            <span
                              className="shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.22em]"
                              style={{ color, opacity: archived ? 0.55 : 0.95 }}
                            >
                              {closed ? (cancelled ? "called off" : "closed") : type}
                            </span>
                            {archived && (
                              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                                {c.meta.status === "superseded" ? "superseded ↻" : "cancelled"}
                              </span>
                            )}
                            {c.meta.triggerMode === "context" && (
                              <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-sky-300/70">
                                prospective
                              </span>
                            )}
                            {typeof c.meta.storyDate === "string" &&
                              c.meta.storyDate !== c.meta.due && (
                                <span className="truncate font-mono text-[9.5px] tracking-[0.1em] text-zinc-600 tabular-nums">
                                  about {c.meta.storyDate as string}
                                </span>
                              )}
                            {typeof c.meta.provenance === "string" &&
                              c.meta.provenance !== "stated" && (
                                <span className="shrink-0 font-mono text-[9.5px] tracking-[0.1em] text-zinc-600">
                                  {c.meta.provenance as string}
                                </span>
                              )}
                            {c.meta.redacted === true && (
                              <span className="shrink-0 font-mono text-[9.5px] tracking-[0.1em] text-zinc-600">
                                secrets stripped
                              </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-[9.5px] tracking-[0.1em] text-zinc-600 tabular-nums">
                              {c.createdAt ? timeAgo(c.createdAt) : ""}
                            </span>
                          </div>
                          <p
                            className={`mt-1.5 text-[14.5px] font-light leading-relaxed ${
                              archived ? "text-zinc-500" : "text-zinc-100"
                            }`}
                          >
                            {long && !open ? `${c.text.slice(0, 260)}…` : c.text}
                            {long && (
                              <button
                                onClick={() => setExpanded((x) => ({ ...x, [c.id]: !open }))}
                                className="ml-1.5 text-[12px] text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-300"
                              >
                                {open ? "less" : "more"}
                              </button>
                            )}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                            {typeof c.meta.due === "string" && !archived && !closed && (
                              <span className="flex items-center rounded-full bg-amber-300/[0.08] px-2 py-[2px] font-mono text-[9px] tracking-[0.08em] text-amber-200/80 ring-1 ring-inset ring-amber-300/[0.16] tabular-nums">
                                due{" "}
                                {/^\d{4}-\d{2}-\d{2}$/.test(c.meta.due as string)
                                  ? prettyDate(c.meta.due as string)
                                  : (c.meta.due as string)}
                              </span>
                            )}
                            {c.meta.triggerMode === "context" &&
                              typeof c.meta.triggerTopic === "string" && (
                                <span className="flex items-center rounded-full bg-sky-300/[0.08] px-2 py-[2px] font-mono text-[9px] tracking-[0.08em] text-sky-200/80 ring-1 ring-inset ring-sky-300/[0.16]">
                                  next time · {c.meta.triggerTopic as string}
                                </span>
                              )}
                            {entities.map((e) => (
                              <span
                                key={e}
                                className="rounded-full bg-white/[0.04] px-2 py-[2px] font-mono text-[9px] tracking-[0.06em] text-zinc-500 ring-1 ring-inset ring-white/[0.06]"
                              >
                                {e}
                              </span>
                            ))}
                            {hints === undefined ? (
                              <button
                                onClick={() => revealHints(c)}
                                className="font-mono text-[9.5px] tracking-[0.08em] text-zinc-700 opacity-0 transition-all hover:text-indigo-300 focus-visible:opacity-100 group-hover:opacity-100"
                              >
                                also answers ›
                              </button>
                            ) : hints.length === 0 ? (
                              <span className="font-mono text-[9.5px] text-zinc-700">no hints</span>
                            ) : null}
                          </div>
                          {typeof c.meta.updatesText === "string" && (
                            <p className="mt-2 border-l border-sky-300/25 pl-3 font-mono text-[10px] leading-relaxed text-zinc-500">
                              <span className="mr-1.5 uppercase tracking-[0.16em] text-sky-300/70">
                                updates
                              </span>
                              “{c.meta.updatesText as string}”
                              {typeof c.meta.updatesTold === "string" && (
                                <span className="ml-1.5 text-zinc-600">
                                  told {timeAgo(c.meta.updatesTold as string)}
                                </span>
                              )}
                            </p>
                          )}
                          {hints !== undefined && hints.length > 0 && (
                            <div className="mt-2 flex flex-col gap-1 border-l border-white/[0.07] pl-3">
                              {hints.map((h, i) => (
                                <p key={i} className="text-[12px] italic leading-relaxed text-zinc-400">
                                  “{h}”
                                </p>
                              ))}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
