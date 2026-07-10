"use client";

import { useEffect, useState } from "react";
import type { Space } from "@/lib/spaces";

type Profile = { static?: string[]; dynamic?: string[] };

export function ProfileCard({
  space,
  engine,
}: {
  space: Space;
  engine: "online" | "offline" | "checking";
}) {
  const [profile, setProfile] = useState<Profile>({});

  // Don't show the previous space's facts while the new one loads.
  useEffect(() => {
    setProfile({});
  }, [space]);

  useEffect(() => {
    if (engine !== "online") return;
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/profile?space=${space}`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setProfile(data.profile ?? {});
      } catch {
        /* header dot already tells the offline story */
      }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [space, engine]);

  const stat = profile.static ?? [];
  const dyn = profile.dynamic ?? [];
  const empty = stat.length === 0 && dyn.length === 0;

  return (
    <section className="card p-5">
      <h2 className="text-[15px] font-semibold tracking-tight">
        What Recall knows <span className="font-normal text-zinc-400">about you</span>
      </h2>

      {empty ? (
        <p className="mt-3 text-[13.5px] leading-relaxed text-zinc-400">
          Nothing yet — it&apos;s still getting to know you. Every capture teaches it.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {stat.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                Stable facts
              </p>
              <ul className="flex flex-col gap-1.5">
                {stat.slice(0, 6).map((f, i) => (
                  <li key={i} className="text-[13.5px] leading-relaxed text-zinc-700">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dyn.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-blue-500">
                Right now
              </p>
              <ul className="flex flex-col gap-1.5">
                {dyn.slice(0, 5).map((f, i) => (
                  <li key={i} className="text-[13.5px] leading-relaxed text-zinc-700">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
