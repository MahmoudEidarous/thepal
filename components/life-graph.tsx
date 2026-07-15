"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LifeGraph,
  LifeGraphEdge,
  LifeGraphLens,
  LifeGraphNode,
  LifeGraphNodeKind,
} from "@/lib/memory/life-graph";

const W = 1200;
const H = 760;

type PositionedNode = LifeGraphNode & { x: number; y: number; r: number };
type Transform = { x: number; y: number; k: number };

const KIND_STYLE: Record<LifeGraphNodeKind, { color: string; glow: string; label: string }> = {
  user: { color: "#F6D88A", glow: "#F6D88A", label: "you" },
  person: { color: "#F08FB7", glow: "#F08FB7", label: "person" },
  place: { color: "#74D3E9", glow: "#74D3E9", label: "place" },
  project: { color: "#8298FF", glow: "#8298FF", label: "project" },
  routine: { color: "#72D6A4", glow: "#72D6A4", label: "routine" },
  organization: { color: "#C39AF2", glow: "#C39AF2", label: "organization" },
  thing: { color: "#A7AEC2", glow: "#A7AEC2", label: "thing" },
  thread: { color: "#F2B85B", glow: "#F2B85B", label: "life thread" },
  memory: { color: "#B4C1E8", glow: "#8CA4E8", label: "evidence" },
  prospective: { color: "#70D7FF", glow: "#70D7FF", label: "next time" },
  semantic: { color: "#9E89E8", glow: "#9E89E8", label: "semantic neighbor" },
};

const STATUS_COLOR: Record<string, string> = {
  blocked: "#FC9292",
  waiting: "#F2C66D",
  open: "#76C7FF",
  emerging: "#B5A4FF",
  resolved: "#70D6A4",
  dormant: "#72788A",
  conflicting: "#FF8D8D",
  historical: "#7C8294",
  suggested: "#9E89E8",
};

