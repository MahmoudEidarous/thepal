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

export default function Home() {
  const [space, setSpace] = useState<Space>("personal");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [processing, setProcessing] = useState<ProcessingDoc[]>([]);
  const [failed, setFailed] = useState<ProcessingDoc[]>([]);
  const [engine, setEngine] = useState<Engine>("checking");

  const spaceRef = useRef(space);
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
      setEntries(data.entries ?? []);
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
    refresh();
    const t = setInterval(() => {
      if (!document.hidden) refresh();
    }, 3_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen">
      <Header space={space} onSpaceChange={setSpace} engine={engine} />

      <main className="mx-auto grid max-w-5xl gap-6 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <VoicePanel space={space} onSpaceChange={setSpace} engine={engine} />

          <div className="flex flex-col gap-3">
            <p className="px-1 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
              live memory · {space}
            </p>
            <MemoryFeed entries={entries} processing={processing} failed={failed} engine={engine} />
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <ProfileCard space={space} engine={engine} />
          <DreamPanel />
          <CaptureCard space={space} onCaptured={refresh} />
        </aside>
      </main>
    </div>
  );
}
