import type { Signal } from '../types.ts';
import { mean, median, r3 } from './stats.ts';
import type { TraceEvent } from './trace.ts';

export interface Pt { x: number; y: number; t: number }

/** Split mouse moves into runs at pauses longer than `gapMs`. */
export function segmentMoves(moves: readonly TraceEvent[], gapMs = 150, minPoints = 5): TraceEvent[][] {
  const out: TraceEvent[][] = [];
  let cur: TraceEvent[] = [];
  for (const m of moves) {
    if (m.x === undefined) continue;
    if (cur.length && m.t - cur[cur.length - 1].t > gapMs) { if (cur.length >= minPoints) out.push(cur); cur = []; }
    cur.push(m);
  }
  if (cur.length >= minPoints) out.push(cur);
  return out;
}

/** Mean perpendicular deviation (px) of points from the segment chord. */
export function perpDeviation(s: TraceEvent[]): number {
  const a = s[0], b = s[s.length - 1];
  const dx = b.x! - a.x!, dy = b.y! - a.y!;
  const len = Math.hypot(dx, dy) || 1;
  let sum = 0;
  for (const p of s) sum += Math.abs(dy * (p.x! - a.x!) - dx * (p.y! - a.y!)) / len;
  return sum / s.length;
}

/** Points with repeated coordinates removed. */
export function points(seg: readonly TraceEvent[]): Pt[] {
  const out: Pt[] = [];
  for (const e of seg) {
    const p = out[out.length - 1];
    if (p && p.x === e.x && p.y === e.y) continue;
    out.push({ x: e.x!, y: e.y!, t: e.t });
  }
  return out;
}

export function pathLength(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return s;
}

/** Angle ABC in degrees; 180 is straight on (FP-Agent "angle of curvature"). */
export function curvatureAngle(a: Pt, b: Pt, c: Pt): number {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) + 1e-9);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Distance of B from line AC as a fraction of |AC| (FP-Agent "curvature distance"). */
export function curvatureDistance(a: Pt, b: Pt, c: Pt): number {
  const len = Math.hypot(c.x - a.x, c.y - a.y);
  if (len < 1e-9) return 0;
  return Math.abs((c.x - a.x) * (a.y - b.y) - (c.y - a.y) * (a.x - b.x)) / len / len;
}

/** Sign changes of the turn direction along a path, ignoring turns under ~0.5°. */
export function turnFlips(p: readonly Pt[]): number {
  let flips = 0, last = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const ax = p[i].x - p[i - 1].x, ay = p[i].y - p[i - 1].y, bx = p[i + 1].x - p[i].x, by = p[i + 1].y - p[i].y;
    const sin = (ax * by - ay * bx) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-9);
    if (Math.abs(sin) < 0.009) continue;
    const sign = Math.sign(sin);
    if (last && sign !== last) flips++;
    last = sign;
  }
  return flips;
}

/**
 * Curvature and direction (FP-Agent §5.3.3), plus smooth-curve detection: generated curves (Bézier humanisers,
 * BeCAPTCHA function-based paths) bend one way throughout; human paths keep reversing through micro-corrections.
 */
export function curvatureFeatures(runs: readonly Pt[][]): { signals: Signal[]; vector: Record<string, number> } {
  const signals: Signal[] = [];
  const angleMeans: number[] = [], angleRanges: number[] = [], dists: number[] = [];
  const bins = new Array<number>(8).fill(0);
  let curved = 0, smooth = 0;
  for (const p of runs) {
    const path = pathLength(p);
    if (p.length < 3 || path < 60) continue;
    const angles: number[] = [];
    for (let i = 1; i < p.length - 1; i++) {
      angles.push(curvatureAngle(p[i - 1], p[i], p[i + 1]));
      dists.push(curvatureDistance(p[i - 1], p[i], p[i + 1]));
    }
    for (let i = 1; i < p.length; i++) {
      const a = Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x);
      bins[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]++;
    }
    angleMeans.push(mean(angles));
    angleRanges.push(Math.max(...angles) - Math.min(...angles));
    const straightness = Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) / path;
    if (p.length >= 15 && path >= 100 && straightness > 0.6 && straightness < 0.99) {
      curved++;
      if (turnFlips(p) === 0) smooth++;
    }
  }
  if (!angleMeans.length) return { signals, vector: {} };
  const total = bins.reduce((s, x) => s + x, 0);
  const entropy = -bins.filter((n) => n > 0).reduce((s, n) => s + (n / total) * Math.log(n / total), 0) / Math.log(8);
  const vector = {
    curv_angle_mean: r3(mean(angleMeans)),
    curv_angle_range: r3(median(angleRanges)),
    curv_dist_mean: r3(mean(dists)),
    move_dir_entropy: r3(entropy),
  };
  if (curved >= 4 && smooth / curved >= 0.8) signals.push({ code: 'bio.smooth_synthetic_curve', group: 'C', target: 'both', llr: 1.5, detail: `${smooth}/${curved} curved paths with no micro-corrections` });
  return { signals, vector };
}
