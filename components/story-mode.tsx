"use client";

// Story mode — the agent gives a tour of the user's own memories and
// the screen performs it. The room dims into deep space, the chapters
// hang as stars in story-date order, and as the voice reaches each one
// it ignites: a ring rolls out, the path draws itself star to star in
// the colors of what happened, the camera leans in, and the words of
// the moment sit in the lower third like a subtitle. Everything here is
// driven by advance_story — the voice and the sky share one script —
// and everything here can be left: Esc, the ✕, or just talking.

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

// deterministic PRNG — the same topic always hangs the same sky, and
// server/client render identically
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Dust = { x: number; y: number; r: number; o: number; delay: number };

function makeDust(seed: number, count: number): Dust[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: rnd() * 100,
    y: rnd() * 100,
    r: 0.6 + rnd() * 1.3,
    o: 0.12 + rnd() * 0.3,
    delay: rnd() * 6,
  }));
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
  // two dust layers: the far one sits outside the camera transform, the
  // near one rides it — parallax for free
  const dustFar = useMemo(() => makeDust(hash(topic) + 7, 46), [topic]);
  const dustNear = useMemo(() => makeDust(hash(topic) + 41, 30), [topic]);
  if (!beats.length) return null;
  const litThrough = done ? beats.length - 1 : active;
  const focus = pos[Math.max(0, Math.min(litThrough, pos.length - 1))];
  const beat = active >= 0 && active < beats.length ? beats[active] : null;
  const activeTone = beat ? (TYPE_TONES[beat.type] ?? TYPE_TONES.memory) : TYPE_TONES.memory;

  // the camera leans toward the active star; the finale pulls back out
  const camera =
    done || active < 0
      ? "translate(0%, 0%) scale(1)"
      : `translate(${((50 - focus.x) * 0.32).toFixed(1)}%, ${((44 - focus.y) * 0.42).toFixed(1)}%) scale(1.12)`;

  return (
    <div className="card-in fixed inset-0 z-[45] overflow-hidden bg-[#05060c]/85 backdrop-blur-[12px]">
      {/* deep space: vignette, two breathing nebulae, far dust */}
      <div className="absolute inset-0" aria-hidden>
        <div
          className="absolute -left-[20%] -top-[30%] size-[70%] rounded-full blur-3xl"
          style={{
            background: "radial-gradient(circle, rgb(88 96 190 / 0.16), transparent 65%)",
            animation: "aurora 70s ease-in-out infinite alternate",
          }}
        />
        <div
          className="absolute -bottom-[35%] -right-[15%] size-[75%] rounded-full blur-3xl"
          style={{
            background: "radial-gradient(circle, rgb(140 90 200 / 0.11), transparent 65%)",
            animation: "aurora 90s ease-in-out infinite alternate-reverse",
          }}
        />
        {dustFar.map((d, i) => (
          <span
            key={i}
            className="star-twinkle absolute rounded-full bg-white"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: d.r,
              height: d.r,
              ["--tw-base" as string]: d.o,
              animationDelay: `${d.delay}s`,
            }}
          />
        ))}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at 50% 42%, transparent 55%, rgb(0 0 0 / 0.55))" }}
        />
      </div>

      {/* header — the marquee and the exits */}
      <div className="absolute inset-x-0 top-0 z-10">
        {/* an ultra-thin thread of progress across the very top */}
        <div
          className="h-[2px] bg-gradient-to-r from-indigo-400/80 via-violet-300/70 to-transparent transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,0.9,0.3,1)]"
          style={{ width: `${((Math.max(litThrough, -1) + 1) / beats.length) * 100}%` }}
        />
        <div className="flex items-start justify-between gap-4 px-6 pt-4">
          <div className="min-w-0">
            <p className="truncate font-mono text-[9.5px] uppercase tracking-[0.3em] text-indigo-200/70 max-sm:text-[8.5px] max-sm:tracking-[0.2em]">
              a story from your memories
            </p>
            <p className="mt-1.5 truncate text-[17px] font-light tracking-[-0.01em] text-zinc-100">{topic}</p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="font-mono text-[9.5px] tracking-[0.2em] text-zinc-500 tabular-nums">
              {done ? "fin" : active >= 0 ? `${active + 1} / ${beats.length}` : `${beats.length} chapters`}
            </span>
            <button
              onClick={onClose}
              aria-label="Leave the story (Esc)"
              title="Leave the story (Esc)"
              className="glass-chip -my-1 flex items-center gap-2 rounded-full py-1.5 pl-3 pr-2.5 text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.18em]">esc</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* the constellation — camera drifts, stars ignite, the path draws */}
      <div
        className="absolute inset-0 transition-transform duration-[1800ms] ease-[cubic-bezier(0.22,0.9,0.3,1)] motion-reduce:transition-none"
        style={{ transform: camera }}
        aria-hidden
      >
        {dustNear.map((d, i) => (
          <span
            key={i}
            className="star-twinkle absolute rounded-full bg-white"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: d.r * 1.4,
              height: d.r * 1.4,
              ["--tw-base" as string]: d.o + 0.08,
              animationDelay: `${d.delay}s`,
            }}
          />
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          <defs>
            {pos.slice(1).map((p, i) => (
              <linearGradient
                key={i}
                id={`seg-${i}`}
                x1={pos[i].x}
                y1={pos[i].y}
                x2={p.x}
                y2={p.y}
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor={TYPE_TONES[beats[i].type] ?? TYPE_TONES.memory} />
                <stop offset="100%" stopColor={TYPE_TONES[beats[i + 1].type] ?? TYPE_TONES.memory} />
              </linearGradient>
            ))}
          </defs>
          {/* each lit segment twice: a wide soft glow, then the crisp thread */}
          {pos.slice(1).map((p, i) =>
            i < litThrough ? (
              <g key={i} className="animate-edge">
                <line
                  x1={pos[i].x}
                  y1={pos[i].y}
                  x2={p.x}
                  y2={p.y}
                  stroke={`url(#seg-${i})`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  opacity="0.14"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={pos[i].x}
                  y1={pos[i].y}
                  x2={p.x}
                  y2={p.y}
                  stroke={`url(#seg-${i})`}
                  strokeWidth="1.1"
                  strokeLinecap="round"
                  opacity="0.55"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
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
              className="star-in absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos[i].x}%`, top: `${pos[i].y}%`, animationDelay: `${i * 90}ms` }}
            >
              <div className="relative grid place-items-center">
                {isActive && (
                  <span className="flare-turn absolute inset-0 grid place-items-center">
                    <span className="star-flare" />
                  </span>
                )}
                {/* the ignition ring — replays every time the focus moves */}
                {isActive && (
                  <span
                    key={`ring-${active}`}
                    className="star-ignite absolute size-[26px] rounded-full"
                    style={{ border: `1px solid ${tone}` }}
                  />
                )}
                <span
                  className={`rounded-full transition-all duration-700 ${lit && !isActive ? "star-twinkle" : ""}`}
                  style={{
                    width: isActive ? 13 : lit ? 7 : 4.5,
                    height: isActive ? 13 : lit ? 7 : 4.5,
                    background: isActive
                      ? `radial-gradient(circle, #fff 0%, ${tone} 60%)`
                      : lit
                        ? tone
                        : "rgb(140 145 165 / 0.45)",
                    boxShadow: isActive
                      ? `0 0 30px 7px ${tone}59, 0 0 10px 2px ${tone}aa`
                      : lit
                        ? `0 0 12px 2px ${tone}44`
                        : "none",
                    ["--tw-base" as string]: lit ? 0.85 : 0.5,
                  }}
                />
              </div>
              {/* on a phone eight labels collide — only the active one speaks */}
              <p
                className={`absolute left-1/2 top-[16px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tracking-[0.14em] transition-colors duration-700 tabular-nums ${
                  isActive ? "text-zinc-200" : lit ? "text-zinc-500 max-sm:opacity-0" : "text-zinc-700 max-sm:opacity-0"
                }`}
              >
                {prettyDate(b.date)}
              </p>
            </div>
          );
        })}
      </div>

      {/* the lower third — the words of the current chapter. Sits clear
          of the session controls, which stay reachable above the dim. */}
      <div className="absolute inset-x-0 bottom-[max(9dvh,7.5rem)] flex flex-col items-center px-6">
        {beat && !done && (
          <div key={active} className="glass subtitle-in w-full max-w-xl rounded-3xl px-6 py-5">
            <div className="flex items-center gap-2">
              <span
                className="size-[5px] rounded-full"
                style={{ background: activeTone, boxShadow: `0 0 8px 1px ${activeTone}66` }}
              />
              <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">
                chapter {active + 1} · {prettyDate(beat.date)}
                {beat.dated ? "" : " · as told"}
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
          <div className="glass subtitle-in rounded-3xl px-7 py-4">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-indigo-200/70">
              the whole arc · {beats.length} chapters · {prettyDate(beats[0].date)} — {prettyDate(beats[beats.length - 1].date)}
            </p>
          </div>
        )}
        {/* the escape hatch, whispered: this is a conversation, not a film */}
        {!done && (
          <p className="mt-3 font-mono text-[8.5px] uppercase tracking-[0.24em] text-zinc-600 max-sm:hidden">
            interrupt anytime — just start talking
          </p>
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
