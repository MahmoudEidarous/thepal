"use client";

// Story mode — the agent gives a tour of the user's own memories and
// the screen performs it. The room dims, the chapters hang as stars in
// story-date order, and as the voice reaches each one it ignites: the
// path draws itself from star to star, the camera drifts, the words of
// the moment sit in the lower third like a subtitle. Everything here is
// driven by advance_story — the voice and the sky share one script.

import { useMemo } from "react";
import { TYPE_TONES } from "./sense-cards";

export type StoryBeat = {
  text: string;
  date: string; // YYYY[-MM[-DD]]
  dated: boolean;
  type: string;
  entities: Array<{ name: string; kind: string }>;
};

export type StoryState = {
  topic: string;
  beats: StoryBeat[];
  active: number; // -1 = staged, none lit yet
  done: boolean;
};

function prettyDate(d: string) {
  if (/^\d{4}$/.test(d)) return d;
  if (/^\d{4}-\d{2}$/.test(d)) {
    const dt = new Date(`${d}-15T12:00:00`);
    return isNaN(+dt) ? d : dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  const dt = new Date(`${d}T12:00:00`);
  return isNaN(+dt)
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// chapters along a gentle arc, each nudged off the line by its own text
function positions(beats: StoryBeat[]) {
  const n = beats.length;
  return beats.map((b, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = 11 + t * 78;
    const y = 42 - Math.sin(t * Math.PI) * 15 + ((hash(b.text) % 100) / 100 - 0.5) * 9;
    return { x, y };
  });
}

export function StoryOverlay({ story, onClose }: { story: StoryState; onClose: () => void }) {
  const { beats, active, done, topic } = story;
  const pos = useMemo(() => positions(beats), [beats]);
  const litThrough = done ? beats.length - 1 : active;
  const focus = pos[Math.max(0, Math.min(litThrough, pos.length - 1))];
  const beat = active >= 0 && active < beats.length ? beats[active] : null;

  // the camera leans toward the active star; the finale pulls back out
  const camera =
    done || active < 0
      ? "translate(0%, 0%) scale(1)"
      : `translate(${((50 - focus.x) * 0.32).toFixed(1)}%, ${((44 - focus.y) * 0.42).toFixed(1)}%) scale(1.1)`;

  return (
    <div className="card-in fixed inset-0 z-[45] overflow-hidden bg-black/72 backdrop-blur-[10px]">
      {/* header */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between px-6 pt-5">
        <div>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-indigo-200/70">
            a story from your memories
          </p>
          <p className="mt-1.5 text-[16px] font-light tracking-[-0.01em] text-zinc-100">{topic}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[9.5px] tracking-[0.2em] text-zinc-600 tabular-nums">
            {done ? "fin" : active >= 0 ? `${active + 1} / ${beats.length}` : `${beats.length} chapters`}
          </span>
          <button
            onClick={onClose}
            aria-label="Close the story"
            className="-m-1.5 rounded-full p-1.5 text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <line x1="5" y1="5" x2="19" y2="19" />
              <line x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        </div>
      </div>

      {/* the constellation — camera drifts, stars ignite, the path draws */}
      <div
        className="absolute inset-0 transition-transform duration-[1600ms] ease-[cubic-bezier(0.22,0.9,0.3,1)] motion-reduce:transition-none"
        style={{ transform: camera }}
        aria-hidden
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          {pos.slice(1).map((p, i) =>
            i < litThrough ? (
              <line
                key={i}
                x1={pos[i].x}
                y1={pos[i].y}
                x2={p.x}
                y2={p.y}
                stroke="rgb(180 195 255 / 0.32)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                className="animate-edge"
              />
            ) : null,
          )}
        </svg>
        {beats.map((b, i) => {
          const lit = i <= litThrough;
          const isActive = !done && i === active;
          const tone = TYPE_TONES[b.type] ?? TYPE_TONES.memory;
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%` }}
            >
              <div className="relative grid place-items-center">
                {isActive && <span className="star-flare" />}
                <span
                  className="rounded-full transition-all duration-700"
                  style={{
                    width: isActive ? 11 : lit ? 7 : 5,
                    height: isActive ? 11 : lit ? 7 : 5,
                    background: lit ? tone : "rgb(113 113 122 / 0.5)",
                    boxShadow: isActive
                      ? `0 0 22px 5px ${tone}66, 0 0 6px 1px #fff8 inset`
                      : lit
                        ? `0 0 12px 2px ${tone}44`
                        : "none",
                  }}
                />
              </div>
              <p
                className={`absolute left-1/2 top-[14px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tracking-[0.14em] transition-colors duration-700 tabular-nums ${
                  isActive ? "text-zinc-200" : lit ? "text-zinc-500" : "text-zinc-700"
                }`}
              >
                {prettyDate(b.date)}
              </p>
            </div>
          );
        })}
      </div>

      {/* the lower third — the words of the current chapter */}
      <div className="absolute inset-x-0 bottom-[9dvh] flex justify-center px-6">
        {beat && !done && (
          <div key={active} className="glass card-in w-full max-w-xl rounded-3xl px-6 py-5">
            <div className="flex items-center gap-2">
              <span
                className="size-[5px] rounded-full"
                style={{ background: TYPE_TONES[beat.type] ?? TYPE_TONES.memory }}
              />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">
                {prettyDate(beat.date)}{beat.dated ? "" : " · as told"}
              </span>
            </div>
            <p className="mt-2.5 text-[14.5px] font-light leading-relaxed text-zinc-100">
              {beat.text}
            </p>
            {beat.entities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {beat.entities.map((e, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-white/[0.05] px-2.5 py-[3px] font-mono text-[9.5px] tracking-[0.06em] text-zinc-400 ring-1 ring-inset ring-white/[0.08]"
                  >
                    {e.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {done && (
          <div className="glass card-in rounded-3xl px-7 py-4">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-indigo-200/70">
              the whole arc · {beats.length} chapters · {prettyDate(beats[0].date)} — {prettyDate(beats[beats.length - 1].date)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ?story=demo — six chapters, no engine required
export const DEMO_STORY: StoryState = {
  topic: "the berlin move",
  active: 0,
  done: false,
  beats: [
    { text: "Landed in Munich on a gray Tuesday in October 2023 with two suitcases and exactly zero German.", date: "2023-10", dated: true, type: "event", entities: [{ name: "Munich", kind: "place" }] },
    { text: "Took the S-Bahn to Starnberger See alone, walked the frozen shore, and decided for real to quit Siemens.", date: "2026-02", dated: true, type: "event", entities: [{ name: "Siemens", kind: "thing" }] },
    { text: "My last day at Siemens. Jonas organized the sendoff at the Augustiner. I kept the name badge.", date: "2026-06", dated: true, type: "event", entities: [{ name: "Jonas", kind: "person" }] },
    { text: "I signed the lease for the Prenzlauer Berg apartment — move-in September 1st, 1450 euro warm.", date: "2026-07-02", dated: true, type: "decision", entities: [{ name: "Prenzlauer Berg", kind: "place" }, { name: "Herr Weber", kind: "person" }] },
    { text: "The movers are booked for August 30th, a Saturday. Confirmation number MV-2214.", date: "2026-08-30", dated: true, type: "commitment", entities: [{ name: "Umzug Held", kind: "thing" }] },
    { text: "Move-in day: September 1st, Berlin. The study faces east.", date: "2026-09-01", dated: true, type: "event", entities: [{ name: "Berlin", kind: "place" }] },
  ],
};