function hash(value: string, salt = 0) {
  let n = 2166136261 ^ salt;
  for (let i = 0; i < value.length; i++) {
    n ^= value.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  return (n >>> 0) / 4294967295;
}

function nodeRadius(node: LifeGraphNode) {
  const base = node.kind === "user" ? 34 : node.kind === "thread" ? 25 : node.kind === "memory" ? 15 : 20;
  return Math.min(38, base + Math.sqrt(Math.max(0, node.importance)) * 2.25);
}

function layoutGraph(graph: LifeGraph): { nodes: PositionedNode[]; edges: LifeGraphEdge[] } {
  const focusId = graph.focus?.id ?? graph.nodes.find((node) => node.kind === "user")?.id ?? graph.nodes[0]?.id;
  const groups: Record<string, number> = {
    person: -1.6,
    project: -0.8,
    thread: 0,
    routine: 0.8,
    place: 1.6,
    organization: 2.2,
    thing: 2.7,
    memory: 3.2,
    prospective: 0.25,
    semantic: 3.8,
    user: -2.6,
  };
  const nodes = graph.nodes.map((node, index) => {
    if (node.id === focusId) return { ...node, x: W / 2, y: H / 2, r: nodeRadius(node) };
    const base = groups[node.kind] ?? 0;
    const angle = base + hash(node.id, 1) * 1.2 - 0.6 + index * 0.07;
    const ring = 150 + (index % 4) * 72 + hash(node.id, 2) * 46;
    return {
      ...node,
      x: W / 2 + Math.cos(angle) * ring,
      y: H / 2 + Math.sin(angle) * ring * 0.72,
      r: nodeRadius(node),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let iteration = 0; iteration < 260; iteration++) {
    const heat = Math.pow(1 - iteration / 260, 1.2);
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const left = nodes[a];
        const right = nodes[b];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const desired = left.r + right.r + 46;
        const force = Math.min(8, (3400 / (distance * distance) + Math.max(0, desired - distance) * 0.13) * heat);
        dx /= distance;
        dy /= distance;
        if (left.id !== focusId) {
          left.x -= dx * force;
          left.y -= dy * force;
        }
        if (right.id !== focusId) {
          right.x += dx * force;
          right.y += dy * force;
        }
      }
    }
    for (const edge of graph.edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = edge.kind === "semantic" ? 210 : edge.kind === "evidence" ? 145 : 175;
      const force = (distance - desired) * 0.018 * Math.max(1, edge.weight) * heat;
      if (source.id !== focusId) {
        source.x += (dx / distance) * force;
        source.y += (dy / distance) * force;
      }
      if (target.id !== focusId) {
        target.x -= (dx / distance) * force;
        target.y -= (dy / distance) * force;
      }
    }
    for (const node of nodes) {
      if (node.id === focusId) continue;
      node.x += (W / 2 - node.x) * 0.004 * heat;
      node.y += (H / 2 - node.y) * 0.004 * heat;
      node.x = Math.max(95, Math.min(W - 95, node.x));
      node.y = Math.max(90, Math.min(H - 90, node.y));
    }
  }
  return { nodes, edges: graph.edges };
}

function shortLabel(node: LifeGraphNode) {
  const limit = node.kind === "memory" || node.kind === "semantic" ? 32 : 24;
  return node.label.length > limit ? `${node.label.slice(0, limit - 1)}…` : node.label;
}

function dateLabel(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(time).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function NodeShape({ node, active }: { node: PositionedNode; active: boolean }) {
  const style = KIND_STYLE[node.kind];
  const status = STATUS_COLOR[node.status] ?? style.color;
  const r = node.r;
  if (node.kind === "user") {
    const p = `${node.x},${node.y - r} ${node.x + r},${node.y} ${node.x},${node.y + r} ${node.x - r},${node.y}`;
    return <polygon points={p} fill={style.color} stroke="#FFF4C8" strokeWidth={active ? 3 : 1.4} />;
  }
  if (node.kind === "thread") {
    const p = Array.from({ length: 6 }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI) / 3;
      return `${node.x + Math.cos(angle) * r},${node.y + Math.sin(angle) * r}`;
    }).join(" ");
    return <polygon points={p} fill={`${status}D9`} stroke={status} strokeWidth={active ? 3 : 1.5} />;
  }
  if (node.kind === "project" || node.kind === "organization") {
    return (
      <rect
        x={node.x - r}
        y={node.y - r}
        width={r * 2}
        height={r * 2}
        rx={node.kind === "project" ? 9 : r}
        fill={`${style.color}D9`}
        stroke={status}
        strokeWidth={active ? 3 : 1.4}
      />
    );
  }
  if (node.kind === "semantic") {
    return (
      <circle
        cx={node.x}
        cy={node.y}
        r={r}
        fill={`${style.color}13`}
        stroke={style.color}
        strokeWidth={active ? 2.5 : 1.4}
        strokeDasharray="4 4"
      />
    );
  }
  if (node.kind === "memory") {
    return (
      <rect
        x={node.x - r * 0.72}
        y={node.y - r * 0.72}
        width={r * 1.44}
        height={r * 1.44}
        rx="4"
        transform={`rotate(45 ${node.x} ${node.y})`}
        fill={`${style.color}B8`}
        stroke={status}
        strokeWidth={active ? 2.5 : 1.2}
      />
    );
  }
  return (
    <circle
      cx={node.x}
      cy={node.y}
      r={r}
      fill={`${style.color}${node.kind === "prospective" ? "2B" : "D6"}`}
      stroke={status}
      strokeWidth={active ? 3 : node.kind === "prospective" ? 2.2 : 1.4}
      strokeDasharray={node.kind === "prospective" ? "2 4" : undefined}
    />
  );
}

