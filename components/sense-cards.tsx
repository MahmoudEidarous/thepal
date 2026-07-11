"use client";

// Sense cards — when the orb looks at the world, the evidence
// materializes here. A weather card is a living miniature sky set into
// the glass like a window; a search card is a dispatch from the wider
// world with its receipts attached. Desktop: a dock below the header,
// top right. Mobile: newest card only, docked above the controls.

import { useEffect, useId, useRef, useState } from "react";
import type { Weather } from "@/lib/senses";

export type WebSource = {
  title: string;
  url: string;
  domain: string;
  published: string | null;
  favicon: string | null;
  snippet: string | null;
};

// what the write envelope stamped on a capture — shown, then gone
export type FiledEnvelope = {
  type: string;
  due: string | null;
  storyDate: string | null;
  salience: number;
  entities: Array<{ name: string; kind: string }>;
  commitments: Array<{ content: string; due: string | null }>;
};

export type Receipt = { text: string; told: string | null };

export type SenseCard =
  | { id: number; kind: "weather"; status: "loading" | "ready" | "error"; data?: Weather; error?: string; ttl?: number }
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
      ttl?: number;
    }
  | {
      id: number;
      kind: "filed";
      status: "loading" | "ready" | "error";
      text: string;
      envelope?: FiledEnvelope;
      error?: string;
      ttl?: number;
    }
  | { id: number; kind: "receipts"; status: "ready"; hits: Receipt[]; ttl?: number };

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

