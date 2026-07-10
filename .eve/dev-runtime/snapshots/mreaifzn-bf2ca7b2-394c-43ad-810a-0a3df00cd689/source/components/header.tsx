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
    <header className="sticky top-0 z-40 border-b border-black/[0.05] bg-[#f7f8fa]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <div className="flex items-baseline gap-1 text-[19px] font-semibold tracking-tight">
          recall
          <span className="inline-block size-[7px] rounded-full bg-blue-500" />
        </div>

        <nav className="flex items-center gap-1.5">
          {SPACES.map((s) => (
            <button
              key={s}
              onClick={() => onSpaceChange(s)}
              className={
                "pill capitalize " +
                (s === space
                  ? "bg-zinc-900 text-white"
                  : "border border-black/[0.08] bg-white text-zinc-600 hover:border-black/[0.16] hover:text-zinc-900")
              }
            >
              {s}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5">
          <span
            className={
              "size-[7px] rounded-full " +
              (engine === "online"
                ? "bg-emerald-500"
                : engine === "offline"
                  ? "bg-red-400"
                  : "bg-zinc-300")
            }
          />
          <span className="font-mono text-[11px] tracking-wide text-zinc-500">
            {engine === "online" ? "engine" : engine === "offline" ? "offline" : "…"}
          </span>
        </div>
      </div>
    </header>
  );
}
