"use client";

// Sense cards — when the orb looks at the world, the evidence
// materializes here. A weather card is a living miniature sky; a search
// card is a dispatch from the wider world with its receipts attached.
// Desktop: a dock below the header, top right. Mobile: newest card only,
// docked above the controls.

import { useState } from "react";
import type { Weather } from "@/lib/senses";

export type WebSource = {
  title: string;
  url: string;
  domain: string;
  published: string | null;
  favicon: string | null;
  snippet: string | null;
};

export type SenseCard =
  | { id: number; kind: "weather"; status: "loading" | "ready" | "error"; data?: Weather; error?: string }
  | {
      id: number;
      kind: "search";
      status: "loading" | "ready" | "error";
      query: string;
      mode?: "answer" | "wire" | "empty";
      answer?: string;
      results?: WebSource[];
      tookMs?: number;
      error?: string;
    };

function ago(iso: string | null) {
  if (!iso) return null;
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Dismiss({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Dismiss card"
      className="-m-1.5 rounded-full p-1.5 text-zinc-600 transition-colors hover:text-zinc-300"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        <line x1="5" y1="5" x2="19" y2="19" />
        <line x1="19" y1="5" x2="5" y2="19" />
      </svg>
    </button>
  );
}

function Eyebrow({
  label,
  tone,
  right,
  onDismiss,
}: {
  label: string;
  tone: string; // tailwind bg class for the live dot
  right?: string | null;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3.5">
      <span className={`size-[5px] animate-hint rounded-full ${tone}`} />
      <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">{label}</span>
      <span className="ml-auto font-mono text-[9.5px] tracking-[0.14em] text-zinc-600">{right}</span>
      <Dismiss onClick={onDismiss} />
    </div>
  );
}

function Shimmer({ w }: { w: string }) {
  return <div className={`animate-shimmer h-3 rounded-full ${w}`} />;
}

/* ── the sky ─────────────────────────────────────────────────────── */

// deterministic star field for night scenes
const STARS = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 37) % 100,
  y: (i * 53) % 88,
  o: 0.25 + ((i * 29) % 60) / 100,
  s: i % 5 === 0 ? 2 : 1,
}));

const SKY_BG: Record<string, [string, string]> = {
  "clear-day": ["#1c2f55", "#0d1626"],
  "clear-night": ["#0b0f1f", "#070910"],
  "partly-day": ["#233350", "#0e1524"],
  "partly-night": ["#0d1120", "#080a12"],
  clouds: ["#1d2331", "#0d1018"],
  fog: ["#1c2029", "#0e1016"],
  drizzle: ["#181f2d", "#0c0f17"],
  rain: ["#151c2a", "#0a0d14"],
  snow: ["#222a3a", "#10141e"],
  thunder: ["#171526", "#0a0912"],
};

