"use client";

import { timeAgo } from "@/lib/format";

export type MemoryEntry = {
  id: string;
  memory: string;
  version: number;
  isStatic: boolean;
  isInference: boolean;
  createdAt: string;
  updatedAt: string;
  memoryRelations: Record<string, string>;
  history: Array<{ id: string; memory: string; version: number; createdAt: string }>;
};

export type ProcessingDoc = {
  id: string;
  status?: string | null;
  title?: string | null;
  content?: string | null;
  createdAt?: string;
};

function Tag({ tone, children }: { tone: "blue" | "violet" | "zinc"; children: React.ReactNode }) {
  const tones = {
    blue: "text-blue-500",
    violet: "text-violet-500",
    zinc: "text-zinc-300",
  };
  return (
    <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function MemoryFeed({
  entries,
  processing,
  failed,
  engine,
}: {
  entries: MemoryEntry[];
  processing: ProcessingDoc[];
  failed: ProcessingDoc[];
  engine: "online" | "offline" | "checking";
}) {
  if (engine === "offline") {
    return (
      <div className="py-16 text-center">
        <p className="text-[15px] font-medium text-zinc-600">Memory engine is offline</p>
        <p className="mt-1 text-[13.5px] text-zinc-400">
          Start it with <span className="font-mono text-zinc-500">supermemory-server</span> — Recall
          reconnects on its own.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {processing.map((d) => (
        <div key={d.id} className="animate-rise flex items-center gap-3 border-b border-black/[0.04] py-4">
          <span className="size-[6px] shrink-0 animate-pulse rounded-full bg-amber-400" />
          <p className="min-w-0 flex-1 truncate text-[14px] italic text-zinc-400">
            {(d.title ?? d.content ?? "").slice(0, 90)}
          </p>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-500">
            {d.status}
          </span>
        </div>
      ))}

      {failed.map((d) => (
        <div key={d.id} className="flex items-center gap-3 border-b border-black/[0.04] py-4">
          <span className="size-[6px] shrink-0 rounded-full bg-red-400" />
          <p className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-400">
            {(d.title ?? d.content ?? "").slice(0, 70)}
          </p>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-red-400">
            failed
          </span>
          <button
            onClick={() =>
              void fetch("/api/document", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: d.id }),
              })
            }
            aria-label="Dismiss"
            className="shrink-0 px-1 text-[13px] leading-none text-zinc-300 transition-colors hover:text-zinc-600"
          >
            ✕
          </button>
        </div>
      ))}

      {entries.length === 0 && processing.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-[15px] font-medium text-zinc-600">Nothing remembered yet</p>
          <p className="mt-1 text-[13.5px] text-zinc-400">
            Say something to the orb — watch it become memory.
          </p>
        </div>
      )}

      {entries.map((e) => {
        const superseded = e.history.length > 0;
        return (
          <article key={e.id} className="animate-rise group flex gap-5 border-b border-black/[0.04] py-4">
            <time className="w-14 shrink-0 pt-[3px] text-right font-mono text-[10.5px] text-zinc-300">
              {timeAgo(e.updatedAt)}
            </time>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] leading-relaxed text-zinc-800">{e.memory}</p>
              {superseded && (
                <div className="mt-2 flex flex-col gap-1">
                  {e.history
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((h) => (
                      <p
                        key={h.id}
                        className="text-[13px] leading-relaxed text-zinc-300 line-through decoration-zinc-200"
                      >
                        {h.memory}
                      </p>
                    ))}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-start gap-2 pt-[3px]">
              {superseded && <Tag tone="blue">v{e.version}</Tag>}
              {e.isInference && <Tag tone="violet">inferred</Tag>}
              {e.isStatic && <Tag tone="zinc">stable</Tag>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
