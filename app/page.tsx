"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VoicePanel } from "@/components/voice-panel";
import { DreamPopover } from "@/components/dream-popover";
import { NightCard } from "@/components/night-card";
import { Dust, GRAIN } from "@/components/atmosphere";
import type { MemoryEntry, ProcessingDoc } from "@/lib/memory-types";
import { profileName } from "@/lib/format";

type Engine = "online" | "offline" | "checking";

export default function Home() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [processing, setProcessing] = useState<ProcessingDoc[]>([]);
  const [engine, setEngine] = useState<Engine>("checking");
  const [name, setName] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const dragDepth = useRef(0);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state lands after await, no cascade
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 4_000);
    return () => clearInterval(t);
  }, [refresh]);

  // First name for the greeting, pulled from the profile itself.
  useEffect(() => {
    Promise.all([
      fetch("/api/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/captures").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, c]) => {
        // only the user's own name — not the landlord's, not the sister's
        const n = profileName([
          ...(d?.profile?.static ?? []),
          ...(d?.profile?.dynamic ?? []),
          ...((c?.captures ?? []) as Array<{ text: string }>).map((x) => x.text),
        ]);
        if (n) setName(n);
      })
      .catch(() => {});
  }, []);

  // feed the sky: drop notes anywhere, they become memories
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).slice(0, 8);
    const notes = files.filter(
      (f) => /\.(md|markdown|txt|text)$/i.test(f.name) || f.type.startsWith("text/"),
    );
    if (!notes.length) {
      setDropNote("only text for now — .md or .txt");
      setTimeout(() => setDropNote(null), 3500);
      return;
    }
    setDropNote(`reading ${notes.length} note${notes.length > 1 ? "s" : ""} into memory…`);
    await Promise.all(
      notes.map(async (f) => {
        const content = (await f.text()).slice(0, 64_000).trim();
        if (!content) return;
        await fetch("/api/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, source: `drop:${f.name}` }),
        }).catch(() => {});
      }),
    );
    refresh();
    setTimeout(() => setDropNote(null), 3000);
  }

  return (
    <div
      className="relative h-dvh overflow-hidden"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
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

      {/* chrome */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5">
        <div className="flex items-baseline gap-1 text-[16px] font-semibold tracking-tight text-white">
          the pal
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
          <Link
            href="/brain"
            aria-label="Open the brain — your memory graph"
            title="The brain"
            className="glass-chip flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400 transition-all hover:border-white/25 hover:text-zinc-100"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="6" cy="6" r="2.6" />
              <circle cx="18" cy="8" r="2.2" />
              <circle cx="11" cy="18" r="2.4" />
              <path d="m8.2 7.2 7.6 0.6M7.2 8.3l2.6 7.4M16.5 9.9l-4 6" />
            </svg>
            brain · {entries.length}
          </Link>
          <a
            href="/api/export"
            download
            aria-label="Export your brain as Markdown"
            title="Export your brain (.md)"
            className="glass-chip flex size-9 items-center justify-center rounded-full text-zinc-400 transition-all hover:scale-105 hover:border-white/25 hover:text-zinc-200"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </a>
          <DreamPopover />
        </div>
      </header>

      {/* the voice — the only thing on this page */}
      <VoicePanel engine={engine} greetingName={name} memoryCount={entries.length} />

      {/* the night editor's work, when there's a fresh note */}
      <NightCard />

      {/* extraction heartbeat */}
      {processing.length > 0 && (
        <p className="glass-chip animate-rise absolute bottom-7 right-6 z-30 rounded-full px-3.5 py-2 font-mono text-[10px] tracking-[0.14em] text-zinc-400">
          <span className="mr-2 inline-block size-[5px] animate-pulse rounded-full bg-amber-300/90 align-middle" />
          weaving {processing.length} into memory
        </p>
      )}

      {/* feed the sky — drop target veil */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="glass animate-rise rounded-3xl px-10 py-8 text-center">
            <p className="text-[17px] font-light text-zinc-100">Drop it into the sky.</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              .md · .txt — read, enriched, remembered
            </p>
          </div>
        </div>
      )}
      {dropNote && (
        <p className="glass-chip animate-rise absolute bottom-20 left-1/2 z-[70] -translate-x-1/2 rounded-full px-4 py-2 font-mono text-[10.5px] tracking-[0.12em] text-zinc-300">
          {dropNote}
        </p>
      )}

      {/* film grain over the whole scene */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[45] opacity-[0.05] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />
    </div>
  );
}
