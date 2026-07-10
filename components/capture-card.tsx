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
    const ctrl = new AbortController();
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/recall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, space }),
          signal: ctrl.signal,
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
      ctrl.abort(); // a newer keystroke or space switch owns the answer now
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
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
        quick capture
      </h2>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") remember();
        }}
        placeholder="Paste or jot something to remember…"
        rows={2}
        className="mt-3 w-full resize-none border-b border-black/[0.08] bg-transparent pb-2 text-[14px] leading-relaxed text-zinc-800 outline-none transition-colors placeholder:text-zinc-300 focus:border-black/[0.25]"
      />
      <div className="mt-2.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-300">⌘↵</span>
        <button
          onClick={remember}
          disabled={!content.trim() || sending}
          className="text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-30"
        >
          {sending ? "Remembering…" : "Remember →"}
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}

      {hits.length > 0 && (
        <div className="mt-4">
          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.15em] text-blue-500">
            you&apos;ve been here before
          </p>
          <div className="flex flex-col gap-2">
            {hits.slice(0, 3).map((h, i) => (
              <p
                key={h.id ?? i}
                className="animate-rise border-l border-blue-100 pl-3 text-[13px] leading-relaxed text-zinc-500"
              >
                {h.memory ?? h.chunk}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