function Sky({ w }: { w: Weather }) {
  const { scene, isDay } = w.now;
  const key =
    scene === "clear" || scene === "partly" ? `${scene}-${isDay ? "day" : "night"}` : scene;
  const [top, bottom] = SKY_BG[key] ?? SKY_BG["partly-day"];
  const raining = scene === "rain" || scene === "drizzle" || scene === "thunder";
  const cloudy =
    scene === "clouds" || scene === "partly" || scene === "rain" || scene === "drizzle" || scene === "thunder";

  return (
    <div
      className="relative h-[104px] overflow-hidden"
      style={{ background: `linear-gradient(180deg, ${top}, ${bottom})` }}
      aria-hidden
    >
      {/* sun / moon */}
      {scene === "clear" && isDay && (
        <>
          <div className="absolute -right-8 -top-10 size-36 rounded-full bg-[radial-gradient(circle,rgb(255_200_110/0.5),transparent_65%)]" />
          <div className="absolute right-7 top-4 size-7 rounded-full bg-amber-100/90 shadow-[0_0_28px_6px_rgb(255_210_130/0.55)]" />
        </>
      )}
      {(scene === "clear" || scene === "partly") && !isDay && (
        <>
          {STARS.map((s, i) => (
            <span
              key={i}
              className="star-twinkle absolute rounded-full bg-white"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.s,
                height: s.s,
                ["--tw-base" as string]: s.o,
                animationDelay: `${(i % 7) * 0.9}s`,
              }}
            />
          ))}
          <div className="absolute right-8 top-4 size-6 rounded-full bg-zinc-100/85 shadow-[0_0_22px_4px_rgb(220_228_255/0.4)]" />
          <div className="absolute right-[26px] top-[13px] size-5 rounded-full" style={{ background: top }} />
        </>
      )}

      {/* clouds */}
      {cloudy && (
        <>
          <div className="animate-cloud absolute left-[8%] top-4 h-9 w-28 rounded-full bg-white/[0.09] blur-xl" />
          <div className="animate-cloud absolute left-[46%] top-9 h-10 w-36 rounded-full bg-white/[0.07] blur-xl [animation-delay:-9s]" />
          <div className="animate-cloud absolute left-[70%] top-2 h-8 w-24 rounded-full bg-white/[0.08] blur-xl [animation-delay:-18s]" />
        </>
      )}

      {/* fog bands */}
      {scene === "fog" && (
        <>
          <div className="animate-cloud absolute inset-x-0 top-5 h-5 bg-white/[0.07] blur-lg" />
          <div className="animate-cloud absolute inset-x-0 top-12 h-6 bg-white/[0.05] blur-lg [animation-delay:-12s]" />
          <div className="animate-cloud absolute inset-x-0 top-[74px] h-5 bg-white/[0.08] blur-lg [animation-delay:-20s]" />
        </>
      )}

      {/* rain streaks — tiled diagonal lines sliding down the tile grid */}
      {raining && (
        <div
          className={`absolute inset-0 ${scene === "drizzle" ? "animate-rain opacity-40 [animation-duration:1.5s]" : "animate-rain"}`}
          style={{
            backgroundImage:
              "linear-gradient(105deg, transparent 44%, rgb(185 205 255 / 0.5) 50%, transparent 56%)",
            backgroundSize: scene === "drizzle" ? "7px 20px" : "9px 30px",
          }}
        />
      )}

      {/* snow */}
      {scene === "snow" && (
        <div
          className="animate-snow absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgb(255 255 255 / 0.85) 1px, transparent 1.8px), radial-gradient(circle, rgb(255 255 255 / 0.5) 1px, transparent 1.6px)",
            backgroundSize: "28px 28px, 42px 42px",
          }}
        />
      )}

      {/* lightning */}
      {scene === "thunder" && <div className="animate-flash absolute inset-0 bg-white/60" />}

      {/* readability scrim + the numbers, living inside the sky */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
      <div className="absolute bottom-2.5 left-4 flex items-end gap-2.5">
        <span className="text-[42px] font-extralight leading-none tracking-tight text-white [text-shadow:0_2px_16px_rgb(0_0_0/0.6)]">
          {w.now.temp}°
        </span>
        <div className="pb-0.5">
          <p className="text-[12.5px] font-medium capitalize leading-tight text-zinc-100">{w.now.label}</p>
          <p className="text-[10.5px] leading-tight text-zinc-400">feels {w.now.feels}° · wind {w.now.wind} km/h</p>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ w }: { w: Weather }) {
  const hs = w.hours;
  if (hs.length < 2) return null;
  const W = 296;
  const H = 40;
  const temps = hs.map((h) => h.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 2);
  const x = (i: number) => 4 + (i / (hs.length - 1)) * (W - 8);
  const y = (t: number) => 8 + (1 - (t - min) / span) * (H - 16);
  const path = hs.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(" ");
  return (
    <div className="px-4 pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" aria-hidden>
        {/* rain probability, as quiet bars under the temperature line */}
        {hs.map((h, i) =>
          h.precip > 8 ? (
            <rect
              key={i}
              x={x(i) - 3}
              y={H - 2 - (h.precip / 100) * 18}
              width="6"
              height={(h.precip / 100) * 18 + 2}
              rx="2"
              fill="rgb(103 195 241 / 0.28)"
            />
          ) : null,
        )}
        <path d={path} fill="none" stroke="rgb(236 236 241 / 0.75)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx={x(0)} cy={y(hs[0].temp)} r="2.6" fill="#ececf1" />
      </svg>
      <div className="flex justify-between font-mono text-[9px] tracking-[0.12em] text-zinc-600">
        <span>now</span>
        <span>{hs[Math.floor(hs.length / 2)].t}</span>
        <span>{hs[hs.length - 1].t}</span>
      </div>
    </div>
  );
}

