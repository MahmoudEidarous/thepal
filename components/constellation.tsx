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

type Node = MemoryEntry & { x: number; y: number; size: number; color: string };

const GOLDEN = 2.399963229728653;

// Deterministic per-id jitter so the sky doesn't reshuffle on every poll.
function jitter(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

function color(e: MemoryEntry): string {
  if (e.isInference) return "#B48CFF";
  if (e.history.length > 0) return "#8FB0FF";
  if (e.isStatic) return "#E8ECF8";
  return "#6D8DFF";
}

// The user's memories as a constellation around the orb — Obsidian's
// graph view, but ambient. Newest memories orbit closest; engine
// relations (updates / extends / derives) draw the lines. New nodes
// materialize from the orb's position and drift out to their place.
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

  const nodes = useMemo<Node[]>(() => {
    const cx = box.w / 2;
    const cy = box.h * 0.44;
    const base = Math.min(box.w, box.h) * 0.3;
    const step = Math.min(box.w, box.h) * 0.052;
    const maxR = { x: box.w / 2 - 90, y: box.h / 2 - 70 };

    return entries.slice(0, 42).map((e, i) => {
      const j = jitter(e.id);
      const angle = i * GOLDEN + j * 0.9;
      let r = base + Math.sqrt(i + 0.6) * step + j * 18;
      let x = Math.cos(angle) * r * 1.28;
      let y = Math.sin(angle) * r * 0.8;
      // pull back inside the viewport, keep the shape organic
      while ((Math.abs(x) > maxR.x || Math.abs(y) > maxR.y) && r > base * 0.7) {
        r *= 0.93;
        x = Math.cos(angle) * r * 1.28;
        y = Math.sin(angle) * r * 0.8;
      }
      // captions and controls own the lower-center band — reflect
      // any node that lands there to the upper hemisphere, fanned outward
      let py = cy + y;
      if (py > box.h * 0.56 && Math.abs(x) < box.w * 0.32) {
        py = Math.max(72 + j * 56, 2 * cy - py - 30);
        x = x * 1.6 + (j - 0.5) * 160;
      }
      return {
        ...e,
        x: cx + x,
        y: py,
        size: e.history.length > 0 ? 9 : e.isStatic ? 7 : 6,
        color: color(e),
      };
    });
  }, [entries, box]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const edges = useMemo(() => {
    const out: Array<{ from: Node; to: Node; kind: string }> = [];
    nodes.forEach((n) => {
      Object.entries(n.memoryRelations ?? {}).forEach(([target, kind]) => {
        const t = byId.get(target);
        if (t) out.push({ from: n, to: t, kind });
      });
    });
    return out;
  }, [nodes, byId]);

  const cx = box.w / 2;
  const cy = box.h * 0.44;

  return (
    <div ref={ref} className="absolute inset-0" onClick={() => onSelect(null)}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.from.x}
            y1={e.from.y}
            x2={e.to.x}
            y2={e.to.y}
            stroke="rgba(129,148,255,0.16)"
            strokeWidth="1"
            className="animate-edge"
          />
        ))}
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
        return (
          <button
            key={n.id}
            onClick={(ev) => {
              ev.stopPropagation();
              onSelect(selected ? null : n);
            }}
            className="group absolute -translate-x-1/2 -translate-y-1/2 outline-none"
            style={
              {
                left: n.x,
                top: n.y,
                "--fx": `${cx - n.x}px`,
                "--fy": `${cy - n.y}px`,
              } as React.CSSProperties
            }
          >
            <span className="node-in flex flex-col items-center gap-2">
              <span
                className={
                  "block rounded-full transition-all duration-300 group-hover:scale-150 " +
                  (selected ? "scale-150" : "")
                }
                style={{
                  width: n.size,
                  height: n.size,
                  background: n.color,
                  boxShadow: `0 0 ${selected ? 22 : 12}px ${selected ? 3 : 1}px ${n.color}55`,
                }}
              />
              <span
                className={
                  "max-w-[150px] truncate text-[10.5px] leading-tight transition-colors duration-300 " +
                  (selected
                    ? "text-zinc-200"
                    : "text-zinc-600 group-hover:text-zinc-300")
                }
              >
                {n.memory}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
