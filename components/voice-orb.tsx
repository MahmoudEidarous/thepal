"use client";

import { useEffect, useRef, useState } from "react";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "thinking";

type Params = {
  energy: number; // boundary deformation amplitude
  speed: number; // flow speed multiplier
  bright: number;
  halo: number;
  gain: number; // how strongly live audio pumps the orb
  a: [number, number, number]; // deep color
  b: [number, number, number]; // mid color
  c: [number, number, number]; // light color
};

const STATES: Record<OrbState, Params> = {
  idle: {
    energy: 0.03,
    speed: 0.4,
    bright: 0.9,
    halo: 0.4,
    gain: 0,
    a: [0.07, 0.09, 0.24],
    b: [0.27, 0.35, 0.8],
    c: [0.7, 0.78, 1.0],
  },
  connecting: {
    energy: 0.06,
    speed: 2.4,
    bright: 1.05,
    halo: 0.52,
    gain: 0,
    a: [0.07, 0.12, 0.38],
    b: [0.22, 0.42, 0.95],
    c: [0.66, 0.8, 1.0],
  },
  listening: {
    energy: 0.055,
    speed: 1.0,
    bright: 1.15,
    halo: 0.62,
    gain: 0.85,
    a: [0.05, 0.11, 0.42],
    b: [0.17, 0.4, 1.0],
    c: [0.62, 0.79, 1.0],
  },
  speaking: {
    energy: 0.095,
    speed: 1.5,
    bright: 1.15,
    halo: 0.68,
    gain: 1.35,
    a: [0.12, 0.08, 0.42],
    b: [0.44, 0.32, 1.0],
    c: [0.85, 0.8, 1.0],
  },
  thinking: {
    energy: 0.08,
    speed: 2.7,
    bright: 1.1,
    halo: 0.56,
    gain: 0.25,
    a: [0.1, 0.07, 0.36],
    b: [0.37, 0.26, 0.9],
    c: [0.73, 0.67, 1.0],
  },
};

const VERT = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;

// Liquid light under glass: simplex-noise displaced boundary, domain-warped
// interior flow, dark refracted edge, crisp rim light and a breathing halo.
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform float u_energy;
uniform float u_bright;
uniform float u_halo;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform vec3 u_colC;

vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p){
  float f = 0.0, w = 0.5;
  for (int i = 0; i < 4; i++){
    f += w * snoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    w *= 0.5;
  }
  return f;
}

