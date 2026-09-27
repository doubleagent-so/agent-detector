import type { TraceEvent } from '../src/behavior/trace.ts';

/** Deterministic PRNG for reproducible synthetic traces. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

/** Human desktop: curved, jittery mouse paths with coalesced samples, scattered clicks, variable typing, wheel scroll. */
export function humanDesktop(seed = 1, durationMs = 30000): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 600 + r() * 800, x = 400, y = 300, sy = 0;
  while (t < durationMs) {
    // move toward a target with a curved path
    const tx = 100 + r() * 1000, ty = 100 + r() * 600;
    const steps = 20 + Math.floor(r() * 25);
    const bend = (r() - 0.5) * 120;
    for (let i = 1; i <= steps; i++) {
      const p = i / steps, ease = p * p * (3 - 2 * p);
      const nx = x + (tx - x) * ease + Math.sin(p * Math.PI) * bend + gauss(r) * 1.5;
      const ny = y + (ty - y) * ease + Math.cos(p * Math.PI) * bend * 0.3 + gauss(r) * 1.5;
      t += 16.7 + gauss(r) * 2;
      ev.push({ k: 'mv', t, x: nx, y: ny, pt: 'm', co: 2 + Math.floor(r() * 5) });
    }
    x = tx; y = ty;
    const roll = r();
    if (roll < 0.5) {
      t += 80 + r() * 200;
      ev.push({ k: 'dn', t, x, y, pt: 'm', ox: gauss(r) * 0.18, oy: gauss(r) * 0.2, w: 120, h: 36 });
      t += 70 + r() * 80;
      ev.push({ k: 'up', t, pt: 'm' });
      ev.push({ k: 'ck', t: t + 1, x, y, d: 1 });
    } else if (roll < 0.75) {
      ev.push({ k: 'fo', t: t - 5 });
      const n = 8 + Math.floor(r() * 12);
      for (let i = 0; i < n; i++) {
        t += 90 + r() * 180 + (r() < 0.1 ? 400 : 0);
        const ks = Math.floor(r() * 40);
        ev.push({ k: 'kd', t, ks, sp: r() < 0.05 ? 'b' : undefined });
        ev.push({ k: 'in', t: t + 1, it: 't', n: 1 });
        ev.push({ k: 'ku', t: t + 60 + r() * 60, ks });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        t += 30 + r() * 40;
        const dy = Math.round((20 + r() * 60) * 100) / 100 + 0.37;
        sy += dy;
        ev.push({ k: 'wh', t, dy, dm: 0 });
        ev.push({ k: 'sc', t: t + 2, sy: Math.round(sy), h: 800 });
      }
      ev.push({ k: 'se', t: t + 2, sy: Math.round(sy), h: 800 });
    }
    // reading pause with micro-movement
    const pause = 500 + r() * 3500;
    const end = t + pause;
    while (t < end) { t += 200 + r() * 400; x += gauss(r) * 3; y += gauss(r) * 3; ev.push({ k: 'mv', t, x, y, pt: 'm', co: 3 }); }
  }
  return ev.sort((a, b) => a.t - b.t);
}

/**
 * LLM browser agent driving a real Chrome via CDP (Claude in Chrome / Atlas / Browser Use style):
 * long think gaps with zero motion, teleport clicks at element centre, insertText without keys,
 * programmatic scrolls, CDP screen coordinate artefact.
 */
export function aiAgent(seed = 2, durationMs = 45000, opts: { screenBug?: boolean } = {}): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 1500;
  while (t < durationMs) {
    t += 3000 + r() * 7000; // think time
    const x = Math.round(200 + r() * 800), y = Math.round(150 + r() * 500);
    const roll = r();
    if (roll < 0.55) {
      ev.push({ k: 'mv', t, x, y, pt: 'm', co: 1, sxm: opts.screenBug || undefined });
      ev.push({ k: 'dn', t: t + 1, x, y, pt: 'm', ox: 0, oy: 0, w: 140, h: 40, sxm: opts.screenBug || undefined });
      ev.push({ k: 'up', t: t + 2, pt: 'm' });
      ev.push({ k: 'ck', t: t + 3, x, y, d: 1 });
    } else if (roll < 0.8) {
      ev.push({ k: 'dn', t, x, y, pt: 'm', ox: 0.004, oy: -0.01, w: 300, h: 40 });
      ev.push({ k: 'up', t: t + 1, pt: 'm' });
      ev.push({ k: 'fo', t: t + 2 });
      ev.push({ k: 'in', t: t + 20, it: 't', n: 18 + Math.floor(r() * 20) });
    } else {
      ev.push({ k: 'sc', t });
      ev.push({ k: 'sc', t: t + 60 });
      ev.push({ k: 'sc', t: t + 120 });
    }
  }
  return ev;
}

/** Scripted bot (Puppeteer-style): instant start, linear interpolated moves dispatched in bursts, uniform typing. */
export function scriptedBot(seed = 3): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 120;
  for (let k = 0; k < 6; k++) {
    const x0 = r() * 800, y0 = r() * 500, x1 = r() * 800, y1 = r() * 500;
    for (let i = 0; i <= 20; i++) { t += 1; ev.push({ k: 'mv', t, x: x0 + ((x1 - x0) * i) / 20, y: y0 + ((y1 - y0) * i) / 20, pt: 'm', co: 1 }); }
    ev.push({ k: 'dn', t: t + 1, x: x1, y: y1, pt: 'm', ox: 0, oy: 0, w: 100, h: 30 });
    ev.push({ k: 'up', t: t + 1, pt: 'm' });
    t += 200;
  }
  for (let i = 0; i < 15; i++) { t += 10; ev.push({ k: 'kd', t, ks: i }); ev.push({ k: 'in', t, it: 't', n: 1 }); ev.push({ k: 'ku', t: t + 5, ks: i }); }
  return ev;
}

