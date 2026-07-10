"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Dust, GRAIN } from "@/components/atmosphere";
import { timeAgo } from "@/lib/format";

type Entry = {
  id: string;
  memory: string;
  version: number;
  isStatic: boolean;
  isInference: boolean;
  updatedAt: string;
  memoryRelations: Record<string, string>;
  history: Array<{ id: string; memory: string; version: number; createdAt: string }>;
};

type Node = Entry & {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  degree: number;
};

const STOP = new Set(
  "the a an is are was were to of in on for and or at with from by has have had will would that this his her their my its user user's currently recently".split(
    " ",
  ),
);

// A name for the star: prefer proper nouns, fall back to content words.
function nodeLabel(text: string): string {
  const tokens = text.replace(/[^\w\s'&-]/g, " ").split(/\s+/).filter(Boolean);
  const proper = tokens.filter(
    (w, i) => i > 0 && /^[A-Z0-9]/.test(w) && !STOP.has(w.toLowerCase()),
  );
  const content = tokens.filter((w) => !STOP.has(w.toLowerCase()));
  const pick = (proper.length ? proper : content).slice(0, 2).join(" ");
  return (pick || text.slice(0, 14)).toUpperCase();
}

function color(e: Entry): string {
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

// The whole graph settles in a synchronous force simulation — ~60 nodes,
// a few hundred iterations, well under a frame's budget. Deterministic:
// same memories, same sky.
function layout(entries: Entry[], w: number, h: number) {
  const nodes = entries.slice(0, 60).map((e, i) => {
    const deg = 0; // filled below
    const a = i * 2.399963 + jitter(e.id) * 0.8;
    const r0 = 90 + 26 * Math.sqrt(i + 1) + jitter(e.id, 3) * 40;
    return {
      ...e,
      x: Math.cos(a) * r0,
      y: Math.sin(a) * r0,
      r: 0,
      color: color(e),
      label: nodeLabel(e.memory),
      degree: deg,
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
    n.r = 11 + Math.min(14, n.degree * 4 + (n.history.length > 0 ? 3 : 0) + (n.isStatic ? 2 : 0));
  });

  // the center of the sky is you: stable identity facts anchor to it
  const anchors = nodes.filter((n) => n.isStatic);

  for (let iter = 0; iter < 380; iter++) {
    const heat = 1 - iter / 380;
    // pairwise repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        const min = a.r + b.r + 62;
        const f = Math.min(6, (2400 / d2) * heat + (d < min ? (min - d) * 0.12 : 0));
        dx /= d;
        dy /= d;
        a.x += dx * f;
        a.y += dy * f;
        b.x -= dx * f;
        b.y -= dy * f;
      }
    }
    // springs
    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - 150) * 0.02 * heat;
      e.a.x += (dx / d) * f;
      e.a.y += (dy / d) * f;
      e.b.x -= (dx / d) * f;
      e.b.y -= (dy / d) * f;
    }
    // identity anchors lean toward the center; everyone drifts in gently
    for (const n of nodes) {
      const g = anchors.includes(n) ? 0.03 : 0.008;
      n.x -= n.x * g * heat;
      n.y -= n.y * g * heat;
    }
  }

  // fit to viewport
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(0, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const scale = Math.min(
    (w - 200) / Math.max(1, maxX - minX),
    (h - 220) / Math.max(1, maxY - minY),
    1.15,
  );
  const cx = w / 2 - ((minX + maxX) / 2) * scale;
  const cy = h / 2 - ((minY + maxY) / 2) * scale;
  nodes.forEach((n) => {
    n.x = n.x * scale + cx;
    n.y = n.y * scale + cy;
  });
  return { nodes, edges, center: { x: cx, y: cy } };
}

export default function Brain() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Node | null>(null);
  const [name, setName] = useState<string>("YOU");
  const [box, setBox] = useState({ w: 1280, h: 800 });

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

  const { nodes, edges, center } = useMemo(
    () => layout(entries, box.w, box.h),
    [entries, box],
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
          <span className="ml-3 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
            the brain
          </span>
        </Link>
        <div className="glass-chip flex items-center gap-2 rounded-full px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
          {entries.length} memories
        </div>
      </header>

      {/* edges */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.a.x}
            y1={e.a.y}
            x2={e.b.x}
            y2={e.b.y}
            stroke={e.kind === "updates" ? "rgba(244,114,140,0.34)" : "rgba(150,163,255,0.26)"}
            strokeWidth="1.2"
          />
        ))}
        {/* identity anchors thread back to you */}
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
          <span className="font-mono text-[11px] tracking-[0.3em] text-amber-100/90">{name}</span>
        </div>
      </div>

      {/* the memories */}
      {nodes.map((n) => {
        const isSel = selected?.id === n.id;
        return (
          <button
            key={n.id}
            onClick={(ev) => {
              ev.stopPropagation();
              setSelected(isSel ? null : n);
            }}
            className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 outline-none"
            style={{ left: n.x, top: n.y }}
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

      {/* memory detail */}
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
                style={{ background: selected.color, boxShadow: `0 0 10px 1px ${selected.color}66` }}
              />
              {selected.isInference ? "inferred" : selected.isStatic ? "identity" : selected.history.length ? "evolved" : "memory"}
              {selected.version > 1 ? ` · v${selected.version}` : ""} · {timeAgo(selected.updatedAt)}
            </p>
            <button
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="-mr-1 -mt-1 px-1 text-[13px] leading-none text-zinc-500 transition-colors hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
          <p className="mt-3 text-[14.5px] leading-relaxed text-zinc-100">{selected.memory}</p>
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

      {/* legend */}
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
    </div>
  );
}
