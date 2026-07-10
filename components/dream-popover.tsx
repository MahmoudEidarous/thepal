"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";

type Briefing = { id: string; content: string; createdAt?: string };

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

// Dreaming: while you sleep, the local agent reads your memories and
// writes a morning briefing. Lives behind the moon in the top corner.
export function DreamPopover() {
  const [open, setOpen] = useState(false);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [dreaming, setDreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState<"idle" | "loading" | "playing">("idle");
  const [expanded, setExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const knownIds = useRef<Set<string>>(new Set());

  const load = useCallback(async (): Promise<Briefing[]> => {
    try {
      const res = await fetch("/api/briefings");
      if (!res.ok) return [];
      const data = await res.json();
      const fresh: Briefing[] = data.briefings ?? [];
      if (aliveRef.current) setBriefings(fresh);
      return fresh;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch; state lands after await, no cascade
    load().then((b) => {
      knownIds.current = new Set(b.map((x) => x.id));
    });
    return () => {
      aliveRef.current = false;
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [load]);

  async function dream() {
    setDreaming(true);
    setNotice(null);
    try {
      // Fires the real nightly schedule, out of band — dev dispatch route.
      const res = await fetch("/eve/v1/dev/schedules/dream", { method: "POST" });
      if (!res.ok) {
        setNotice("Couldn't wake the dreamer — is the dev server running?");
        return;
      }
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!aliveRef.current) return;
        const fresh = await load();
        if (fresh.some((b) => !knownIds.current.has(b.id))) {
          knownIds.current = new Set(fresh.map((x) => x.id));
          return;
        }
      }
      setNotice("The dream is taking longer than usual — it should land here shortly.");
    } finally {
      if (aliveRef.current) setDreaming(false);
    }
  }

  function stopVoice() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setVoice("idle");
  }

  async function speak(text: string) {
    if (voice !== "idle") {
      stopVoice();
      return;
    }
    setVoice("loading");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("tts failed");
      const blob = await res.blob();
      if (!aliveRef.current) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = stopVoice;
      await audio.play();
      setVoice("playing");
    } catch {
      stopVoice();
    }
  }

  const latest = briefings[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Dreaming"
        className={
          "glass-chip flex size-9 items-center justify-center rounded-full transition-all hover:scale-105 hover:border-white/25 " +
          (open ? "text-indigo-300" : "text-zinc-400 hover:text-zinc-200")
        }
      >
        <MoonIcon />
      </button>

      {open && (
        <div className="glass animate-rise absolute right-0 top-12 z-50 w-[min(88vw,380px)] rounded-3xl p-6 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-mono text-[10px] uppercase tracking-[0.28em] text-indigo-300">
                dreaming
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">
                your memory works while you sleep
              </p>
            </div>
            <button
              onClick={dream}
              disabled={dreaming}
              className="glass-chip shrink-0 rounded-full px-4 py-1.5 text-[12.5px] font-medium text-zinc-200 transition-all hover:border-white/25 disabled:opacity-40"
            >
              {dreaming ? "Dreaming…" : "Dream now"}
            </button>
          </div>

          <div className="mt-5">
            {dreaming && !latest && (
              <p className="animate-pulse font-mono text-[11px] tracking-wide text-indigo-300/90">
                walking through your recent memories…
              </p>
            )}
            {!latest && !dreaming && (
              <p className="text-[13px] leading-relaxed text-zinc-500">
                Every night at 3:00 the agent reads your recent memories, finds connections you
                missed, and writes a morning briefing — or just ask the orb for it.
              </p>
            )}
            {latest && (
              <div className="animate-rise">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                    briefing · {timeAgo(latest.createdAt)}
                  </span>
                  <button
                    onClick={() => speak(latest.content)}
                    className="shrink-0 text-[12.5px] font-medium text-indigo-300 transition-colors hover:text-indigo-200"
                  >
                    {voice === "idle" ? "▶ hear it" : voice === "loading" ? "waking…" : "◼ stop"}
                  </button>
                </div>
                <p
                  className={
                    "mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-300 " +
                    (expanded ? "max-h-72 overflow-y-auto pr-1" : "line-clamp-5")
                  }
                >
                  {latest.content}
                </p>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="mt-2 text-[12px] text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  {expanded ? "less" : "read all"}
                </button>
              </div>
            )}
            {dreaming && latest && (
              <p className="mt-3 animate-pulse font-mono text-[11px] tracking-wide text-indigo-300/90">
                dreaming a fresh briefing…
              </p>
            )}
            {notice && <p className="mt-3 text-[12.5px] text-zinc-500">{notice}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