/** Mobile human: touches with drift and variable force, no mouse. */
export function humanMobile(seed = 4): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 900;
  for (let i = 0; i < 14; i++) {
    t += 800 + r() * 4000;
    const x = r() * 380, y = r() * 800;
    ev.push({ k: 'ts', t, x, y, f: 0.3 + r() * 0.4, r: 10 + r() * 8 });
    for (let j = 0; j < 5; j++) ev.push({ k: 'tm', t: t + j * 16, x: x + j * 3, y: y - j * 25 });
    ev.push({ k: 'te', t: t + 120, x: x + 2 + r() * 3, y: y - 90 });
    ev.push({ k: 'sc', t: t + 130 });
  }
  return ev;
}

/** BeCAPTCHA-Mouse function-based bot (§3.2.1): path shape × speed profile, sampled at 60 Hz, no noise. */
export function functionBot(seed = 5, shape: 'linear' | 'quadratic' | 'exponential' = 'quadratic', speed: 'constant' | 'log' | 'gauss' = 'constant'): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 800;
  for (let k = 0; k < 8; k++) {
    const x0 = 100 + r() * 900, y0 = 100 + r() * 500, x1 = 100 + r() * 900, y1 = 100 + r() * 500;
    const n = 25 + Math.floor(r() * 15);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const s = speed === 'constant' ? u : speed === 'log' ? u * u : (1 - Math.cos(Math.PI * u)) / 2;
      const bend = shape === 'linear' ? 0 : shape === 'quadratic' ? 4 * s * (1 - s) : (Math.exp(3 * s) - 1) / (Math.exp(3) - 1) - s;
      t += 16.7;
      ev.push({ k: 'mv', t, x: x0 + (x1 - x0) * s - (y1 - y0) * bend * 0.25, y: y0 + (y1 - y0) * s + (x1 - x0) * bend * 0.25, pt: 'm', co: 1 });
    }
    t += 120; ev.push({ k: 'dn', t, x: x1, y: y1, pt: 'm', ox: 0.1, oy: -0.1, w: 120, h: 36 });
    t += 90; ev.push({ k: 'up', t, pt: 'm' });
    t += 400 + r() * 600;
  }
  return ev;
}

/** ghost-cursor style bot: cubic Bézier paths, uniform steps at 60 Hz, no noise, scattered click offsets. */
export function bezierBot(seed = 6): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 900, x = 400, y = 300;
  for (let k = 0; k < 8; k++) {
    const tx = 100 + r() * 1000, ty = 100 + r() * 600;
    const spread = (0.2 + r() * 0.3) * (r() < 0.5 ? -1 : 1);
    const c1 = { x: x + (tx - x) * 0.3 - (ty - y) * spread, y: y + (ty - y) * 0.3 + (tx - x) * spread };
    const c2 = { x: x + (tx - x) * 0.7 - (ty - y) * spread, y: y + (ty - y) * 0.7 + (tx - x) * spread };
    const n = 30 + Math.floor(r() * 20);
    for (let i = 1; i <= n; i++) {
      const u = i / n, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, c = 3 * (1 - u) * u * u, d = u ** 3;
      t += 16.7;
      ev.push({ k: 'mv', t, x: a * x + b * c1.x + c * c2.x + d * tx, y: a * y + b * c1.y + c * c2.y + d * ty, pt: 'm', co: 1 });
    }
    x = tx; y = ty;
    t += 150; ev.push({ k: 'dn', t, x, y, pt: 'm', ox: (r() - 0.5) * 0.4, oy: (r() - 0.5) * 0.4, w: 120, h: 36 });
    t += 80 + r() * 40; ev.push({ k: 'up', t, pt: 'm' });
    t += 600 + r() * 900;
  }
  return ev;
}

/** Vision-driven agent (FP-Agent: Atlas / Claude / ChatGPT Agent): think gaps, teleport clicks, identical wheel steps. */
export function visionAgent(seed = 7, durationMs = 90000): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 2000, sy = 0;
  ev.push({ k: 'sc', t: 1200, sy, h: 800 }, { k: 'se', t: 1200, sy, h: 800 });
  while (t < durationMs) {
    t += 2500 + r() * 4000;
    if (r() < 0.5) {
      sy += 500;
      ev.push({ k: 'wh', t, dy: 500, dm: 0 }, { k: 'sc', t: t + 8, sy, h: 800 }, { k: 'se', t: t + 8, sy, h: 800 });
    } else {
      const x = Math.round(200 + r() * 800), y = Math.round(150 + r() * 500);
      ev.push({ k: 'mv', t, x, y, pt: 'm', co: 1 }, { k: 'dn', t: t + 60, x, y, pt: 'm', ox: 0.01, oy: 0, w: 140, h: 40 }, { k: 'up', t: t + 140, pt: 'm' });
    }
  }
  return ev;
}

/** Agent that fills fields from page script (FP-Agent: Claude's change-event filling). */
export function jsFillAgent(seed = 8): TraceEvent[] {
  const r = rng(seed);
  const ev: TraceEvent[] = [];
  let t = 2500;
  for (let f = 0; f < 4; f++) {
    t += 1500 + r() * 3000;
    ev.push({ k: 'iv', t, fs: 100 + f, u: true }, { k: 'ch', t: t + 1, fs: 100 + f, u: true });
  }
  t += 2000;
  ev.push({ k: 'dn', t, x: 600, y: 500, pt: 'm', ox: 0, oy: 0, w: 140, h: 40 }, { k: 'up', t: t + 1, pt: 'm' });
  return ev;
}
