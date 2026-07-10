"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/header";
import { VoicePanel } from "@/components/voice-panel";
import { CaptureCard } from "@/components/capture-card";
import { MemoryFeed, type MemoryEntry, type ProcessingDoc } from "@/components/memory-feed";
import { ProfileCard } from "@/components/profile-card";
import { DreamPanel } from "@/components/dream-panel";
import type { Space } from "@/lib/spaces";

type Engine = "online" | "offline" | "checking";
type Toast = { id: string; text: string };

export default function Home() {
  const [space, setSpace] = useState<Space>("personal");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [processing, setProcessing] = useState<ProcessingDoc[]>([]);
  const [failed, setFailed] = useState<ProcessingDoc[]>([]);
  const [engine, setEngine] = useState<Engine>("checking");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const spaceRef = useRef(space);
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    spaceRef.current = space;
  }, [space]);

  const refresh = useCallback(async () => {
    const s = space;
    try {
      const res = await fetch(`/api/feed?space=${s}`);
      if (s !== spaceRef.current) return; // stale response from a previous space
      if (res.status === 503) {
        setEngine("offline");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      if (s !== spaceRef.current) return;
      const fresh: MemoryEntry[] = data.entries ?? [];

      // New memories surface as quiet notifications on the stage —
      // the proof that talking becomes memory, without leaving the orb.
      if (knownIds.current) {
        const news = fresh.filter((e) => !knownIds.current!.has(e.id)).slice(0, 3);
        news.forEach((e) => {
          const toast = { id: e.id, text: e.memory };
          setToasts((t) => [...t.filter((x) => x.id !== e.id), toast].slice(-3));
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== e.id)), 7000);
        });
      }
      knownIds.current = new Set(fresh.map((e) => e.id));

      setEntries(fresh);
      setProcessing(data.processing ?? []);
      setFailed(data.failed ?? []);
      setEngine("online");
    } catch {
      if (s === spaceRef.current) setEngine("offline");
    }
  }, [space]);

  useEffect(() => {
    setEntries([]);
    setProcessing([]);
    setFailed([]);
    knownIds.current = null;
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 3_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen">
      <Header space={space} onSpaceChange={setSpace} engine={engine} />

      {/* faint atmosphere behind the stage */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] bg-[radial-gradient(640px_420px_at_50%_36%,rgb(99_132_255/0.08),transparent_70%)]"
      />

      <main>
        <VoicePanel space={space} onSpaceChange={setSpace} engine={engine} />

        <div className="mx-auto max-w-5xl px-5 pb-32 sm:px-8">
          <div className="grid gap-14 lg:grid-cols-[1fr_300px]">
            <section className="min-w-0">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                live memory · {space}
              </h2>
              <div className="mt-2">
                <MemoryFeed
                  entries={entries}
                  processing={processing}
                  failed={failed}
                  engine={engine}
                />
              </div>
            </section>

            <aside className="flex flex-col gap-12">
              <ProfileCard space={space} engine={engine} />
              <DreamPanel />
              <CaptureCard space={space} onCaptured={refresh} />
            </aside>
          </div>
        </div>
      </main>

      {/* memory toasts — new memories land here while you talk */}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-rise w-fit max-w-full rounded-full border border-black/[0.05] bg-white/85 px-4 py-2 shadow-[0_8px_30px_-8px_rgb(0_0_0/0.12)] backdrop-blur-md"
          >
            <p className="truncate text-[13px] text-zinc-600">
              <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.12em] text-blue-500">
                remembered
              </span>
              {t.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