// the wire column speaks in dispatch shorthand: 34m, 5h, 2d, Jul 8
function wireAgo(iso: string | null) {
  if (!iso) return null;
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 90) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// The dismiss only surfaces when the pointer arrives — cards should read
// as objects, not dialogs. Touch screens keep it visible.
function Dismiss({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Dismiss card"
      className="-m-1.5 rounded-full p-1.5 text-zinc-600 opacity-0 transition-[color,opacity] duration-200 focus-visible:opacity-100 group-hover:opacity-100 hover:text-zinc-200 max-sm:opacity-100"
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
    <div className="flex items-center gap-2 px-4 pt-3">
      <span className={`size-[5px] animate-hint rounded-full ${tone}`} />
      <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">{label}</span>
      <span className="ml-auto font-mono text-[9.5px] tabular-nums tracking-[0.14em] text-zinc-600">{right}</span>
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
      className="relative h-[112px] overflow-hidden"
      style={{ background: `linear-gradient(180deg, ${top}, ${bottom})` }}
      aria-hidden
    >
      {/* sun / moon */}
      {(scene === "clear" || scene === "partly") && isDay && (
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

      {/* rain — two sparse streak fields at different depths, so the
          still frame reads as falling drops rather than a hatch fill */}
      {raining && (
        <>
          <div
            className={`absolute inset-0 ${scene === "drizzle" ? "animate-rain opacity-30 [animation-duration:1.6s]" : "animate-rain opacity-70"}`}
            style={{
              backgroundImage:
                "linear-gradient(100deg, transparent 47.5%, rgb(185 205 255 / 0.55) 50%, transparent 52.5%)",
              backgroundSize: scene === "drizzle" ? "17px 26px" : "23px 42px",
            }}
          />
          <div
            className={`absolute inset-0 ${scene === "drizzle" ? "animate-rain opacity-20 [animation-duration:2.1s]" : "animate-rain opacity-40 [animation-duration:1.15s]"}`}
            style={{
              backgroundImage:
                "linear-gradient(100deg, transparent 48%, rgb(185 205 255 / 0.4) 50%, transparent 52%)",
              backgroundSize: scene === "drizzle" ? "29px 34px" : "37px 58px",
              backgroundPosition: "11px 7px",
            }}
          />
        </>
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
      <div className="absolute inset-x-0 bottom-0 h-[68px] bg-gradient-to-t from-black/50 to-transparent" />
      <div className="absolute bottom-3 left-3.5 flex items-end gap-2.5">
        <span className="text-[42px] font-extralight leading-none tracking-tight text-white tabular-nums [text-shadow:0_2px_16px_rgb(0_0_0/0.6)]">
          {w.now.temp}°
        </span>
        <div className="pb-0.5">
          <p className="text-[12.5px] font-medium capitalize leading-tight text-zinc-100">{w.now.label}</p>
          <p className="mt-px text-[10.5px] leading-tight text-zinc-400 tabular-nums">
            feels {w.now.feels}° · wind {w.now.wind} km/h
          </p>
        </div>
      </div>
    </div>
  );
}

// Catmull-Rom through the hourly temps — a hand-drawn line, not a polyline
function smoothPath(pts: Array<[number, number]>): string {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function Sparkline({ w }: { w: Weather }) {
  const fillId = useId();
  const hs = w.hours;
  if (hs.length < 2) return null;
  const W = 296;
  const H = 40;
  const temps = hs.map((h) => h.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = Math.max(max - min, 2);
  const x = (i: number) => 4 + (i / (hs.length - 1)) * (W - 8);
  const y = (t: number) => 8 + (1 - (t - min) / span) * (H - 18);
  const pts = hs.map((h, i) => [x(i), y(h.temp)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L${x(hs.length - 1).toFixed(1)},${H - 2} L${x(0).toFixed(1)},${H - 2} Z`;
  return (
    <div className="px-4 pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full" aria-hidden>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(236 236 241 / 0.13)" />
            <stop offset="100%" stopColor="rgb(236 236 241 / 0)" />
          </linearGradient>
        </defs>
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
              fill="rgb(103 195 241 / 0.26)"
            />
          ) : null,
        )}
        <path d={area} fill={`url(#${fillId})`} />
        <path d={line} fill="none" stroke="rgb(236 236 241 / 0.75)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={x(0)} cy={y(hs[0].temp)} r="2.6" fill="#ececf1" />
      </svg>
      <div className="flex justify-between font-mono text-[9px] tracking-[0.12em] text-zinc-600 tabular-nums">
        <span>now</span>
        <span>{hs[Math.floor(hs.length / 2)].t}</span>
        <span>{hs[hs.length - 1].t}</span>
      </div>
    </div>
  );
}

function DropIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-sky-300/80">
      <path d="M12 3.5c3.2 4.2 6 7.4 6 10.7a6 6 0 1 1-12 0c0-3.3 2.8-6.5 6-10.7Z" />
    </svg>
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
      {/* the sky sits inset in the glass, like a window */}
      <div className="relative mx-3 mt-2.5 overflow-hidden rounded-2xl shadow-[0_4px_20px_-8px_rgb(0_0_0/0.7)]">
        <Sky w={w} />
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/[0.09]" />
      </div>
      <Sparkline w={w} />
      <div className="mx-4 mb-3.5 mt-3 flex items-center gap-4">
        <div className="shrink-0">
          <p className="font-mono text-[8.5px] uppercase tracking-[0.24em] text-zinc-600">today</p>
          <p className="mt-0.5 text-[13px] text-zinc-200 tabular-nums">
            {w.today.hi}°<span className="text-zinc-500"> / {w.today.lo}°</span>
          </p>
        </div>
        <div className="h-7 w-px shrink-0 bg-white/[0.07]" />
        <div className="min-w-0">
          <p className="font-mono text-[8.5px] uppercase tracking-[0.24em] text-zinc-600">tomorrow</p>
          <p className="mt-0.5 truncate text-[13px] text-zinc-200 tabular-nums">
            {w.tomorrow.hi}°<span className="text-zinc-500"> / {w.tomorrow.lo}°</span>
            <span className="ml-2 text-[11.5px] capitalize text-zinc-400">{w.tomorrow.label}</span>
          </p>
        </div>
      </div>
      {w.rainWindow && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-xl bg-sky-400/[0.08] px-3 py-2 ring-1 ring-inset ring-sky-300/[0.12]">
          <DropIcon />
          <p className="text-[11px] leading-tight text-sky-200/90">{w.rainWindow}</p>
        </div>
      )}
    </>
  );
}

/* ── the wider world ─────────────────────────────────────────────── */

function Favicon({ s }: { s: WebSource }) {
  const [broken, setBroken] = useState(false);
  if (!s.favicon || broken)
    return (
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-[4px] bg-white/[0.08] font-mono text-[8px] uppercase text-zinc-400 ring-1 ring-inset ring-white/[0.08]">
        {s.domain[0]}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external favicons, unknown hosts
    <img src={s.favicon} alt="" onError={() => setBroken(true)} className="size-[15px] shrink-0 rounded-[4px] opacity-85 ring-1 ring-inset ring-white/[0.08]" />
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
        <p className="mt-2.5 truncate text-[11.5px] text-zinc-500">“{card.query}”</p>
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
      <p className="mt-1.5 truncate px-4 text-[11.5px] text-zinc-500">“{card.query}”</p>

      {card.mode === "empty" && (
        <p className="px-4 pb-4 pt-2 text-[12.5px] text-zinc-400">the web came back empty on this one.</p>
      )}

      {card.answer && (
        <div className="px-4 pt-2.5">
          <p
            className={`whitespace-pre-line text-[13px] leading-relaxed text-zinc-200 ${expanded ? "" : "line-clamp-6"}`}
          >
            {card.answer}
          </p>
          {card.answer.length > 320 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-zinc-500 transition-colors hover:text-zinc-300"
            >
              {expanded ? "less" : "more"}
            </button>
          )}
        </div>
      )}

      {/* wire mode: dispatches off a press wire — a time column on the
          left, headlines arriving under hairlines, oldest last */}
      {wire && results.length > 0 && (
        <div className="mt-2.5 flex flex-col divide-y divide-white/[0.05] border-t border-white/[0.06]">
          {results.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="row-in group/row flex gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.035]"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <span className="w-9 shrink-0 pt-px text-right font-mono text-[10px] tracking-[0.06em] text-cyan-300/70 tabular-nums">
                {wireAgo(s.published) ?? "—"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[12.5px] font-[450] leading-snug text-zinc-200 transition-colors group-hover/row:text-white">
                  {s.title}
                </span>
                <span className="mt-1 flex items-center gap-1.5">
                  <Favicon s={s} />
                  <span className="truncate font-mono text-[9.5px] tracking-[0.08em] text-zinc-600">{s.domain}</span>
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
              className="glass-chip flex items-center gap-1.5 rounded-full py-[5px] pl-1.5 pr-2.5 font-mono text-[9.5px] tracking-[0.08em] text-zinc-400 transition-all hover:border-cyan-300/30 hover:text-zinc-200"
            >
              <Favicon s={s} />
              {s.domain}
              {ago(s.published) && <span className="text-zinc-600 tabular-nums">{ago(s.published)}</span>}
            </a>
          ))}
        </div>
      )}
      <div className={wire ? "pb-1" : "pb-3.5"} />
    </>
  );
}

/* ── the pipeline, visible ───────────────────────────────────────── */

// same palette the brain page gives each memory type
export const TYPE_TONES: Record<string, string> = {
  fact: "#6C9BF0",
  event: "#62B7E6",
  taste: "#EF7FB4",
  decision: "#52C79A",
  commitment: "#F2B03D",
  boundary: "#E9805E",
  safety: "#F05252",
  impression: "#A78BFA",
  memory: "#8B96B3",
};

function KindGlyph({ kind }: { kind: string }) {
  const common = {
    width: 9,
    height: 9,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "person")
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20.5c1.5-3.5 4.2-5 7.5-5s6 1.5 7.5 5" />
      </svg>
    );
  if (kind === "place")
    return (
      <svg {...common}>
        <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" />
        <circle cx="12" cy="10" r="2.4" />
      </svg>
    );
  if (kind === "thread")
    return (
      <svg {...common}>
        <path d="M4 17c4-1 5-8 9-9 3.2-.8 6 1 7 4" />
        <circle cx="4.5" cy="17.5" r="1.6" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="5" y="5" width="14" height="14" rx="3" />
    </svg>
  );
}

const shortDue = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function FiledBody({ card, onDismiss }: { card: Extract<SenseCard, { kind: "filed" }>; onDismiss: () => void }) {
  if (card.status === "loading")
    return (
      <div className="p-4">
        <div className="flex items-center gap-2">
          <span className="size-[5px] animate-hint rounded-full bg-indigo-300/90 shadow-[0_0_8px_1px_rgb(165_180_252/0.5)]" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">filing</span>
          <span className="ml-auto">
            <Dismiss onClick={onDismiss} />
          </span>
        </div>
        <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-relaxed text-zinc-400">{card.text}</p>
        <div className="mt-2.5">
          <Shimmer w="w-1/2" />
        </div>
      </div>
    );
  if (card.status === "error" || !card.envelope)
    return (
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">kept raw</span>
          <Dismiss onClick={onDismiss} />
        </div>
        <p className="mt-2 line-clamp-2 text-[12.5px] text-zinc-300">{card.text}</p>
        <p className="mt-1.5 text-[11px] text-amber-400/80">the words are safe — enrichment will catch up</p>
      </div>
    );
  const e = card.envelope;
  const tone = TYPE_TONES[e.type] ?? TYPE_TONES.memory;
  const bright = e.salience >= 0.7;
  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3">
        <span
          className="size-[5px] rounded-full"
          style={{
            background: tone,
            boxShadow: bright ? `0 0 9px 2px ${tone}88` : `0 0 5px 0 ${tone}44`,
            opacity: bright ? 1 : 0.75,
          }}
        />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">
          filed · {e.type}
        </span>
        <span className="ml-auto font-mono text-[9.5px] tabular-nums tracking-[0.14em] text-zinc-600">
          {e.storyDate ?? null}
        </span>
        <Dismiss onClick={onDismiss} />
      </div>
      <p className="mt-2 line-clamp-3 px-4 text-[12.5px] leading-relaxed text-zinc-200">{card.text}</p>
      {(e.due || e.entities.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-4">
          {e.due && (
            <span className="flex items-center gap-1 rounded-full bg-amber-300/[0.09] py-[3px] pl-2 pr-2.5 font-mono text-[9.5px] tracking-[0.08em] text-amber-200/90 ring-1 ring-inset ring-amber-300/[0.18] tabular-nums">
              due {shortDue(e.due)}
            </span>
          )}
          {e.entities.slice(0, 4).map((en, i) => (
            <span
              key={i}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.05] py-[3px] pl-2 pr-2.5 font-mono text-[9.5px] tracking-[0.06em] text-zinc-400 ring-1 ring-inset ring-white/[0.08]"
            >
              <KindGlyph kind={en.kind} />
              {en.name}
            </span>
          ))}
        </div>
      )}
      {e.commitments.length > 0 && (
        <p className="mt-2 px-4 font-mono text-[9.5px] uppercase tracking-[0.18em] text-amber-200/70">
          +{e.commitments.length} commitment{e.commitments.length > 1 ? "s" : ""} → ledger
        </p>
      )}
      <div className="pb-3.5" />
    </>
  );
}

