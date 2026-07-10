"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type MemoryEntry = {
  id: string;
  memory: string;
  version: number;
  isStatic: boolean;
  isInference: boolean;
  createdAt: string;
  updatedAt: string;
  memoryRelations: Record<string, string>;
  history: Array<{ id: string; memory: string; version: number; createdAt: string }>;
};

export type ProcessingDoc = {
  id: string;
  status?: string | null;
  title?: string | null;
  content?: string | null;
  createdAt?: string;
};

type Node = MemoryEntry & {
  x: number;
  y: number;
  size: number;
  color: string;
  depth: number; // 0 far … 1 near
  degree: number; // how many relations touch this memory
};

const GOLDEN = 2.399963229728653;

// Deterministic per-id jitter so the sky doesn't reshuffle on every poll.
function jitter(id: string, salt = 0): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

export function memoryColor(e: MemoryEntry): string {
  if (e.isInference) return "#B48CFF";
  if (e.history.length > 0) return "#8FB0FF";
  if (e.isStatic) return "#E8ECF8";
  return "#6D8DFF";
}

// The user's memories as a night sky around the orb. Stars only — the words
// appear when you reach for one. The most connected memories burn brightest
// (Orrery-style); engine relations draw the filaments; new memories
// materialize out of the orb and drift to their place.
export function Constellation({
  entries,
  processing,
  selectedId,
  onSelect,
}: {
  entries: MemoryEntry[];
  processing: ProcessingDoc[];
  selectedId: string | null;
  onSelect: (e: MemoryEntry | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the sky leans gently toward the pointer
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", String(((e.clientX - r.left) / r.width - 0.5) * 2));
      el.style.setProperty("--my", String(((e.clientY - r.top) / r.height - 0.5) * 2));
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // relation degree — the gravity of a memory
  const degree = useMemo(() => {
    const m = new Map<string, number>();
    entries.forEach((e) =>
      Object.keys(e.memoryRelations ?? {}).forEach((t) => {
        m.set(e.id, (m.get(e.id) ?? 0) + 1);
        m.set(t, (m.get(t) ?? 0) + 1);
      }),
    );
    return m;
  }, [entries]);

  const nodes = useMemo<Node[]>(() => {
    const cx = box.w / 2;
    const cy = box.h * 0.44;
    const base = Math.min(box.w, box.h) * 0.32;
    const step = Math.min(box.w, box.h) * 0.05;
    const maxR = { x: box.w / 2 - 70, y: box.h / 2 - 60 };

    return entries.slice(0, 42).map((e, i) => {
      const j = jitter(e.id);
      const depth = jitter(e.id, 7); // fixed per memory — parallax layer
      const deg = degree.get(e.id) ?? 0;
      const angle = i * GOLDEN + j * 0.9;
      let r = base + Math.sqrt(i + 0.6) * step + j * 20;
      let x = Math.cos(angle) * r * 1.3;
      let y = Math.sin(angle) * r * 0.78;
      // pull back inside the viewport, keep the shape organic
      while ((Math.abs(x) > maxR.x || Math.abs(y) > maxR.y) && r > base * 0.7) {
        r *= 0.93;
        x = Math.cos(angle) * r * 1.3;
        y = Math.sin(angle) * r * 0.78;
      }
      // captions and controls own the lower-center band — reflect
      // any star that lands there to the upper hemisphere, fanned outward
      let py = cy + y;
      if (py > box.h * 0.56 && Math.abs(x) < box.w * 0.3) {
        py = Math.max(64 + j * 56, 2 * cy - py - 30);
        x = x * 1.6 + (j - 0.5) * 160;
      }
      return {
        ...e,
        x: cx + x,
        y: py,
        size: 3 + Math.min(3.5, deg * 1.1 + (e.history.length > 0 ? 0.8 : 0)) + depth * 1.2,
        color: memoryColor(e),
        depth,
        degree: deg,
      };
    });
  }, [entries, box, degree]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const edges = useMemo(() => {
    const out: Array<{ from: Node; to: Node }> = [];
    nodes.forEach((n) => {
      Object.keys(n.memoryRelations ?? {}).forEach((target) => {
        const t = byId.get(target);
        if (t) out.push({ from: n, to: t });
      });
    });
    return out;
  }, [nodes, byId]);

  const cx = box.w / 2;
  const cy = box.h * 0.44;

  return (
    <div ref={ref} className="absolute inset-0" onClick={() => onSelect(null)}>
      {/* everything in the sky leans with the pointer as one layer,
          so filaments never detach from their stars */}
      <div
        className="absolute inset-0 transition-transform duration-700 ease-out"
        style={{ transform: "translate(calc(var(--mx, 0) * 9px), calc(var(--my, 0) * 7px))" }}
      >
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            {edges.map((e, i) => (
              <linearGradient
                key={i}
                id={`fil-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={e.from.x}
                y1={e.from.y}
                x2={e.to.x}
                y2={e.to.y}
              >
                <stop offset="0" stopColor="rgba(150,163,255,0)" />
                <stop offset="0.5" stopColor="rgba(150,163,255,0.28)" />
                <stop offset="1" stopColor="rgba(150,163,255,0)" />
              </linearGradient>
            ))}
          </defs>
          {edges.map((e, i) => {
            const mx = (e.from.x + e.to.x) / 2;
            const my = (e.from.y + e.to.y) / 2;
            const dx = e.to.x - e.from.x;
            const dy = e.to.y - e.from.y;
            const len = Math.hypot(dx, dy) || 1;
            const bend = (i % 2 ? 1 : -1) * Math.min(18, len * 0.1);
            return (
              <path
                key={i}
                d={`M ${e.from.x} ${e.from.y} Q ${mx - (dy / len) * bend} ${
                  my + (dx / len) * bend
                } ${e.to.x} ${e.to.y}`}
                fill="none"
                stroke={`url(#fil-${i})`}
                strokeWidth="1"
                className="animate-edge"
              />
            );
          })}
        </svg>

        {/* documents still being extracted — embryos near the orb */}
        {processing.map((d, i) => {
          const a = i * 2.1 + 0.6;
          const x = cx + Math.cos(a) * (box.h * 0.24) * 1.25;
          const y = cy + Math.sin(a) * (box.h * 0.24) * 0.75;
          return (
            <div
              key={d.id}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: x, top: y }}
            >
              <span className="block size-[7px] animate-pulse rounded-full bg-amber-300/80 shadow-[0_0_14px_2px_rgb(252_211_77/0.35)]" />
            </div>
          );
        })}

        {nodes.map((n) => {
          const selected = n.id === selectedId;
          const bright = Math.min(
            0.95,
            0.5 + Math.min(0.3, n.degree * 0.1) + n.depth * 0.15,
          );
          return (
            <button
              key={n.id}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelect(selected ? null : n);
              }}
              aria-label={n.memory}
              className="group absolute z-10 -m-3 -translate-x-1/2 -translate-y-1/2 p-3 outline-none"
              style={
                {
                  left: n.x,
                  top: n.y,
                  "--fx": `${cx - n.x}px`,
                  "--fy": `${cy - n.y}px`,
                } as React.CSSProperties
              }
            >
              <span className="node-in block">
                <span
                  className="star-drift relative block"
                  style={{
                    animationDuration: `${14 + n.depth * 14}s`,
                    animationDelay: `${-jitter(n.id, 3) * 20}s`,
                    ["--dx" as string]: `${(jitter(n.id, 5) - 0.5) * 14}px`,
                    ["--dy" as string]: `${(jitter(n.id, 9) - 0.5) * 18}px`,
                  }}
                >
                  <span
                    className={
                      "star-twinkle block rounded-full transition-all duration-300 group-hover:scale-[1.7] group-focus-visible:scale-[1.7] " +
                      (selected ? "scale-[1.7]" : "")
                    }
                    style={{
                      width: n.size,
                      height: n.size,
                      background: n.color,
                      animationDuration: `${4 + jitter(n.id, 11) * 5}s`,
                      animationDelay: `${-jitter(n.id, 13) * 8}s`,
                      ["--tw-base" as string]: selected ? 1 : bright,
                      filter: n.depth < 0.3 ? "blur(0.5px)" : undefined,
                      boxShadow: `0 0 ${n.size * 2}px ${n.size * 0.4}px ${n.color}55, 0 0 ${
                        selected ? 30 : n.size * 6
                      }px ${n.size * 1.6}px ${n.color}${selected ? "44" : "1e"}`,
                    }}
                  >
                    {n.degree >= 2 && <span className="star-flare" aria-hidden />}
                  </span>
                </span>
              </span>
              {/* the word, only when you reach for the star */}
              <span
                className={
                  "glass-chip pointer-events-none absolute left-1/2 top-full z-20 mt-1 max-w-[280px] -translate-x-1/2 truncate whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11px] tracking-[0.01em] text-zinc-200 transition-all duration-200 " +
                  (selected
                    ? "translate-y-0 opacity-100"
                    : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100")
                }
              >
                {n.memory}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
