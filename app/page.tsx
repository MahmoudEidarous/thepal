"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoicePanel } from "@/components/voice-panel";
import {
  Constellation,
  memoryColor,
  type MemoryEntry,
  type ProcessingDoc,
} from "@/components/constellation";
import { DreamPopover } from "@/components/dream-popover";
import { timeAgo } from "@/lib/format";

type Engine = "online" | "offline" | "checking";

// grain: tiny tile of monochrome turbulence, blended over everything
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A field of distant dust behind the constellation — pure depth, no meaning.
function Dust() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const rnd = mulberry32(20260713);
      for (let i = 0; i < 170; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const r = 0.4 + rnd() * 1.1;
        const a = 0.05 + rnd() * rnd() * 0.35;
        const blue = rnd() > 0.6;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = blue
          ? `rgba(180,195,255,${a})`
          : `rgba(230,235,250,${a})`;
        ctx.fill();
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return (
    <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
  );
}

export default function Home() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [processing, setProcessing] = useState<ProcessingDoc[]>([]);
  const [engine, setEngine] = useState<Engine>("checking");
  const [selected, setSelected] = useState<MemoryEntry | null>(null);
  const [name, setName] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/feed");
      if (res.status === 503) {
        setEngine("offline");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setEntries(data.entries ?? []);
      setProcessing(data.processing ?? []);
      setEngine("online");
    } catch {
      setEngine("offline");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 3_000);
    return () => clearInterval(t);
  }, [refresh]);

  // First name for the greeting, pulled from the profile itself.
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const facts: string[] = d?.profile?.static ?? [];
        const m = facts.join(" ").match(/name is (\w+)/i);
        if (m) setName(m[1]);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="relative h-dvh overflow-hidden">
      {/* atmosphere — nebulae drifting behind everything */}
      <div
        aria-hidden
        className="animate-aurora pointer-events-none absolute -left-[20%] -top-[25%] h-[85vh] w-[75vw] rounded-full bg-[radial-gradient(closest-side,rgb(76_98_255/0.09),transparent_72%)] blur-3xl"
      />
      <div
        aria-hidden
        className="animate-aurora pointer-events-none absolute -bottom-[30%] -right-[18%] h-[75vh] w-[65vw] rounded-full bg-[radial-gradient(closest-side,rgb(150_90_255/0.07),transparent_72%)] blur-3xl [animation-delay:-45s] [animation-duration:110s]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(760px_520px_at_50%_42%,rgb(84_104_255/0.1),transparent_70%)]"
      />
      <Dust />
      {/* a meteor, once in a while */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="animate-meteor absolute left-[72%] top-[10%] h-px w-24 bg-gradient-to-r from-white/70 to-transparent shadow-[0_0_8px_rgb(255_255_255/0.35)]" />
        <span className="animate-meteor absolute left-[26%] top-[6%] h-px w-20 bg-gradient-to-r from-white/50 to-transparent [animation-delay:-17s] [animation-duration:47s]" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(1400px_1000px_at_50%_50%,transparent_55%,rgb(0_0_0/0.6))]"
      />

      {/* the sky of memories */}
      <Constellation
        entries={entries}
        processing={processing}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
      />

      {/* chrome */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-1 text-[16px] font-semibold tracking-tight text-white">
          recall
          <span className="inline-block size-[5px] rounded-full bg-blue-400" />
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-chip flex items-center gap-2 rounded-full px-3.5 py-2">
            <span
              className={
                "size-[6px] rounded-full " +
                (engine === "online"
                  ? "bg-emerald-400 shadow-[0_0_8px_1px_rgb(52_211_153/0.6)]"
                  : engine === "offline"
                    ? "bg-red-400"
                    : "bg-zinc-500")
              }
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
              {engine === "online" ? "local" : engine === "offline" ? "offline" : "…"}
            </span>
          </div>
          <DreamPopover />
        </div>
      </header>

      {/* the voice — the main event */}
      <VoicePanel engine={engine} greetingName={name} />

      {/* film grain over the whole scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[45] opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />

      {/* memory detail — click a star */}
      {selected && (
        <aside className="glass animate-rise absolute bottom-6 left-6 z-40 w-[min(88vw,360px)] rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              <span
                aria-hidden
                className="size-[6px] rounded-full"
                style={{
                  background: memoryColor(selected),
                  boxShadow: `0 0 10px 1px ${memoryColor(selected)}66`,
                }}
              />
              {selected.isInference ? "inferred" : selected.isStatic ? "stable" : "memory"}
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
    </div>
  );
}