void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float r = length(uv);
  vec2 dir = r > 0.0001 ? uv / r : vec2(1.0, 0.0);
  float t = u_time;

  // fluid boundary — low-frequency swell, barely-there ripple
  float n1 = snoise(vec3(dir * 1.1, t * 0.32));
  float n2 = snoise(vec3(dir * 2.4 + 7.3, t * 0.5));
  float radius = 0.56 + u_energy * (0.78 * n1 + 0.09 * n2) + u_level * 0.06;
  float d = r - radius;
  float rr = r / max(radius, 0.001);

  // interior: domain-warped flow, light churning under glass —
  // features kept large and soft so it reads as liquid, not tissue
  vec2 q = uv * 1.25;
  float w1 = fbm(vec3(q, t * 0.18));
  float w2 = fbm(vec3(q + 4.7, t * 0.15 + 2.0));
  float flow = fbm(vec3(q + 1.6 * vec2(w1, w2), t * 0.12));

  vec3 interior = mix(u_colA, u_colB, smoothstep(-0.85, 1.0, flow));
  interior = mix(interior, u_colC, pow(smoothstep(0.2, 1.0, w1), 2.8) * 0.26);

  // luminous core, pumped by the live voice
  interior += u_colC * exp(-r * r * 4.0) * (0.26 + u_level * 0.9);

  // glass depth: the liquid dims as it curves away
  interior *= mix(1.0, 0.48, smoothstep(0.5, 1.05, rr));
  // fresnel — edges catch the light
  interior += u_colB * pow(smoothstep(0.55, 1.0, rr), 3.0) * 0.55;
  interior *= u_bright;

  // rim light — directional, alive, not an outline
  vec2 L = normalize(vec2(-0.45, 0.62));
  float rimShape = 0.3 + 0.7 * pow(max(dot(dir, L), 0.0), 1.6)
                 + 0.22 * snoise(vec3(dir * 2.2, t * 0.25));
  float rim = smoothstep(0.014, 0.0, abs(d)) * clamp(rimShape, 0.0, 1.3);
  vec3 rimCol = mix(u_colC, vec3(1.0), 0.5) * (0.6 + u_level * 0.5);

  // halo: tight bloom + wide breath, faded out before the canvas edge
  float edgeFade = smoothstep(0.99, 0.7, r);
  float halo = exp(-max(d, 0.0) * 4.2) * u_halo * edgeFade;
  float halo2 = exp(-max(d, 0.0) * 1.6) * u_halo * 0.26 * edgeFade;
  vec3 haloCol = mix(u_colB, u_colC, 0.45);

  float inside = smoothstep(0.006, -0.006, d);
  vec3 col = interior * inside + rimCol * rim + haloCol * (halo + halo2) * (1.0 - inside * 0.6);

  // one specular hotspot — the glass surface
  vec2 sp = uv - vec2(-0.2, 0.26);
  col += vec3(1.0) * exp(-dot(sp, sp) * 7.5) * 0.17 * inside;

  float a = clamp(inside + rim + (halo + halo2) * 0.9, 0.0, 1.0);

  // fine grain so gradients never band
  float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (g - 0.5) * 0.018;

  gl_FragColor = vec4(col, a);
}
`;

const lerp = (x: number, y: number, k: number) => x + (y - x) * k;

export function VoiceOrb({
  state,
  getLevel,
  onClick,
  size = 400,
}: {
  state: OrbState;
  getLevel: () => number;
  onClick: () => void;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const getLevelRef = useRef(getLevel);
  const [fallback, setFallback] = useState(false);
  stateRef.current = state;
  getLevelRef.current = getLevel;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    if (!gl) {
      console.warn("orb: WebGL unavailable, using static fallback");
      setFallback(true);
      return;
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("orb shader:", gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setFallback(true);
      return;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = {
      res: U("u_res"),
      time: U("u_time"),
      level: U("u_level"),
      energy: U("u_energy"),
      bright: U("u_bright"),
      halo: U("u_halo"),
      colA: U("u_colA"),
      colB: U("u_colB"),
      colC: U("u_colC"),
    };
    gl.uniform2f(u.res, canvas.width, canvas.height);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // current params, eased toward the active state's targets each frame
    const cur: Params = JSON.parse(JSON.stringify(STATES[stateRef.current]));
    let t = Math.random() * 60;
    let level = 0;
    let last = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const target = STATES[stateRef.current];
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const k = 0.045;
      cur.energy = lerp(cur.energy, target.energy, k);
      cur.speed = lerp(cur.speed, target.speed, k);
      cur.bright = lerp(cur.bright, target.bright, k);
      cur.halo = lerp(cur.halo, target.halo, k);
      cur.gain = lerp(cur.gain, target.gain, k);
      for (let i = 0; i < 3; i++) {
        cur.a[i] = lerp(cur.a[i], target.a[i], k);
        cur.b[i] = lerp(cur.b[i], target.b[i], k);
        cur.c[i] = lerp(cur.c[i], target.c[i], k);
      }

      const raw = Math.min(1, Math.max(0, getLevelRef.current() * 2.3)) * cur.gain;
      level = lerp(level, raw, 0.22);

      // advance flow time by eased speed — state changes shift tempo smoothly
      t += dt * cur.speed * (reduced ? 0.12 : 1);

      gl.uniform1f(u.time, t);
      gl.uniform1f(u.level, reduced ? 0 : level);
      gl.uniform1f(u.energy, cur.energy);
      gl.uniform1f(u.bright, cur.bright);
      gl.uniform1f(u.halo, cur.halo);
      gl.uniform3f(u.colA, cur.a[0], cur.a[1], cur.a[2]);
      gl.uniform3f(u.colB, cur.b[0], cur.b[1], cur.b[2]);
      gl.uniform3f(u.colC, cur.c[0], cur.c[1], cur.c[2]);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={state === "idle" ? "Start talking" : "End the conversation"}
      className="group relative rounded-full outline-offset-8 transition-transform duration-700 hover:scale-[1.015] active:scale-[0.99]"
      style={{ width: size, height: size }}
    >
      {fallback ? (
        <span
          aria-hidden
          className="absolute inset-[18%] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 40% 35%, rgb(200 210 255 / 0.9), rgb(80 100 220 / 0.55) 45%, rgb(20 24 60 / 0.9) 78%)",
            boxShadow: "0 0 120px 30px rgb(90 110 255 / 0.25)",
          }}
        />
      ) : (
        <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden />
      )}
    </button>
  );
}