function WeatherBody({ card, onDismiss }: { card: Extract<SenseCard, { kind: "weather" }>; onDismiss: () => void }) {
  if (card.status === "loading")
    return (
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">reading the sky</span>
          <Dismiss onClick={onDismiss} />
        </div>
        <div className="mt-4 space-y-2.5">
          <Shimmer w="w-2/5" />
          <Shimmer w="w-4/5" />
          <Shimmer w="w-3/5" />
        </div>
      </div>
    );
  if (card.status === "error" || !card.data)
    return (
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">weather</span>
          <Dismiss onClick={onDismiss} />
        </div>
        <p className="mt-2 text-[12.5px] text-amber-400/90">{card.error ?? "couldn't read the sky"}</p>
      </div>
    );
  const w = card.data;
  return (
    <>
      <Eyebrow label={`the sky · ${w.place}`} tone="bg-sky-300/90 shadow-[0_0_8px_1px_rgb(125_211_252/0.5)]" right={w.now.isDay ? "day" : "night"} onDismiss={onDismiss} />
      <div className="mt-2.5 overflow-hidden rounded-b-none">
        <Sky w={w} />
      </div>
      <Sparkline w={w} />
      <div className="flex items-center gap-3 px-4 pb-3.5 pt-2 text-[11px] text-zinc-400">
        <span>
          today <span className="text-zinc-200">{w.today.hi}°</span> / {w.today.lo}°
        </span>
        <span className="text-zinc-700">·</span>
        <span className="capitalize">
          tomorrow {w.tomorrow.label}, <span className="text-zinc-200">{w.tomorrow.hi}°</span> / {w.tomorrow.lo}°
        </span>
      </div>
      {w.rainWindow && (
        <p className="border-t border-white/[0.06] px-4 py-2.5 text-[11px] text-sky-300/90">☂ {w.rainWindow}</p>
      )}
    </>
  );
}

/* ── the wider world ─────────────────────────────────────────────── */

function Favicon({ s }: { s: WebSource }) {
  const [broken, setBroken] = useState(false);
  if (!s.favicon || broken)
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-white/[0.08] font-mono text-[8px] uppercase text-zinc-400">
        {s.domain[0]}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external favicons, unknown hosts
    <img src={s.favicon} alt="" onError={() => setBroken(true)} className="size-4 shrink-0 rounded-[5px] opacity-80" />
  );
}

function SearchBody({ card, onDismiss }: { card: Extract<SenseCard, { kind: "search" }>; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (card.status === "loading")
    return (
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="size-[5px] animate-hint rounded-full bg-cyan-300/90 shadow-[0_0_8px_1px_rgb(103_232_249/0.5)]" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">reaching the wider world</span>
          <span className="ml-auto">
            <Dismiss onClick={onDismiss} />
          </span>
        </div>
        <p className="mt-2.5 truncate text-[12px] italic text-zinc-500">“{card.query}”</p>
        <div className="mt-3 space-y-2.5">
          <Shimmer w="w-full" />
          <Shimmer w="w-5/6" />
          <Shimmer w="w-2/3" />
        </div>
      </div>
    );
  if (card.status === "error")
    return (
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">the wider world</span>
          <Dismiss onClick={onDismiss} />
        </div>
        <p className="mt-2 text-[12.5px] text-amber-400/90">{card.error ?? "search failed"}</p>
      </div>
    );

  const results = card.results ?? [];
  const wire = card.mode === "wire";
  return (
    <>
      <Eyebrow
        label={wire ? "live wire · exa" : "the wider world · exa"}
        tone="bg-cyan-300/90 shadow-[0_0_8px_1px_rgb(103_232_249/0.5)]"
        right={card.tookMs ? `${(card.tookMs / 1000).toFixed(1)}s` : null}
        onDismiss={onDismiss}
      />
      <p className="mt-1.5 truncate px-4 text-[11.5px] italic text-zinc-500">“{card.query}”</p>

      {card.mode === "empty" && (
        <p className="px-4 pb-4 pt-2 text-[12.5px] text-zinc-400">the web came back empty on this one.</p>
      )}

      {card.answer && (
        <div className="px-4 pt-2">
          <p
            className={`whitespace-pre-line text-[13px] leading-relaxed text-zinc-200 ${expanded ? "" : "line-clamp-6"}`}
          >
            {card.answer}
          </p>
          {card.answer.length > 320 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-300"
            >
              {expanded ? "less" : "more"}
            </button>
          )}
        </div>
      )}

      {/* wire mode: dated headline rows down a timeline rail */}
      {wire && results.length > 0 && (
        <div className="mt-2 flex flex-col px-4 pb-1">
          {results.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="group relative flex gap-3 border-l border-white/[0.09] pb-3 pl-3.5 last:pb-2"
            >
              <span className="absolute -left-[3px] top-[5px] size-[5px] rounded-full bg-cyan-300/70 transition-shadow group-hover:shadow-[0_0_8px_1px_rgb(103_232_249/0.6)]" />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[12.5px] leading-snug text-zinc-200 transition-colors group-hover:text-white">
                  {s.title}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.1em] text-zinc-600">
                  <Favicon s={s} />
                  {s.domain}
                  {ago(s.published) && <span className="text-cyan-300/60">· {ago(s.published)}</span>}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}

      {/* answer mode: the receipts, as chips */}
      {!wire && results.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 px-4">
          {results.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              title={s.title}
              className="glass-chip flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 font-mono text-[9.5px] tracking-[0.08em] text-zinc-400 transition-all hover:border-cyan-300/30 hover:text-zinc-200"
            >
              <Favicon s={s} />
              {s.domain}
              {ago(s.published) && <span className="text-zinc-600">{ago(s.published)}</span>}
            </a>
          ))}
        </div>
      )}
      <div className="pb-3.5" />
    </>
  );
}

