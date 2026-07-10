"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/header";
import { CaptureCard } from "@/components/capture-card";
import { MemoryFeed, type MemoryEntry, type ProcessingDoc } from "@/components/memory-feed";
import { ProfileCard } from "@/components/profile-card";
import { ChatPanel } from "@/components/chat-panel";
import { DreamPanel } from "@/components/dream-panel";
import type { Space } from "@/lib/spaces";

type Engine = "online" | "offline" | "checking";
type View = "remember" | "ask" | "dream";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "remember", label: "Remember" },
  { id: "ask", label: "Ask" },
  { id: "dream", label: "Dream" },
];

export default function Home() {
  const [space, setSpace] = useState<Space>("personal");
  const [view, setView] = useState<View>("remember");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [processing, setProcessing] = useState<ProcessingDoc[]>([]);
  const [failed, setFailed] = useState<ProcessingDoc[]>([]);
  const [engine, setEngine] = useState<Engine>("checking");
  const [greeting, setGreeting] = useState("Hello.");

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 5 ? "Still up?" : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.");
  }, []);

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

  const tagline =
    view === "remember"
      ? " What should I remember?"
      : view === "ask"
        ? " Ask your memory anything."
        : " Let your memory dream.";

  return (
    <div className="min-h-screen">
      <Header space={space} onSpaceChange={setSpace} engine={engine} />

      <main className="mx-auto grid max-w-5xl gap-6 px-4 pb-24 pt-12 sm:px-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-5">
            <h1 className="text-[34px] font-semibold leading-tight tracking-tight">
              {greeting}
              <span className="text-zinc-400">{tagline}</span>
            </h1>
            <nav className="flex gap-1.5">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={
                    "pill " +
                    (view === v.id
                      ? "bg-zinc-900 text-white"
                      : "border border-black/[0.08] bg-white text-zinc-600 hover:border-black/[0.16] hover:text-zinc-900")
                  }
                >
                  {v.label}
                </button>
              ))}
            </nav>
          </div>

          {view === "remember" && (
            <>
              <CaptureCard space={space} onCaptured={refresh} />
              <MemoryFeed entries={entries} processing={processing} failed={failed} engine={engine} />
            </>
          )}
          {view === "ask" && <ChatPanel key={space} space={space} />}
          {view === "dream" && <DreamPanel />}
        </div>

        <aside className="flex flex-col gap-6 lg:pt-[76px]">
          <ProfileCard space={space} engine={engine} />
        </aside>
      </main>
    </div>
  );
}
