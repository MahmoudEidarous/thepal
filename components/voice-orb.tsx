"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "thinking";

type Params = {
  energy: number; // deformation amplitude
  speed: number; // drift speed
  scale: number; // base radius multiplier
  colors: [string, string, string];
  alpha: number;
  levelGain: number; // how strongly live audio pumps the shape
};

const STATES: Record<OrbState, Params> = {
  idle: {
    energy: 0.045,
    speed: 0.28,
    scale: 0.9,
    colors: ["168,182,212", "142,152,190", "112,126,164"],
    alpha: 0.5,
    levelGain: 0,
  },
  connecting: {
    energy: 0.09,
    speed: 1.1,
    scale: 0.92,
    colors: ["96,144,255", "124,108,255", "56,120,255"],
    alpha: 0.5,
    levelGain: 0,
  },
  listening: {
    energy: 0.075,
    speed: 0.45,
    scale: 1,
    colors: ["76,130,255", "104,88,255", "36,99,235"],
    alpha: 0.55,
    levelGain: 0.55,
  },
  speaking: {
    energy: 0.13,
    speed: 0.75,
    scale: 1.04,
    colors: ["86,132,255", "138,92,255", "46,90,255"],
    alpha: 0.62,
    levelGain: 1.15,
  },
  thinking: {
    energy: 0.1,
    speed: 1.5,
    scale: 0.97,
    colors: ["112,100,255", "150,88,255", "72,100,245"],
    alpha: 0.58,
    levelGain: 0.2,
  },
};

const TAU = Math.PI * 2;

// A living form, not a ball: three translucent lobes whose outlines are
// modulated by drifting sine bands (cheap organic noise), composited
// additively so overlaps glow. Live audio level pumps amplitude and scale.
export function VoiceOrb({
  state,
  getLevel,
  onClick,
  size = 320,
}: {
  state: OrbState;
  getLevel: () => number;
  onClick: () => void;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const getLevelRef = useRef(getLevel);
  stateRef.current = state;
  getLevelRef.current = getLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // current params, eased toward the active state's targets each frame
    const cur: Params = JSON.parse(JSON.stringify(STATES[stateRef.current]));
    let level = 0;
    let raf = 0;
    let t = Math.random() * 100;

    // per-lobe phase offsets so the three forms drift independently
    const lobes = [0, 1, 2].map((i) => ({
      p1: Math.random() * TAU,
      p2: Math.random() * TAU,
      p3: Math.random() * TAU,
      f1: 2 + i,
      f2: 3 + ((i * 2) % 4),
      f3: 5 + i,
      dx: (i - 1) * 0.05,
      dy: (i - 1) * -0.04,
    }));

    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    const draw = () => {
      const target = STATES[stateRef.current];
      const k = 0.045;
      cur.energy = lerp(cur.energy, target.energy, k);
      cur.speed = lerp(cur.speed, target.speed, k);
      cur.scale = lerp(cur.scale, target.scale, k);
      cur.alpha = lerp(cur.alpha, target.alpha, k);
      cur.levelGain = lerp(cur.levelGain, target.levelGain, k);
      cur.colors = target.colors;

      const raw = Math.min(1, Math.max(0, getLevelRef.current() * 2.4));
      level = lerp(level, raw, 0.25);

      t += reduced ? 0.002 : 0.006 * cur.speed * 60 * 0.016;

      const c = size / 2;
      const R = size * 0.26 * (cur.scale + level * cur.levelGain * 0.12);
      const amp = cur.energy + level * cur.levelGain * 0.09;

      ctx.clearRect(0, 0, size, size);

      // soft ambient halo behind everything
      const halo = ctx.createRadialGradient(c, c, R * 0.4, c, c, size * 0.5);
      halo.addColorStop(0, `rgba(${cur.colors[0]},${0.16 + level * 0.2})`);
      halo.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      ctx.globalCompositeOperation = "lighter";
      lobes.forEach((l, i) => {
        const cx = c + Math.sin(t * 0.7 + l.p1) * size * l.dx;
        const cy = c + Math.cos(t * 0.5 + l.p2) * size * 0.04 + size * l.dy * 0.4;
        ctx.beginPath();
        const N = 90;
        for (let j = 0; j <= N; j++) {
          const th = (j / N) * TAU;
          const wobble =
            amp * Math.sin(l.f1 * th + t * 1.1 + l.p1) +
            amp * 0.6 * Math.sin(l.f2 * th - t * 0.9 + l.p2) +
            amp * 0.35 * Math.sin(l.f3 * th + t * 1.6 + l.p3);
          const r = R * (1 + wobble);
          const x = cx + Math.cos(th) * r;
          const y = cy + Math.sin(th) * r;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(
          cx - R * 0.25,
          cy - R * 0.3,
          R * 0.1,
          cx,
          cy,
          R * 1.35,
        );
        g.addColorStop(0, `rgba(${cur.colors[i]},${cur.alpha})`);
        g.addColorStop(0.65, `rgba(${cur.colors[i]},${cur.alpha * 0.5})`);
        g.addColorStop(1, `rgba(${cur.colors[i]},0)`);
        ctx.fillStyle = g;
        ctx.fill();
      });

      // specular highlight — gives the mass a surface
      ctx.globalCompositeOperation = "source-over";
      const hl = ctx.createRadialGradient(
        c - R * 0.35,
        c - R * 0.45,
        0,
        c - R * 0.35,
        c - R * 0.45,
        R * 0.9,
      );
      hl.addColorStop(0, `rgba(255,255,255,${0.2 + level * 0.15})`);
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(c, c, R * 1.15, 0, TAU);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === "idle" ? "Wake Recall" : "End the conversation"}
      className="group relative rounded-full outline-offset-8 transition-transform duration-500 hover:scale-[1.02] active:scale-[0.99]"
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden />
    </button>
  );
}