/* ── the dock ────────────────────────────────────────────────────── */

export function SenseDock({ cards, onDismiss }: { cards: SenseCard[]; onDismiss: (id: number) => void }) {
  if (!cards.length) return null;
  return (
    <div className="pointer-events-none absolute right-5 top-[72px] z-40 flex w-[344px] max-w-[calc(100vw-2.5rem)] flex-col gap-3 max-sm:inset-x-3 max-sm:bottom-24 max-sm:top-auto max-sm:w-auto max-sm:[&>*:not(:first-child)]:hidden">
      {cards.map((c) => (
        <div key={c.id} className="glass animate-rise pointer-events-auto overflow-hidden rounded-3xl">
          {c.kind === "weather" ? (
            <WeatherBody card={c} onDismiss={() => onDismiss(c.id)} />
          ) : (
            <SearchBody card={c} onDismiss={() => onDismiss(c.id)} />
          )}
        </div>
      ))}
    </div>
  );
}

// ?cards=demo — design QA and demo-video framing without a live session
export const DEMO_CARDS: SenseCard[] = [
  {
    id: 1,
    kind: "search",
    status: "ready",
    query: "what happened with Anthropic today",
    mode: "wire",
    tookMs: 1840,
    results: [
      {
        title: "Anthropic ships Claude agents that plan multi-day work autonomously",
        url: "https://techcrunch.com/",
        domain: "techcrunch.com",
        published: new Date(Date.now() - 2 * 3600_000).toISOString(),
        favicon: null,
        snippet: null,
      },
      {
        title: "Claude's new memory beta remembers across sessions",
        url: "https://theverge.com/",
        domain: "theverge.com",
        published: new Date(Date.now() - 5 * 3600_000).toISOString(),
        favicon: null,
        snippet: null,
      },
      {
        title: "Anthropic valuation talks reported at new high",
        url: "https://reuters.com/",
        domain: "reuters.com",
        published: new Date(Date.now() - 9 * 3600_000).toISOString(),
        favicon: null,
        snippet: null,
      },
    ],
  },
  {
    id: 2,
    kind: "weather",
    status: "ready",
    data: {
      place: "Berlin",
      now: { temp: 21, feels: 19, label: "light rain", scene: "rain", isDay: true, wind: 14, humidity: 72 },
      hours: [
        { t: "14:00", temp: 21, precip: 55 },
        { t: "15:00", temp: 21, precip: 62 },
        { t: "16:00", temp: 20, precip: 70 },
        { t: "17:00", temp: 20, precip: 78 },
        { t: "18:00", temp: 19, precip: 64 },
        { t: "19:00", temp: 19, precip: 40 },
        { t: "20:00", temp: 18, precip: 22 },
        { t: "21:00", temp: 17, precip: 12 },
        { t: "22:00", temp: 17, precip: 8 },
        { t: "23:00", temp: 16, precip: 5 },
        { t: "00:00", temp: 16, precip: 5 },
        { t: "01:00", temp: 15, precip: 4 },
      ],
      rainWindow: "rain likely around 17:00 (78%)",
      today: { hi: 23, lo: 15 },
      tomorrow: { hi: 24, lo: 14, label: "partly cloudy" },
    },
  },
];
