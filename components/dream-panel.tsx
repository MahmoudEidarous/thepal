"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";

type Briefing = { id: string; content: string; createdAt?: string };

// The one dark element on the page, on purpose: Dreaming is the night
// side of Recall. Briefings always live in the personal space — that's
// where the nightly schedule writes them.
export function DreamPanel() {
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
      const res = await fetch("/api/briefings?space=personal");
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
        setNotice("Couldn't wake the agent — is the dev server running?");
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
    <section className="overflow-hidden rounded-2xl bg-[linear-gradient(160deg,#111019_0%,#15131f_55%,#131223_100%)] p-6 text-zinc-200 shadow-[0_20px_60px_-24px_rgb(19_18_35/0.7)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-indigo-300/80">
            dreaming
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">
            your memory works while you sleep
          </p>
        </div>
        <button
          onClick={dream}
          disabled={dreaming}
          className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-1.5 text-[12.5px] font-medium text-zinc-300 transition-colors hover:border-white/[0.2] hover:text-white disabled:opacity-40"
        >
          {dreaming ? "Dreaming…" : "Dream now"}
        </button>
      </div>

      <div className="mt-5">
        {dreaming && !latest && (
          <p className="animate-pulse font-mono text-[11.5px] tracking-wide text-indigo-300/90">
            walking through your recent memories…
          </p>
        )}
        {!latest && !dreaming && (
          <p className="text-[13.5px] leading-relaxed text-zinc-500">
            Every night at 3:00 the agent reads your recent memories, finds connections you
            missed, and writes a morning briefing — or ask the orb for it out loud.
          </p>
        )}
        {latest && (
          <div className="animate-rise">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.15em] text-zinc-500">
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
                "mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-300 " +
                (expanded ? "" : "line-clamp-6")
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
          <p className="mt-3 animate-pulse font-mono text-[11.5px] tracking-wide text-indigo-300/90">
            dreaming a fresh briefing…
          </p>
        )}
        {notice && <p className="mt-3 text-[12.5px] text-zinc-500">{notice}</p>}
      </div>
    </section>
  );
}
