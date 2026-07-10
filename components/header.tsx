"use client";

import { SPACES, type Space } from "@/lib/spaces";

type Engine = "online" | "offline" | "checking";

export function Header({
  space,
  onSpaceChange,
  engine,
}: {
  space: Space;
  onSpaceChange: (s: Space) => void;
  engine: Engine;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.04] bg-[#f7f8fa]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex items-baseline gap-1 text-[17px] font-semibold tracking-tight text-zinc-900">
          recall
          <span className="inline-block size-[6px] rounded-full bg-blue-500" />
        </div>

        <nav className="flex items-center gap-6 sm:gap-8">
          {SPACES.map((s) => (
            <button
              key={s}
              onClick={() => onSpaceChange(s)}
              className={
                "relative py-1 text-[13px] capitalize transition-colors " +
                (s === space
                  ? "font-medium text-zinc-900"
                  : "text-zinc-400 hover:text-zinc-700")
              }
            >
              {s}
              {s === space && (
                <span className="absolute -bottom-[3px] left-1/2 size-[3.5px] -translate-x-1/2 rounded-full bg-blue-500" />
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <span
            className={
              "size-[6px] rounded-full " +
              (engine === "online"
                ? "bg-emerald-500"
                : engine === "offline"
                  ? "bg-red-400"
                  : "bg-zinc-300")
            }
          />
          <span className="hidden font-mono text-[10.5px] uppercase tracking-[0.15em] text-zinc-400 sm:inline">
            {engine === "online" ? "local" : engine === "offline" ? "offline" : "…"}
          </span>
        </div>
      </div>
    </header>
  );
}
