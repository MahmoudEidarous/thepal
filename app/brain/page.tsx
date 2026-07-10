"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dust, GRAIN } from "@/components/atmosphere";
import { timeAgo } from "@/lib/format";
import type { MemoryEntry } from "@/lib/memory-types";

type View = "graph" | "ledger" | "captures";

type Node = MemoryEntry & {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  degree: number;
};

type LedgerItem = {
  id: string;
  content: string;
  due: string | null;
  overdue?: boolean;
  dueToday?: boolean;
  completedAt: string | null;
};

type Capture = {
  id: string;
  createdAt?: string;
  status?: string | null;
  text: string;
  meta: Record<string, unknown>;
};

const TYPE_COLORS: Record<string, string> = {
  fact: "#7FA3F2",
  event: "#9BB8F4",
  taste: "#F0A6C0",
  decision: "#8FD3B6",
  commitment: "#F5C97B",
  boundary: "#F49B9B",
  safety: "#F47F7F",
  impression: "#B48CFF",
  memory: "#93A0BE",
};

const STOP = new Set(
  "the a an is are was were to of in on for and or at with from by has have had will would that this his her their my its user user's currently recently".split(
    " ",
  ),
);

// A name for the node: prefer proper nouns, fall back to content words.
function nodeLabel(text: string): string {
  const tokens = text.replace(/[^\w\s'&-]/g, " ").split(/\s+/).filter(Boolean);
  const proper = tokens.filter(
    (w, i) => i > 0 && /^[A-Z0-9]/.test(w) && !STOP.has(w.toLowerCase()),
  );
  const content = tokens.filter((w) => !STOP.has(w.toLowerCase()));
  const pick = (proper.length ? proper : content).slice(0, 2).join(" ");
  return (pick || text.slice(0, 14)).toUpperCase();
}

function nodeColor(e: MemoryEntry): string {
  if (e.isInference) return "#B48CFF";
  if (e.history.length > 0) return "#F0A6C0";
  if (e.isStatic) return "#EFD98B";
  return "#7FA3F2";
}

function jitter(id: string, salt = 0): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

// The graph settles in a synchronous force simulation — ~60 nodes, a few
// hundred iterations, well under a frame's budget. Deterministic.
function layout(entries: MemoryEntry[], w: number, h: number) {
  const nodes = entries.slice(0, 60).map((e, i) => {
    const a = i * 2.399963 + jitter(e.id) * 0.8;
    const r0 = 100 + 28 * Math.sqrt(i + 1) + jitter(e.id, 3) * 40;
    return {
      ...e,
      x: Math.cos(a) * r0,
      y: Math.sin(a) * r0,
      r: 0,
      color: nodeColor(e),
      label: nodeLabel(e.memory),
      degree: 0,
    } as Node;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: Array<{ a: Node; b: Node; kind: string }> = [];
  nodes.forEach((n) => {
    Object.entries(n.memoryRelations ?? {}).forEach(([t, kind]) => {
      const other = byId.get(t);
      if (other) edges.push({ a: n, b: other, kind });
    });
  });
  edges.forEach((e) => {
    e.a.degree++;
    e.b.degree++;
  });
  nodes.forEach((n) => {
    n.r =
      10 +
      Math.min(16, n.degree * 5 + (n.history.length > 0 ? 4 : 0) + (n.isStatic ? 3 : 0));
  });

  const anchors = nodes.filter((n) => n.isStatic);

  for (let iter = 0; iter < 380; iter++) {
    const heat = 1 - iter / 380;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        const min = a.r + b.r + 62;
        const f = Math.min(6, (3200 / d2) * heat + (d < min ? (min - d) * 0.12 : 0));
        dx /= d;
        dy /= d;
        a.x += dx * f;
        a.y += dy * f;
        b.x -= dx * f;
        b.y -= dy * f;
      }
    }
    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - 180) * 0.02 * heat;
      e.a.x += (dx / d) * f;
      e.a.y += (dy / d) * f;
      e.b.x -= (dx / d) * f;
      e.b.y -= (dy / d) * f;
    }
    for (const n of nodes) {
      const g = anchors.includes(n) ? 0.03 : 0.008;
      n.x -= n.x * g * heat;
      n.y -= n.y * g * heat;
    }
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const scale = Math.min(
    (w - 200) / Math.max(1, maxX - minX),
    (h - 240) / Math.max(1, maxY - minY),
    1.15,
  );
  const cx = w / 2 - ((minX + maxX) / 2) * scale;
  const cy = (h + 30) / 2 - ((minY + maxY) / 2) * scale;
  nodes.forEach((n) => {
    n.x = n.x * scale + cx;
    n.y = n.y * scale + cy;
  });
  return { nodes, edges, center: { x: cx, y: cy } };
}

function SalienceBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`salience ${value}`}>
      <span className="h-[3px] w-10 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full bg-indigo-300/80"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
    </span>
  );
}