function DetailPanel({
  node,
  onClose,
  onFocus,
}: {
  node: LifeGraphNode;
  onClose: () => void;
  onFocus: (node: LifeGraphNode) => void;
}) {
  const style = KIND_STYLE[node.kind];
  const canFocus = !["memory", "prospective"].includes(node.kind);
  return (
    <aside className="glass animate-rise absolute bottom-4 right-4 top-[166px] z-30 flex w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-[28px] max-md:bottom-3 max-md:left-3 max-md:right-3 max-md:top-auto max-md:max-h-[58vh] max-md:w-auto">
      <div className="border-b border-white/[0.07] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-500">
              <span className="size-1.5 rounded-full" style={{ background: style.color, boxShadow: `0 0 10px ${style.glow}` }} />
              {node.eyebrow}
              <span className="text-zinc-700">·</span>
              <span style={{ color: STATUS_COLOR[node.status] ?? "#9298A9" }}>{node.status}</span>
            </p>
            <h2 className="mt-2 text-balance text-[21px] font-light leading-tight tracking-[-0.02em] text-zinc-50">
              {node.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/[0.08] text-[12px] text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-500">{node.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {node.confidence && (
            <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-zinc-400">
              {node.confidence}
            </span>
          )}
          <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-zinc-500">
            {node.evidenceCount} evidence
          </span>
          {canFocus && (
            <button
              type="button"
              onClick={() => onFocus(node)}
              className="ml-auto rounded-full border border-indigo-300/15 bg-indigo-300/[0.07] px-3 py-1 text-[10px] font-medium text-indigo-100/80 transition-colors hover:bg-indigo-300/[0.13]"
            >
              center here →
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {node.detail.note && (
          <div className="rounded-2xl border border-violet-300/[0.12] bg-violet-300/[0.045] px-3.5 py-3 text-[12px] leading-relaxed text-violet-100/65">
            {node.detail.note}
          </div>
        )}

        {node.detail.threads.length > 0 && (
          <section>
            <p className="mb-2.5 font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-600">in motion</p>
            <div className="space-y-2">
              {node.detail.threads.map((thread) => (
                <div key={thread.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[thread.status] ?? "#8C93A5" }} />
                    <p className="text-[12.5px] font-medium text-zinc-200">{thread.title}</p>
                    <span className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.12em] text-zinc-600">{thread.status}</span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500">{thread.state}</p>
                  {thread.expectedNext && (
                    <p className="mt-2 border-l border-amber-200/25 pl-2.5 text-[11px] leading-relaxed text-amber-100/55">
                      next · {thread.expectedNext}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {node.detail.facts.length > 0 && (
          <section>
            <p className="mb-2.5 font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-600">what Recall currently believes</p>
            <div className="divide-y divide-white/[0.055]">
              {node.detail.facts.map((fact) => (
                <div key={fact.key} className="py-2.5 first:pt-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.15em] text-zinc-600">{fact.predicate}</p>
                    {fact.status !== "current" && (
                      <span className="rounded-full px-1.5 py-0.5 font-mono text-[7.5px] uppercase tracking-[0.1em]" style={{ color: STATUS_COLOR[fact.status] ?? "#9298A9", background: `${STATUS_COLOR[fact.status] ?? "#9298A9"}12` }}>
                        {fact.status}
                      </span>
                    )}
                    <span className="ml-auto text-[9px] text-zinc-700">{fact.evidenceCount} source{fact.evidenceCount === 1 ? "" : "s"}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-300">{fact.value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {node.detail.evidence.length > 0 && (
          <section>
            <p className="mb-2.5 font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-600">evidence trail</p>
            <div className="relative space-y-3 border-l border-white/[0.08] pl-4">
              {node.detail.evidence.map((evidence) => (
                <article key={evidence.id} className="relative">
                  <span className="absolute -left-[18px] top-[5px] size-[5px] rounded-full bg-zinc-500 ring-4 ring-[#111117]" />
                  <p className="text-[11.5px] leading-relaxed text-zinc-400">{evidence.content}</p>
                  <p className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.12em] text-zinc-700">
                    {dateLabel(evidence.recordedAt)} · {evidence.trust.replaceAll("_", " ")} · {evidence.source}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-3 font-mono text-[8.5px] uppercase tracking-[0.16em] text-zinc-700">
        <span>{node.kind === "semantic" ? "discovery, not truth" : "evidence-backed"}</span>
        <span>{KIND_STYLE[node.kind].label}</span>
      </div>
    </aside>
  );
}

export function LifeGraphView({ name, onCount }: { name: string; onCount?: (count: number) => void }) {
  const [graph, setGraph] = useState<LifeGraph | null>(null);
  const [focus, setFocus] = useState("");
  const [query, setQuery] = useState("");
  const [lens, setLens] = useState<LifeGraphLens>("current");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showSemantic, setShowSemantic] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [history, setHistory] = useState<string[]>([]);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ lens, limit: "48" });
    if (focus) params.set("focus", focus);
    fetch(`/api/memory/graph?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "graph unavailable");
        return response.json() as Promise<LifeGraph>;
      })
      .then((next) => {
        const named = {
          ...next,
          nodes: next.nodes.map((node) => (node.kind === "user" ? { ...node, label: name } : node)),
        };
        setGraph(named);
        setSelectedId(next.focus?.id ?? null);
        setTransform({ x: 0, y: 0, k: 1 });
        onCount?.(next.summary.totalEntities);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "graph unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [focus, lens, name, onCount, reload]);

  const visibleGraph = useMemo(() => {
    if (!graph) return null;
    if (showSemantic) return graph;
    const nodes = graph.nodes.filter((node) => node.kind !== "semantic");
    const ids = new Set(nodes.map((node) => node.id));
    return { ...graph, nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
  }, [graph, showSemantic]);
  const layout = useMemo(() => (visibleGraph ? layoutGraph(visibleGraph) : null), [visibleGraph]);
  const byId = useMemo(() => new Map(layout?.nodes.map((node) => [node.id, node]) ?? []), [layout]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const connected = useMemo(() => {
    const ids = new Set<string>();
    if (!hoveredId || !layout) return ids;
    ids.add(hoveredId);
    for (const edge of layout.edges) {
      if (edge.source === hoveredId) ids.add(edge.target);
      if (edge.target === hoveredId) ids.add(edge.source);
    }
    return ids;
  }, [hoveredId, layout]);

  const navigate = useCallback(
    (nextFocus: string) => {
      if (nextFocus === focus) return;
      setRefreshing(true);
      setError(null);
      setHistory((current) => [...current, focus].slice(-12));
      setFocus(nextFocus);
      setQuery("");
    },
    [focus],
  );

  const goBack = () => {
    setRefreshing(true);
    setError(null);
    setHistory((current) => {
      if (!current.length) {
        setFocus("");
        return [];
      }
      const next = current.slice();
      setFocus(next.pop() ?? "");
      return next;
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (next) navigate(next);
  };

  const wheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const next = Math.max(0.58, Math.min(2.25, transform.k * Math.exp(-event.deltaY * 0.0012)));
    setTransform((current) => ({ ...current, k: next }));
  };

  return (
    <div className="absolute inset-0 overflow-hidden pt-[72px]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_50%_52%,rgba(92,106,255,0.095),transparent_72%)]" />

      <div className="absolute inset-x-0 top-[82px] z-20 mx-auto flex w-[min(1180px,calc(100vw-32px))] flex-col gap-3">
        <div className="flex items-center gap-2.5 max-md:flex-wrap">
          <div className="glass-chip flex h-11 items-center rounded-full p-1">
            <button
              type="button"
              onClick={goBack}
              disabled={!focus && !history.length}
              aria-label="Back in graph history"
              className="grid size-8 place-items-center rounded-full text-[14px] text-zinc-500 transition-colors enabled:hover:bg-white/[0.07] enabled:hover:text-white disabled:opacity-20"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => {
                if (!focus) return;
                setRefreshing(true);
                setError(null);
                setHistory((current) => [...current, focus].slice(-12));
                setFocus("");
              }}
              className="hidden rounded-full px-2.5 py-1 text-[10.5px] text-zinc-500 transition-colors hover:text-zinc-100 sm:block"
            >
              whole life
            </button>
          </div>

          <form onSubmit={submit} className="glass relative flex h-11 min-w-[260px] flex-1 items-center rounded-full px-4 md:max-w-[500px]">
            <span aria-hidden className="mr-2.5 text-[13px] text-zinc-600">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="person, place, project, memory…"
              aria-label="Search the life graph"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
            />
            {query && (
              <button type="submit" className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] text-zinc-300 transition-colors hover:bg-white/[0.13]">
                explore
              </button>
            )}
          </form>

          <div className="glass-chip ml-auto flex h-11 items-center rounded-full p-1 max-md:ml-0">
            {(["current", "history", "all"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  if (lens === value) return;
                  setRefreshing(true);
                  setError(null);
                  setLens(value);
                }}
                className={`rounded-full px-3 py-2 text-[10.5px] font-medium transition-all ${lens === value ? "bg-white/[0.1] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" : "text-zinc-600 hover:text-zinc-300"}`}
              >
                {value === "all" ? "both" : value}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 px-1 max-md:hidden">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-600">life graph</p>
              {refreshing && <span className="size-1.5 animate-pulse rounded-full bg-indigo-300" />}
            </div>
            <h1 className="mt-1 text-[22px] font-light tracking-[-0.025em] text-zinc-100">{graph?.title ?? "Opening your memory…"}</h1>
            <p className="mt-0.5 max-w-2xl text-[11.5px] text-zinc-600">{graph?.subtitle}</p>
          </div>
          {graph && (
            <div className="flex items-center gap-4 pt-1 font-mono text-[8.5px] uppercase tracking-[0.16em] text-zinc-700">
              <span><b className="font-medium text-zinc-500">{graph.summary.totalEntities}</b> entities</span>
              <span><b className="font-medium text-zinc-500">{graph.summary.activeThreads}</b> live threads</span>
              <span><b className="font-medium text-zinc-500">{graph.summary.evidenceEvents}</b> evidence</span>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <div className="absolute inset-0 grid place-items-center pt-24">
          <div className="glass rounded-3xl px-7 py-6 text-center">
            <p className="text-[14px] text-zinc-300">The graph couldn&apos;t open.</p>
            <p className="mt-1 text-[11px] text-zinc-600">{error}</p>
            <button type="button" onClick={() => { setRefreshing(true); setError(null); setReload((value) => value + 1); }} className="mt-4 rounded-full bg-white/[0.07] px-4 py-2 text-[11px] text-zinc-300">try again</button>
          </div>
        </div>
      ) : !layout ? (
        <div className="absolute inset-0 grid place-items-center pt-24">
          <div className="flex flex-col items-center gap-3">
            <span className="size-9 animate-pulse rotate-45 rounded-[9px] bg-amber-100/80 shadow-[0_0_45px_8px_rgba(253,230,138,0.25)]" />
            <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-700">assembling what matters</p>
          </div>
        </div>
      ) : (
        <svg
          className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          onWheel={wheel}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, ox: transform.x, oy: transform.y };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const scale = W / event.currentTarget.getBoundingClientRect().width;
            setTransform((current) => ({ ...current, x: drag.current!.ox + (event.clientX - drag.current!.x) * scale, y: drag.current!.oy + (event.clientY - drag.current!.y) * scale }));
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onClick={() => setSelectedId(null)}
          aria-label="Interactive life graph. Use the search or tab through nodes."
        >
          <defs>
            <filter id="life-node-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="edge-fade" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#A9B5E7" stopOpacity=".08" /><stop offset=".5" stopColor="#A9B5E7" stopOpacity=".36" /><stop offset="1" stopColor="#A9B5E7" stopOpacity=".08" /></linearGradient>
          </defs>
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {[140, 270, 410].map((radius) => (
              <circle key={radius} cx={W / 2} cy={H / 2} r={radius} fill="none" stroke="rgba(255,255,255,.028)" strokeWidth="1" strokeDasharray="1 9" />
            ))}
            {layout.edges.map((edge) => {
              const source = byId.get(edge.source);
              const target = byId.get(edge.target);
              if (!source || !target) return null;
              const active = hoveredId ? edge.source === hoveredId || edge.target === hoveredId : selectedId ? edge.source === selectedId || edge.target === selectedId : false;
              const showLabel = Boolean(hoveredId && active);
              const dim = hoveredId && !active;
              const color = edge.authority === "semantic" ? "#9E89E8" : edge.status === "conflicting" ? "#FF8D8D" : edge.kind === "thread" ? "#F2B85B" : "#9EACDF";
              const mx = (source.x + target.x) / 2;
              const my = (source.y + target.y) / 2;
              return (
                <g key={edge.id} opacity={dim ? 0.07 : active ? 0.9 : edge.authority === "semantic" ? 0.26 : 0.34} className="transition-opacity duration-200">
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={color} strokeWidth={active ? 2.1 : Math.max(0.8, Math.min(1.8, edge.weight * 0.45))} strokeDasharray={edge.authority === "semantic" || edge.status === "historical" ? "5 7" : undefined} />
                  {showLabel && (
                    <g transform={`translate(${mx} ${my})`}>
                      <rect x={-Math.max(28, edge.label.length * 3.4)} y="-9" width={Math.max(56, edge.label.length * 6.8)} height="18" rx="9" fill="rgba(10,10,15,.92)" stroke="rgba(255,255,255,.1)" />
                      <text textAnchor="middle" dominantBaseline="middle" fill="#C7CAD5" fontSize="8.5" fontFamily="var(--font-geist-mono)">{edge.label}</text>
                    </g>
                  )}
                </g>
              );
            })}
            {layout.nodes.map((node, index) => {
              const selectedNode = selectedId === node.id;
              const active = selectedNode || hoveredId === node.id;
              const dim = hoveredId ? !connected.has(node.id) : false;
              const style = KIND_STYLE[node.kind];
              const displayLabel = node.kind === "user" ? name : shortLabel(node);
              return (
                <g
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${style.label}: ${node.label}`}
                  className="cursor-pointer outline-none transition-opacity duration-200"
                  opacity={dim ? 0.16 : 1}
                  style={{ animationDelay: `${Math.min(index * 24, 360)}ms` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(node.id); }}
                  onDoubleClick={(event) => { event.stopPropagation(); if (!["memory", "prospective"].includes(node.kind)) navigate(node.kind === "semantic" ? node.label : node.id); }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(node.id); }
                  }}
                >
                  <circle cx={node.x} cy={node.y} r={node.r + (active ? 11 : 7)} fill={style.glow} opacity={active ? 0.13 : 0.045} filter={active ? "url(#life-node-glow)" : undefined} />
                  <NodeShape node={node} active={active} />
                  {node.kind === "thread" && <circle cx={node.x} cy={node.y} r="3.5" fill="#FFF4D2" opacity=".9" />}
                  {node.kind === "prospective" && <circle cx={node.x} cy={node.y} r="4" fill={style.color} />}
                  <text x={node.x} y={node.y + node.r + 17} textAnchor="middle" fill={active ? "#F6F6F8" : "#B0B3C0"} opacity={(node.kind === "memory" || node.kind === "semantic") && !active ? 0 : 1} fontSize={node.kind === "user" ? 10 : 9} fontWeight={node.kind === "user" ? 600 : 450} letterSpacing={node.kind === "user" ? "2.2" : ".45"} fontFamily="var(--font-geist-mono)" paintOrder="stroke" stroke="rgba(9,9,13,.95)" strokeWidth="4" strokeLinejoin="round" className="transition-opacity duration-200">
                    {displayLabel.toUpperCase()}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {graph && (
        <div className="glass-chip absolute bottom-4 left-4 z-20 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-2xl px-3 py-2.5 max-md:hidden">
          <div className="flex items-center gap-2 border-r border-white/[0.07] pr-3">
            <span className="h-px w-6 bg-indigo-200/60" />
            <span className="text-[9.5px] text-zinc-500">canonical</span>
          </div>
          <button type="button" onClick={() => setShowSemantic((value) => !value)} className={`flex items-center gap-2 text-[9.5px] transition-colors ${showSemantic ? "text-violet-200/70" : "text-zinc-700"}`}>
            <span className="w-6 border-t border-dashed border-violet-300/60" />
            Supermemory discovery
            <span className={`grid size-3.5 place-items-center rounded border text-[8px] ${showSemantic ? "border-violet-300/30 bg-violet-300/10" : "border-white/[0.08]"}`}>{showSemantic ? "✓" : ""}</span>
          </button>
          <div className="flex items-center gap-1 border-l border-white/[0.07] pl-3">
            <button type="button" onClick={() => setTransform((value) => ({ ...value, k: Math.min(2.25, value.k * 1.2) }))} aria-label="Zoom in" className="grid size-6 place-items-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-white">+</button>
            <button type="button" onClick={() => setTransform((value) => ({ ...value, k: Math.max(0.58, value.k / 1.2) }))} aria-label="Zoom out" className="grid size-6 place-items-center rounded-full text-zinc-500 hover:bg-white/[0.06] hover:text-white">−</button>
            <button type="button" onClick={() => setTransform({ x: 0, y: 0, k: 1 })} className="rounded-full px-2 py-1 text-[9px] text-zinc-600 hover:text-zinc-200">fit</button>
          </div>
        </div>
      )}

      {graph && !focus && graph.suggestions.length > 0 && (
        <div className="absolute bottom-20 left-4 z-20 flex max-w-[420px] flex-wrap gap-1.5 max-lg:hidden">
          <span className="mr-1 self-center font-mono text-[8px] uppercase tracking-[0.18em] text-zinc-700">open next</span>
          {graph.suggestions.slice(0, 4).map((suggestion) => (
            <button key={suggestion.id} type="button" onClick={() => navigate(suggestion.id)} title={suggestion.reason} className="rounded-full border border-white/[0.07] bg-black/35 px-2.5 py-1.5 text-[9.5px] text-zinc-500 backdrop-blur-sm transition-all hover:border-white/[0.15] hover:text-zinc-200">
              {suggestion.label}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <DetailPanel
          node={selected}
          onClose={() => setSelectedId(null)}
          onFocus={(node) => navigate(node.kind === "semantic" ? node.label : node.id)}
        />
      )}
    </div>
  );
}
