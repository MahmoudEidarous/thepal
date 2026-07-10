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

function Badge({ tone, children }: { tone: "blue" | "violet" | "zinc" | "amber"; children: React.ReactNode }) {
  const tones = {
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
    zinc: "bg-zinc-100 text-zinc-500",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>
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
      <section className="card flex flex-col items-center gap-1.5 border-dashed px-6 py-14 text-center shadow-none">
        <p className="text-[15px] font-medium text-zinc-700">Memory engine is offline</p>
        <p className="text-[13.5px] text-zinc-400">
          Start it with <span className="font-mono text-zinc-500">supermemory-server</span> and
          Recall will reconnect on its own.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      {processing.map((d) => (
        <div
          key={d.id}
          className="card animate-rise flex items-center gap-3 border-amber-100 bg-amber-50/40 px-5 py-3.5"
        >
          <span className="size-[7px] animate-pulse rounded-full bg-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] text-zinc-600">
              {(d.title ?? d.content ?? "").slice(0, 90)}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-amber-600">
            {d.status}…
          </span>
        </div>
      ))}

      {failed.map((d) => (
        <div key={d.id} className="card flex items-center gap-3 border-red-100 px-5 py-3 shadow-none">
          <span className="size-[7px] rounded-full bg-red-400" />
          <p className="truncate text-[13px] text-zinc-500">
            {(d.title ?? d.content ?? "").slice(0, 70)}
          </p>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-red-400">failed</span>
          <button
            onClick={() =>
              void fetch("/api/document", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: d.id }),
              })
            }
            aria-label="Dismiss"
            className="shrink-0 rounded-full px-1.5 text-[13px] leading-none text-zinc-300 hover:text-zinc-600"
          >
            ✕
          </button>
        </div>
      ))}

      {entries.length === 0 && processing.length === 0 && (
        <div className="card flex flex-col items-center gap-1.5 border-dashed px-6 py-14 text-center shadow-none">
          <p className="text-[15px] font-medium text-zinc-700">Nothing remembered yet</p>
          <p className="text-[13.5px] text-zinc-400">
            Write something above — watch it become memories in seconds.
          </p>
        </div>
      )}

      {entries.map((e) => {
        const superseded = e.history.length > 0;
        return (
          <article key={e.id} className="card animate-rise px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                {superseded && <Badge tone="blue">updated · v{e.version}</Badge>}
                {e.isStatic && <Badge tone="zinc">stable</Badge>}
                {e.isInference && <Badge tone="violet">inferred</Badge>}
                {!superseded && !e.isStatic && !e.isInference && <Badge tone="zinc">memory</Badge>}
              </div>
              <span className="shrink-0 font-mono text-[11px] text-zinc-300">
                {timeAgo(e.updatedAt)}
              </span>
            </div>

            <p className="mt-2 text-[15px] leading-relaxed text-zinc-900">{e.memory}</p>

            {superseded && (
              <div className="mt-3 flex flex-col gap-1.5 border-l-2 border-zinc-100 pl-3.5">
                {e.history
                  .slice()
                  .sort((a, b) => b.version - a.version)
                  .map((h) => (
                    <div key={h.id} className="flex items-baseline gap-2">
                      <span className="shrink-0 font-mono text-[10px] text-zinc-300">
                        v{h.version}
                      </span>
                      <p className="text-[13px] leading-relaxed text-zinc-400 line-through decoration-zinc-300">
                        {h.memory}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