function ReceiptsBody({ card, onDismiss }: { card: Extract<SenseCard, { kind: "receipts" }>; onDismiss: () => void }) {
  const shown = card.hits.slice(0, 4);
  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="size-[5px] rounded-full bg-zinc-400/70" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.26em] text-zinc-500">
          drew on {card.hits.length} {card.hits.length === 1 ? "memory" : "memories"}
        </span>
        <span className="ml-auto">
          <Dismiss onClick={onDismiss} />
        </span>
      </div>
      <div className="mt-1.5 flex flex-col divide-y divide-white/[0.04] pb-2.5">
        {shown.map((h, i) => (
          <div key={i} className="flex items-baseline gap-3 px-4 py-[7px]">
            <p className="min-w-0 flex-1 truncate text-[11.5px] leading-relaxed text-zinc-500">{h.text}</p>
            {h.told && (
              <span className="shrink-0 font-mono text-[9px] tracking-[0.08em] text-zinc-700 tabular-nums">
                {h.told.slice(0, 10)}
              </span>
            )}
          </div>
        ))}
        {card.hits.length > shown.length && (
          <p className="px-4 pt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-700">
            and {card.hits.length - shown.length} more
          </p>
        )}
      </div>
    </>
  );
}

/* ── the dock ────────────────────────────────────────────────────── */

