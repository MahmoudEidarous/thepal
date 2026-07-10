"use client";

import { useCallback, useEffect, useState } from "react";
import { VoicePanel } from "@/components/voice-panel";
import { Constellation, type MemoryEntry, type ProcessingDoc } from "@/components/constellation";
import { DreamPopover } from "@/components/dream-popover";
import { timeAgo } from "@/lib/format";

type Engine = "online" | "offline" | "checking";

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
      {/* atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(760px_520px_at_50%_40%,rgb(84_104_255/0.13),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(1400px_1000px_at_50%_50%,transparent_55%,rgb(0_0_0/0.55))]"
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

      {/* memory detail — click a star */}
      {selected && (
        <aside className="glass animate-rise absolute bottom-6 left-6 z-40 w-[min(88vw,360px)] rounded-3xl p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">
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
