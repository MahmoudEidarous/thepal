"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { timeAgo } from "@/lib/format";

type Briefing = { id: string; content: string; createdAt?: string };

// Briefings always live in the personal space — that's where the nightly
// schedule writes them — so this panel reads personal regardless of the
// space selected in the header.
export function DreamPanel() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [dreaming, setDreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState<"idle" | "loading" | "playing">("idle");
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
      // Silence any playback the panel leaves behind.
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
      // The dream session runs in the background; poll until the new
      // briefing lands (agent writes it via add_memory, kind: briefing).
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
    <section className="overflow-hidden rounded-[1.25rem] border border-zinc-800 bg-[#14131d] text-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.2),0_16px_40px_-12px_rgba(20,19,29,0.5)]">
      <div className="flex items-center justify-between gap-3 px-6 pt-5">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Dreaming <span className="font-normal text-zinc-500">· your memory works while you sleep</span>
        </h2>
        <button
          onClick={dream}
          disabled={dreaming}
          className="pill shrink-0 border border-zinc-700 bg-zinc-800/80 text-zinc-200 hover:border-zinc-500 disabled:opacity-50"
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
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-indigo-300">
                morning briefing · {timeAgo(latest.createdAt)}
              </span>
              <button
                onClick={() => speak(latest.content)}
                className="pill shrink-0 border border-zinc-700 text-[12px] text-zinc-300 hover:border-zinc-500"
              >
                {voice === "idle" ? "▶ Hear it" : voice === "loading" ? "waking the voice…" : "◼ Stop"}
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
        {notice && (
          <p className="mt-3 rounded-xl bg-zinc-800/60 px-4 py-2.5 text-[13px] text-zinc-400">
            {notice}
          </p>
        )}

        {briefings.length > 1 && (
          <div className="mt-5 border-t border-zinc-800 pt-4">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-zinc-600">
              earlier dreams
            </p>
            <div className="flex flex-col gap-1.5">
              {briefings.slice(1).map((b) => (
                <p key={b.id} className="truncate text-[13px] text-zinc-500">
                  <span className="font-mono text-[11px] text-zinc-600">{timeAgo(b.createdAt)}</span>
                  {" · "}
                  {b.content}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
