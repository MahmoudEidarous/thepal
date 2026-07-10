"use client";

import { timeAgo } from "@/lib/format";

export type MemoryDoc = {
  id: string;
  status?: string | null;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  done: { dot: "bg-emerald-500", label: "remembered" },
  queued: { dot: "bg-zinc-300", label: "queued" },
  extracting: { dot: "bg-amber-400 animate-pulse", label: "extracting" },
  chunking: { dot: "bg-amber-400 animate-pulse", label: "processing" },
  embedding: { dot: "bg-amber-400 animate-pulse", label: "embedding" },
  failed: { dot: "bg-red-400", label: "failed" },
};

export function MemoryFeed({
  docs,
  engine,
}: {
  docs: MemoryDoc[];
  engine: "online" | "offline" | "checking";
}) {
  if (engine === "offline") {
    return (
      <section className="card flex flex-col items-center gap-1.5 border-dashed px-6 py-14 text-center shadow-none">
        <p className="text-[15px] font-medium text-zinc-700">Memory engine is offline</p>
        <p className="text-[13.5px] text-zinc-400">
          Start it with <span className="font-mono text-zinc-500">supermemory-server</span> and
          Recall will reconnect on its own.
        </p>
      </section>
    );
  }

  if (docs.length === 0) {
    return (
      <section className="card flex flex-col items-center gap-1.5 border-dashed px-6 py-14 text-center shadow-none">
        <p className="text-[15px] font-medium text-zinc-700">Nothing remembered yet</p>
        <p className="text-[13.5px] text-zinc-400">Write something above — Recall never forgets twice.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {docs.map((d) => {
        const status = STATUS_STYLE[d.status ?? ""] ?? {
          dot: "bg-zinc-300",
          label: d.status ?? "…",
        };
        const text = d.title ?? d.summary ?? d.content ?? "";
        return (
          <article key={d.id} className="card animate-rise px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={`size-[7px] rounded-full ${status.dot}`} />
                <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                  {status.label}
                </span>
              </div>
              <span className="font-mono text-[11px] text-zinc-300">{timeAgo(d.createdAt)}</span>
            </div>
            <p className="mt-2 line-clamp-3 text-[14.5px] leading-relaxed text-zinc-800">
              {String(text).slice(0, 280)}
            </p>
          </article>
        );
      })}
    </section>
  );
}