// Ephemeral cards (filed, receipts) carry a ttl and dissolve on their
// own once they're done loading; a pointer resting on the card holds it.
function DockItem({
  card,
  leaving,
  dismiss,
}: {
  card: SenseCard;
  leaving: boolean;
  dismiss: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settled = card.status !== "loading";

  useEffect(() => {
    if (!card.ttl || !settled) return;
    timer.current = setTimeout(dismiss, card.ttl);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.ttl, settled]);

  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const release = () => {
    if (card.ttl && settled) timer.current = setTimeout(dismiss, 2_500);
  };

  return (
    <div
      onMouseEnter={hold}
      onMouseLeave={release}
      className={`glass group pointer-events-auto overflow-hidden rounded-3xl ${
        leaving ? "card-out" : "card-in"
      }`}
    >
      {card.kind === "weather" ? (
        <WeatherBody card={card} onDismiss={dismiss} />
      ) : card.kind === "search" ? (
        <SearchBody card={card} onDismiss={dismiss} />
      ) : card.kind === "filed" ? (
        <FiledBody card={card} onDismiss={dismiss} />
      ) : (
        <ReceiptsBody card={card} onDismiss={dismiss} />
      )}
    </div>
  );
}

export function SenseDock({ cards, onDismiss }: { cards: SenseCard[]; onDismiss: (id: number) => void }) {
  // dismissal dissolves the card before it leaves the tree
  const [leaving, setLeaving] = useState<number[]>([]);
  if (!cards.length) return null;
  const dismiss = (id: number) => {
    if (leaving.includes(id)) return;
    setLeaving((l) => [...l, id]);
    setTimeout(() => {
      setLeaving((l) => l.filter((x) => x !== id));
      onDismiss(id);
    }, 230);
  };
  return (
    <div className="pointer-events-none absolute right-5 top-[72px] z-40 flex w-[344px] max-w-[calc(100vw-2.5rem)] flex-col gap-3 max-sm:inset-x-3 max-sm:bottom-24 max-sm:top-auto max-sm:w-auto max-sm:[&>*:not(:first-child)]:hidden">
      {cards.map((c) => (
        <DockItem key={c.id} card={c} leaving={leaving.includes(c.id)} dismiss={() => dismiss(c.id)} />
      ))}
    </div>
  );
}

// ?cards=demo — design QA and demo-video framing without a live session
export const DEMO_CARDS: SenseCard[] = [
  {
    id: 3,
    kind: "filed",
    status: "ready",
    text: "Dinner with Layla at the new Syrian place on Sonnenallee next Friday at 8.",
    envelope: {
      type: "commitment",
      due: "2026-07-17",
      storyDate: null,
      salience: 0.72,
      entities: [
        { name: "Layla", kind: "person" },
        { name: "Sonnenallee", kind: "place" },
      ],
      commitments: [],
    },
  },
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
