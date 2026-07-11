"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dust, GRAIN } from "@/components/atmosphere";
import { profileName, timeAgo } from "@/lib/format";
import type { MemoryEntry } from "@/lib/memory-types";

type View = "graph" | "people" | "ledger" | "captures";

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
  if (e.isInference) return "#A78BFA";
  if (e.history.length > 0) return "#EF7FB4";
  if (e.isStatic) return "#EFD98B";
  return "#6C9BF0";
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
      11 +
      Math.min(15, n.degree * 5 + (n.history.length > 0 ? 4 : 0) + (n.isStatic ? 3 : 0));
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
        const min = a.r + b.r + 74;
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
      // you sit at the origin — nothing gets to sit on top of you
      const d = Math.hypot(n.x, n.y) || 1;
      const clear = anchors.includes(n) ? 84 : 132;
      if (d < clear) {
        n.x *= clear / d;
        n.y *= clear / d;
      }
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
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [profileLines, setProfileLines] = useState<string[]>([]);
  const [box, setBox] = useState({ w: 1280, h: 800 });
  const [ledger, setLedger] = useState<{ open: LedgerItem[]; done: LedgerItem[] } | null>(null);
  const [captures, setCaptures] = useState<Capture[] | null>(null);
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
    if (t === "ledger" || t === "captures" || t === "people")
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time URL read after hydration
      setView(t);
  }, []);

  useEffect(() => {
    const measure = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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

  // everything loads up front — tab switches are instant, counts are live
  useEffect(() => {
    const load = () =>
      fetch("/api/feed")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setEntries(d.entries ?? []))
        .catch(() => {});
    load();
    loadLedger();
    loadCaptures();
    const t = setInterval(() => {
      if (!document.hidden) {
        load();
        loadLedger();
        loadCaptures();
      }
    }, 12_000);
    return () => clearInterval(t);
  }, [loadLedger, loadCaptures]);

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
  const connected = (n: Node) =>
    !!hoverId &&
    edges.some(
      (e) =>
        (e.a.id === hoverId && e.b.id === n.id) || (e.b.id === hoverId && e.a.id === n.id),
    );

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
    return [...map.values()]
      .map((e) => ({
        name: e.name,
        aliases: [...e.aliases].filter((a) => a.toLowerCase() !== e.name.toLowerCase()),
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
          {(
            [
              ["graph", entries.length],
              ["people", people.length],
              ["ledger", openCount],
              ["captures", captures?.length ?? 0],
            ] as Array<[View, number]>
          ).map(([v, n]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-all " +
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
          className="glass-chip rounded-full px-3.5 py-2 text-[12px] text-zinc-400 transition-colors hover:text-zinc-100"
        >
          ← talk
        </Link>
      </header>

      {/* ── graph ─────────────────────────────────────────────── */}
      {view === "graph" && (
        <>
          <div className="absolute inset-x-0 top-[72px] z-30 flex justify-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search your memory"
              className="glass-chip h-9 w-72 rounded-full px-4 text-center text-[13px] text-zinc-100 transition-all placeholder:text-zinc-600 focus:border-white/25"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            {/* orbit rings around you */}
            {[150, 280, 410].map((r) => (
              <circle
                key={r}
                cx={center.x}
                cy={center.y}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.035)"
                strokeWidth="1"
                strokeDasharray="1 7"
              />
            ))}
            {edges.map((e, i) => {
              const lit = hoverId && (e.a.id === hoverId || e.b.id === hoverId);
              return (
                <line
                  key={i}
                  x1={e.a.x}
                  y1={e.a.y}
                  x2={e.b.x}
                  y2={e.b.y}
                  stroke={
                    e.kind === "updates"
                      ? `rgba(244,114,140,${lit ? 0.8 : 0.4})`
                      : `rgba(150,163,255,${lit ? 0.7 : 0.32})`
                  }
                  strokeWidth={lit ? 2 : 1.3}
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
                  stroke="rgba(239,217,139,0.16)"
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
              <span className="rounded-md bg-black/55 px-2 py-0.5 font-mono text-[11px] tracking-[0.25em] text-amber-100">
                {name}
              </span>
            </div>
          </div>

          {nodes.map((n) => {
            const isSel = selected?.id === n.id;
            const lit = n.id === hoverId || connected(n);
            const dim = query ? !matches(n) : hoverId ? !lit : false;
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
                style={{ left: n.x, top: n.y, opacity: dim ? 0.12 : 1 }}
              >
                <span className="node-in flex flex-col items-center gap-1.5">
                  <span
                    className={
                      "block rounded-full transition-transform duration-300 group-hover:scale-110 " +
                      (isSel ? "scale-110" : "")
                    }
                    style={{
                      width: n.r * 2,
                      height: n.r * 2,
                      background: `radial-gradient(circle at 35% 30%, ${n.color}F2, ${n.color}CC 70%, ${n.color}99)`,
                      boxShadow: `0 0 0 3px ${n.color}22, 0 0 ${isSel || lit ? 30 : 16}px ${isSel || lit ? 5 : 2}px ${n.color}${isSel || lit ? "66" : "30"}, inset 0 1px 0 rgb(255 255 255 / 0.4)`,
                    }}
                  />
                  <span
                    className={
                      "max-w-[150px] truncate rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.1em] transition-colors " +
                      (isSel || lit
                        ? "text-white"
                        : "text-zinc-400 group-hover:text-zinc-100")
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

          <div className="glass-chip pointer-events-none absolute bottom-6 left-6 z-30 flex flex-col gap-2 rounded-2xl px-4 py-3 text-[11px] text-zinc-400">
            {(
              [
                ["#6C9BF0", "remembered"],
                ["#EF7FB4", "changed its mind"],
                ["#A78BFA", "figured out on its own"],
                ["#EFD98B", "who you are"],
              ] as const
            ).map(([c, t]) => (
              <span key={t} className="flex items-center gap-2">
                <span
                  className="size-[8px] rounded-full"
                  style={{ background: c, boxShadow: `0 0 8px 1px ${c}55` }}
                />
                {t}
              </span>
            ))}
            {entries.length > 60 && (
              <span className="pt-0.5 text-[10px] text-zinc-600">
                newest 60 of {entries.length}
              </span>
            )}
          </div>
        </>
      )}

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

            {ledger && openCount === 0 && (
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
                  <h2 className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.25em] text-zinc-500">
                    {g.day}
                  </h2>
                  <div className="relative ml-[5px] flex flex-col gap-2.5 border-l border-white/[0.08] pl-5">
                    {g.items.map((c) => {
                      const type = String(c.meta.type ?? "memory");
                      const color = TYPE_COLORS[type] ?? TYPE_COLORS.memory;
                      const salience =
                        typeof c.meta.salience === "number" ? (c.meta.salience as number) : null;
                      const hints = hintsFor[c.id];
                      const long = c.text.length > 260;
                      const open = expanded[c.id];
                      const entities =
                        typeof c.meta.entities === "string"
                          ? (c.meta.entities as string)
                              .split(", ")
                              .map((e) => e.split("#")[0].split("/")[0])
                              .filter(Boolean)
                          : [];
                      const metaBits: string[] = [];
                      if (typeof c.meta.provenance === "string" && c.meta.provenance !== "stated")
                        metaBits.push(c.meta.provenance as string);
                      if (
                        typeof c.meta.storyDate === "string" &&
                        c.meta.storyDate !== c.meta.due
                      )
                        metaBits.push(`about ${c.meta.storyDate as string}`);
                      if (typeof c.meta.due === "string")
                        metaBits.push(
                          `due ${/^\d{4}-\d{2}-\d{2}$/.test(c.meta.due as string) ? prettyDate(c.meta.due as string) : (c.meta.due as string)}`,
                        );
                      if (c.meta.redacted === true) metaBits.push("secrets stripped");
                      return (
                        <article
                          key={c.id}
                          className="relative rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3.5"
                        >
                          <span
                            aria-hidden
                            className="absolute -left-[25.5px] top-[19px] size-[9px] rounded-full"
                            style={{ background: color, boxShadow: `0 0 8px 1px ${color}55` }}
                          />
                          <div className="flex items-baseline gap-2.5">
                            <span
                              className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em]"
                              style={{ color }}
                            >
                              {type}
                            </span>
                            {metaBits.length > 0 && (
                              <span className="truncate text-[11px] text-zinc-500">
                                {metaBits.join(" · ")}
                              </span>
                            )}
                            <span className="ml-auto flex shrink-0 items-center gap-2.5">
                              {salience !== null && (
                                <span
                                  className="h-[3px] w-8 overflow-hidden rounded-full bg-white/10"
                                  title={`weight ${salience}`}
                                >
                                  <span
                                    className="block h-full rounded-full"
                                    style={{
                                      width: `${Math.round(salience * 100)}%`,
                                      background: color,
                                    }}
                                  />
                                </span>
                              )}
                              <span className="text-[10.5px] text-zinc-600">
                                {c.createdAt ? timeAgo(c.createdAt) : ""}
                              </span>
                            </span>
                          </div>
                          <p className="mt-2 text-[14px] leading-relaxed text-zinc-200">
                            {long && !open ? `${c.text.slice(0, 260)}…` : c.text}
                            {long && (
                              <button
                                onClick={() =>
                                  setExpanded((x) => ({ ...x, [c.id]: !open }))
                                }
                                className="ml-1.5 text-[12px] text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition-colors hover:text-zinc-300"
                              >
                                {open ? "less" : "more"}
                              </button>
                            )}
                          </p>
                          {(entities.length > 0 || hints !== undefined || true) && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              {entities.map((e) => (
                                <span key={e} className="text-[11.5px] text-zinc-500">
                                  ◦ {e}
                                </span>
                              ))}
                              {hints === undefined ? (
                                <button
                                  onClick={() => revealHints(c)}
                                  className="text-[11.5px] text-zinc-600 transition-colors hover:text-indigo-300"
                                >
                                  also answers ›
                                </button>
                              ) : hints.length === 0 ? (
                                <span className="text-[11.5px] text-zinc-700">no hints</span>
                              ) : null}
                            </div>
                          )}
                          {hints !== undefined && hints.length > 0 && (
                            <div className="mt-2 flex flex-col gap-1 border-t border-white/[0.05] pt-2">
                              {hints.map((h, i) => (
                                <p key={i} className="text-[12.5px] italic text-zinc-400">
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
