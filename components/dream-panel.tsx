"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Space } from "@/lib/spaces";
import { timeAgo } from "@/lib/format";

type Briefing = { id: string; content: string; createdAt?: string };

export function DreamPanel({ space }: { space: Space }) {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [dreaming, setDreaming] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const knownIds = useRef<Set<string>>(new Set());

  const load = useCallback(async (): Promise<Briefing[]> => {
    try {
      const res = await fetch(`/api/briefings?space=${space}`);
      if (!res.ok) return [];
      const data = await res.json();
      setBriefings(data.briefings ?? []);
      return data.briefings ?? [];
    } catch {
      return [];
    }
  }, [space]);

  useEffect(() => {
    load().then((b) => {
      knownIds.current = new Set(b.map((x) => x.id));
    });
  }, [load]);

  async function dream() {
    setDreaming(true);
    try {
      // Fires the real nightly schedule, out of band — dev dispatch route.
      await fetch("/eve/v1/dev/schedules/dream", { method: "POST" });
      // The dream session runs in the background; poll until the new
      // briefing lands (agent writes it via add_memory, kind: briefing).
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const fresh = await load();
        if (fresh.some((b) => !knownIds.current.has(b.id))) {
          knownIds.current = new Set(fresh.map((x) => x.id));
          break;
        }
      }
    } finally {
      setDreaming(false);
    }
  }

  async function speak(text: string) {
    if (speaking) {
      audioRef.current?.pause();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("tts failed");
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }

  const latest = briefings[0];

  return (
    <section className="overflow-hidden rounded-[1.25rem] border border-zinc-800 bg-[#14131d] text-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.2),0_16px_40px_-12px_rgba(20,19,29,0.5)]">
      <div className="flex items-center justify-between px-6 pt-5">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            Dreaming <span className="font-normal text-zinc-500">· your memory works while you sleep</span>
          </h2>
        </div>
        <button
          onClick={dream}
          disabled={dreaming}
          className="pill border border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
        >
          {dreaming ? "Dreaming…" : "Dream now"}
        </button>
      </div>

      <div className="px-6 pb-6 pt-4">
        {dreaming && !latest && (
          <p className="animate-pulse font-mono text-[12px] tracking-wide text-indigo-300">
            walking through your recent memories…
          </p>
        )}
        {!latest && !dreaming && (
          <p className="text-[13.5px] leading-relaxed text-zinc-500">
            Every night at 3:00 the agent reads your recent memories, finds connections you missed,
            checks your commitments, and writes a morning briefing. Press{" "}
            <span className="text-zinc-300">Dream now</span> to run tonight&apos;s dream early.
          </p>
        )}
        {latest && (
          <div className="animate-rise">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-indigo-300">
                morning briefing · {timeAgo(latest.createdAt)}
              </span>
              <button
                onClick={() => speak(latest.content)}
                className="pill border border-zinc-700 text-[12px] text-zinc-300 hover:border-zinc-500"
              >
                {speaking ? "◼ Stop" : "▶ Hear it"}
              </button>
            </div>
            <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-zinc-200">
              {latest.content}
            </p>
          </div>
        )}
        {dreaming && latest && (
          <p className="mt-3 animate-pulse font-mono text-[12px] tracking-wide text-indigo-300">
            dreaming a fresh briefing…
          </p>
        )}
      </div>
    </section>
  );
}
