"use client";

import { useEffect, useRef, useState } from "react";
import type { Space } from "@/lib/spaces";

type RecallHit = {
  id?: string;
  memory?: string | null;
  chunk?: string | null;
  similarity?: number;
};

export function CaptureCard({
  space,
  onCaptured,
}: {
  space: Space;
  onCaptured: () => void;
}) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<RecallHit[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Proactive recall: while you type, your past thinking surfaces.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = content.trim();
    if (q.length < 8) {
      setHits([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/recall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, space }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setHits((data.results ?? []).filter((h: RecallHit) => h.memory || h.chunk));
      } catch {
        /* recall is a bonus, never an error state */
      }
    }, 600);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [content, space]);

  async function remember() {
    const body = content.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body, space }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `capture failed (${res.status})`);
      }
      setContent("");
      setHits([]);
      onCaptured();
    } catch (e) {
      setError(e instanceof Error ? e.message : "capture failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card p-5">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") remember();
        }}
        placeholder="What's on your mind?"
        rows={3}
        className="w-full resize-none bg-transparent text-[17px] leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          {space} · ⌘↵
        </span>
        <button
          onClick={remember}
          disabled={!content.trim() || sending}
          className="pill bg-zinc-900 px-5 py-2 text-white transition-opacity hover:opacity-85 disabled:opacity-30"
        >
          {sending ? "Remembering…" : "Remember"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-[13px] text-red-600">
          {error}
        </p>
      )}

      {hits.length > 0 && (
        <div className="mt-4 border-t border-black/[0.05] pt-4">
          <p className="mb-2.5 font-mono text-[11px] uppercase tracking-wider text-blue-500">
            You&apos;ve been here before
          </p>
          <div className="flex flex-col gap-2">
            {hits.slice(0, 3).map((h, i) => (
              <div
                key={h.id ?? i}
                className="animate-rise rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-2.5 text-[13.5px] leading-relaxed text-zinc-700"
              >
                {h.memory ?? h.chunk}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
