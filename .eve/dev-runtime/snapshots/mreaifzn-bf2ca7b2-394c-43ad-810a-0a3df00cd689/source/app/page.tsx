"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/header";
import { CaptureCard } from "@/components/capture-card";
import { MemoryFeed, type MemoryEntry, type ProcessingDoc } from "@/components/memory-feed";
import { ProfileCard } from "@/components/profile-card";
import type { Space } from "@/lib/spaces";

type Engine = "online" | "offline" | "checking";

export default function Home() {
  const [space, setSpace] = useState<Space>("personal");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [processing, setProcessing] = useState<ProcessingDoc[]>([]);
  const [failed, setFailed] = useState<ProcessingDoc[]>([]);
  const [engine, setEngine] = useState<Engine>("checking");
  const [greeting, setGreeting] = useState("Hello.");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/feed?space=${space}`);
      if (res.status === 503) {
        setEngine("offline");
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setEntries(data.entries ?? []);
      setProcessing(data.processing ?? []);
      setFailed(data.failed ?? []);
      setEngine("online");
    } catch {
      setEngine("offline");
    }
  }, [space]);

  useEffect(() => {
    setEntries([]);
    setProcessing([]);
    setFailed([]);
    refresh();
    const t = setInterval(refresh, 3_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="min-h-screen">
      <Header space={space} onSpaceChange={setSpace} engine={engine} />

      <main className="mx-auto grid max-w-5xl gap-6 px-6 pb-24 pt-12 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <h1 className="text-[34px] font-semibold leading-tight tracking-tight">
              {greeting}
              <span className="text-zinc-400"> What should I remember?</span>
            </h1>
          </div>

          <CaptureCard space={space} onCaptured={refresh} />
          <MemoryFeed entries={entries} processing={processing} failed={failed} engine={engine} />
        </div>

        <aside className="flex flex-col gap-6 lg:pt-[76px]">
          <ProfileCard space={space} engine={engine} />
        </aside>
      </main>
    </div>
  );
}