export default function Brain() {
  const [view, setView] = useState<View>("graph");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [name, setName] = useState<string>("YOU");
  const [box, setBox] = useState({ w: 1280, h: 800 });
  const [ledger, setLedger] = useState<{ open: LedgerItem[]; done: LedgerItem[] } | null>(null);
  const [captures, setCaptures] = useState<Capture[] | null>(null);
  const [hintsFor, setHintsFor] = useState<Record<string, string[]>>({});

  // deep link: /brain?tab=ledger
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "ledger" || t === "captures")
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL read after hydration
      setView(t);
  }, []);

  useEffect(() => {
    const measure = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const load = () =>
      fetch("/api/feed")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setEntries(d.entries ?? []))
        .catch(() => {});
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const m = (d?.profile?.static ?? [])
          .join(" ")
          .match(/(?:user'?s?|my) name is (\w+)/i);
        if (m) setName(m[1].toUpperCase());
      })
      .catch(() => {});
  }, []);

  const loadLedger = useCallback(() => {
    fetch("/api/ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLedger({ open: d.open ?? [], done: d.done ?? [] }))
      .catch(() => {});
  }, []);

  const loadCaptures = useCallback(() => {
    fetch("/api/captures")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCaptures(d.captures ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (view === "ledger") loadLedger();
    if (view === "captures") loadCaptures();
  }, [view, loadLedger, loadCaptures]);

  async function completeItem(id: string) {
    await fetch("/api/agenda/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
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

  const { nodes, edges, center } = useMemo(
    () => layout(entries, box.w, box.h),
    [entries, box],
  );

  const query = q.trim().toLowerCase();
  const matches = (n: Node) =>
    !query || n.memory.toLowerCase().includes(query) || n.label.toLowerCase().includes(query);
  const isLit = (n: Node) => matches(n) && (!hoverId || n.id === hoverId || connected(n));
  const connected = (n: Node) =>
    !!hoverId &&
    edges.some(
      (e) =>
        (e.a.id === hoverId && e.b.id === n.id) || (e.b.id === hoverId && e.a.id === n.id),
    );

  return (
    <div className="relative h-dvh overflow-hidden" onClick={() => setSelected(null)}>
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

        <nav className="glass-chip flex items-center gap-1 rounded-full p-1">
          {(["graph", "ledger", "captures"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-all " +
                (view === v
                  ? "bg-white/10 text-zinc-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]"
                  : "text-zinc-500 hover:text-zinc-200")
              }
            >
              {v}
            </button>
          ))}
        </nav>

        <div className="glass-chip flex items-center gap-2 rounded-full px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
          {entries.length} memories
        </div>
      </header>

      {/* ── graph ─────────────────────────────────────────────── */}
      {view === "graph" && (
        <>
          <div className="absolute inset-x-0 top-[68px] z-30 flex justify-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search the sky"
              className="glass-chip h-9 w-64 rounded-full px-4 text-center text-[12.5px] text-zinc-100 transition-all placeholder:text-zinc-600 focus:border-white/25"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {edges.map((e, i) => {
              const lit =
                hoverId && (e.a.id === hoverId || e.b.id === hoverId);
              return (
                <line
                  key={i}
                  x1={e.a.x}
                  y1={e.a.y}
                  x2={e.b.x}
                  y2={e.b.y}
                  stroke={
                    e.kind === "updates"
                      ? `rgba(244,114,140,${lit ? 0.7 : 0.34})`
                      : `rgba(150,163,255,${lit ? 0.6 : 0.26})`
                  }
                  strokeWidth={lit ? 1.8 : 1.2}
                />
              );
            })}
            {nodes
              .filter((n) => n.isStatic)
              .map((n) => (
                <line
                  key={n.id}
                  x1={center.x}
                  y1={center.y}
                  x2={n.x}
                  y2={n.y}
                  stroke="rgba(239,217,139,0.14)"
                  strokeWidth="1"
                />
              ))}
          </svg>

          {/* you, at the center of it all */}
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: center.x, top: center.y }}
          >
            <div className="flex flex-col items-center gap-2.5">
              <span className="block size-[26px] rotate-45 rounded-[6px] bg-amber-200 shadow-[0_0_28px_4px_rgb(253_230_138/0.35)]" />
              <span className="font-mono text-[11px] tracking-[0.3em] text-amber-100/90">
                {name}
              </span>
            </div>
          </div>

          {nodes.map((n) => {
            const isSel = selected?.id === n.id;
            const dim = query ? !matches(n) : hoverId ? !isLit(n) && n.id !== hoverId : false;
            return (
              <button
                key={n.id}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelected(isSel ? null : n);
                }}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 outline-none transition-opacity duration-300"
                style={{ left: n.x, top: n.y, opacity: dim ? 0.15 : 1 }}
              >
                <span className="node-in flex flex-col items-center gap-2">
                  <span
                    className={
                      "block rounded-full transition-transform duration-300 group-hover:scale-110 " +
                      (isSel ? "scale-110" : "")
                    }
                    style={{
                      width: n.r * 2,
                      height: n.r * 2,
                      background: `radial-gradient(circle at 34% 30%, ${n.color}, ${n.color}88 68%, ${n.color}55)`,
                      boxShadow: `0 0 ${isSel ? 34 : 18}px ${isSel ? 6 : 2}px ${n.color}${isSel ? "66" : "33"}, inset 0 1px 0 rgb(255 255 255 / 0.35)`,
                    }}
                  />
                  <span
                    className={
                      "max-w-[130px] truncate font-mono text-[10px] tracking-[0.18em] transition-colors " +
                      (isSel ? "text-zinc-100" : "text-zinc-500 group-hover:text-zinc-200")
                    }
                  >
                    {n.label}
                  </span>
                </span>
              </button>
            );
          })}

          {selected && (
            <aside
              onClick={(e) => e.stopPropagation()}
              className="glass animate-rise absolute bottom-6 right-6 z-40 w-[min(88vw,380px)] rounded-3xl p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                  <span
                    aria-hidden
                    className="size-[7px] rounded-full"
                    style={{
                      background: selected.color,
                      boxShadow: `0 0 10px 1px ${selected.color}66`,
                    }}
                  />
                  {selected.isInference
                    ? "inferred"
                    : selected.isStatic
                      ? "identity"
                      : selected.history.length
                        ? "evolved"
                        : "memory"}
                  {selected.version > 1 ? ` · v${selected.version}` : ""} ·{" "}
                  {timeAgo(selected.updatedAt)}
                </p>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="-mr-1 -mt-1 px-1 text-[13px] leading-none text-zinc-500 transition-colors hover:text-zinc-200"
                >
                  ✕
                </button>
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-100">
                {selected.memory}
              </p>
              {selected.history.length > 0 && (
                <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                    how it evolved
                  </p>
                  {selected.history
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((h) => (
                      <p
                        key={h.id}
                        className="text-[13px] leading-relaxed text-zinc-500 line-through decoration-zinc-600"
                      >
                        {h.memory}
                      </p>
                    ))}
                </div>
              )}
            </aside>
          )}

          <div className="pointer-events-none absolute bottom-6 left-6 z-30 flex items-center gap-4 font-mono text-[9.5px] uppercase tracking-[0.18em] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <span className="size-[7px] rounded-full bg-[#7FA3F2]" /> memory
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-[7px] rounded-full bg-[#F0A6C0]" /> evolved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-[7px] rounded-full bg-[#B48CFF]" /> inferred
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-[7px] rounded-full bg-[#EFD98B]" /> identity
            </span>
          </div>
        </>
      )}

      {/* ── ledger ────────────────────────────────────────────── */}
      {view === "ledger" && (
        <div className="absolute inset-0 overflow-y-auto pb-20 pt-24">
          <div className="mx-auto flex w-[min(92vw,620px)] flex-col gap-8">
            <section>
              <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-amber-200/80">
                open — what you owe
              </h2>
              {!ledger ? (
                <p className="font-mono text-[11px] text-zinc-600">reading the ledger…</p>
              ) : ledger.open.length === 0 ? (
                <div className="glass rounded-3xl p-6 text-center">
                  <p className="text-[14px] font-light text-zinc-300">The ledger is clear.</p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-600">
                    promise something — it lands here
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {ledger.open.map((c) => (
                    <div
                      key={c.id}
                      className="glass flex items-center gap-4 rounded-2xl px-5 py-4"
                    >
                      <span
                        className={
                          "size-[8px] shrink-0 rounded-full " +
                          (c.overdue
                            ? "bg-red-400 shadow-[0_0_10px_2px_rgb(248_113_113/0.5)]"
                            : "bg-amber-300 shadow-[0_0_10px_2px_rgb(252_211_77/0.35)]")
                        }
                      />
                      <p className="flex-1 text-[13.5px] leading-relaxed text-zinc-200">
                        {c.content}
                      </p>
                      {c.due && (
                        <span
                          className={
                            "shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] " +
                            (c.overdue
                              ? "bg-red-500/15 text-red-300"
                              : c.dueToday
                                ? "bg-amber-400/15 text-amber-200"
                                : "bg-white/[0.06] text-zinc-400")
                          }
                        >
                          {c.overdue ? "overdue" : c.dueToday ? "today" : c.due}
                        </span>
                      )}
                      <button
                        onClick={() => completeItem(c.id)}
                        className="glass-chip shrink-0 rounded-full px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-300 transition-all hover:border-emerald-300/40 hover:text-emerald-200"
                      >
                        done
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {ledger && ledger.done.length > 0 && (
              <section>
                <h2 className="mb-4 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-600">
                  done — it stays done
                </h2>
                <div className="flex flex-col gap-2">
                  {ledger.done.map((c) => (
                    <div key={c.id} className="flex items-center gap-4 px-5 py-2 opacity-60">
                      <span className="size-[7px] shrink-0 rounded-full bg-emerald-400/70" />
                      <p className="flex-1 text-[13px] leading-relaxed text-zinc-500 line-through decoration-zinc-600">
                        {c.content}
                      </p>
                      {c.completedAt && (
                        <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                          {c.completedAt}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* ── captures — every memory with its envelope ─────────── */}
      {view === "captures" && (
        <div className="absolute inset-0 overflow-y-auto pb-20 pt-24">
          <div className="mx-auto flex w-[min(92vw,680px)] flex-col gap-3">
            {!captures ? (
              <p className="text-center font-mono text-[11px] text-zinc-600">
                opening the archive…
              </p>
            ) : captures.length === 0 ? (
              <p className="text-center text-[14px] font-light text-zinc-400">
                Nothing captured yet.
              </p>
            ) : (
              captures.map((c) => {
                const type = String(c.meta.type ?? "memory");
                const color = TYPE_COLORS[type] ?? TYPE_COLORS.memory;
                const salience =
                  typeof c.meta.salience === "number" ? (c.meta.salience as number) : null;
                const hints = hintsFor[c.id];
                return (
                  <article key={c.id} className="glass rounded-2xl px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="rounded-full px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.18em]"
                        style={{ background: `${color}22`, color }}
                      >
                        {type}
                      </span>
                      {typeof c.meta.provenance === "string" &&
                        c.meta.provenance !== "stated" && (
                          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-violet-300/80">
                            {c.meta.provenance}
                          </span>
                        )}
                      {typeof c.meta.storyDate === "string" && (
                        <span className="font-mono text-[9.5px] tracking-[0.1em] text-zinc-500">
                          ⌁ {c.meta.storyDate}
                        </span>
                      )}
                      {typeof c.meta.due === "string" && (
                        <span className="font-mono text-[9.5px] tracking-[0.1em] text-amber-200/80">
                          due {c.meta.due}
                        </span>
                      )}
                      {c.meta.redacted === true && (
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-red-300/70">
                          redacted
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-3">
                        {salience !== null && <SalienceBar value={salience} />}
                        <span className="font-mono text-[9.5px] text-zinc-600">
                          {c.createdAt ? timeAgo(c.createdAt) : ""}
                        </span>
                      </span>
                    </div>
                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-zinc-200">
                      {c.text.length > 300 ? `${c.text.slice(0, 300)}…` : c.text}
                    </p>
                    {typeof c.meta.entities === "string" && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {(c.meta.entities as string).split(", ").map((e) => (
                          <span
                            key={e}
                            className="rounded-full bg-white/[0.05] px-2 py-0.5 font-mono text-[9.5px] tracking-[0.08em] text-zinc-400"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 border-t border-white/[0.05] pt-2.5">
                      {hints === undefined ? (
                        <button
                          onClick={() => revealHints(c)}
                          className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600 transition-colors hover:text-indigo-300"
                        >
                          ⌕ also answers…
                        </button>
                      ) : hints.length === 0 ? (
                        <p className="font-mono text-[10px] tracking-[0.1em] text-zinc-600">
                          no hints on this one
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <p className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-indigo-300/70">
                            also answers
                          </p>
                          {hints.map((h, i) => (
                            <p key={i} className="text-[12.5px] italic leading-relaxed text-zinc-400">
                              “{h}”
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
