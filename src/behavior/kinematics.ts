import type { Signal } from '../types.ts';
import { mean, median, r3 } from './stats.ts';
import type { TraceEvent } from './trace.ts';

export interface Pt { x: number; y: number; t: number }

/** Split mouse moves into runs at pauses longer than `gapMs`. */
export function segmentMoves(moves: readonly TraceEvent[], gapMs = 150, minPoints = 5): TraceEvent[][] {
  const out: TraceEvent[][] = [];
  let cur: TraceEvent[] = [];
  for (const move of moves) {
    if (move.x === undefined) continue;
    if (cur.length && move.t - cur[cur.length - 1].t > gapMs) { if (cur.length >= minPoints) out.push(cur); cur = []; }
    cur.push(move);
  }
  if (cur.length >= minPoints) out.push(cur);
  return out;
}

/** Mean perpendicular deviation (px) of points from the segment chord. */
export function perpDeviation(segment: TraceEvent[]): number {
  const start = segment[0], end = segment[segment.length - 1];
  const dx = end.x! - start.x!, dy = end.y! - start.y!;
  const len = Math.hypot(dx, dy) || 1;
  let sum = 0;
  for (const point of segment) sum += Math.abs(dy * (point.x! - start.x!) - dx * (point.y! - start.y!)) / len;
  return sum / segment.length;
}

/** Points with repeated coordinates removed. */
export function points(seg: readonly TraceEvent[]): Pt[] {
  const out: Pt[] = [];
  for (const event of seg) {
    const last = out[out.length - 1];
    if (last && last.x === event.x && last.y === event.y) continue;
    out.push({ x: event.x!, y: event.y!, t: event.t });
  }
  return out;
}

export function pathLength(path: readonly Pt[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return length;
}

/** Angle ABC in degrees; 180 is straight on (FP-Agent "angle of curvature"). */
export function curvatureAngle(prev: Pt, point: Pt, next: Pt): number {
  const ux = prev.x - point.x, uy = prev.y - point.y, vx = next.x - point.x, vy = next.y - point.y;
  const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) + 1e-9);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Distance of B from line AC as a fraction of |AC| (FP-Agent "curvature distance"). */
export function curvatureDistance(prev: Pt, point: Pt, next: Pt): number {
  const len = Math.hypot(next.x - prev.x, next.y - prev.y);
  if (len < 1e-9) return 0;
  return Math.abs((next.x - prev.x) * (prev.y - point.y) - (next.y - prev.y) * (prev.x - point.x)) / len / len;
}

/** Sign changes of the turn direction along a path, ignoring turns under ~0.5°. */
export function turnFlips(path: readonly Pt[]): number {
  let flips = 0, last = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ax = path[i].x - path[i - 1].x, ay = path[i].y - path[i - 1].y, bx = path[i + 1].x - path[i].x, by = path[i + 1].y - path[i].y;
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
  for (const run of runs) {
    const path = pathLength(run);
    if (run.length < 3 || path < 60) continue;
    const angles: number[] = [];
    for (let i = 1; i < run.length; i++) {
      bins[((Math.round(Math.atan2(run[i].y - run[i - 1].y, run[i].x - run[i - 1].x) / (Math.PI / 4)) % 8) + 8) % 8]++;
      if (i < run.length - 1) { angles.push(curvatureAngle(run[i - 1], run[i], run[i + 1])); dists.push(curvatureDistance(run[i - 1], run[i], run[i + 1])); }
    }
    angleMeans.push(mean(angles));
    angleRanges.push(Math.max(...angles) - Math.min(...angles));
    const straightness = Math.hypot(run[run.length - 1].x - run[0].x, run[run.length - 1].y - run[0].y) / path;
    if (run.length >= 15 && path >= 100 && straightness > 0.6 && straightness < 0.99) {
      curved++;
      if (turnFlips(run) === 0) smooth++;
    }
  }
  if (!angleMeans.length) return { signals, vector: {} };
  const total = bins.reduce((sum, x) => sum + x, 0);
  const entropy = -bins.filter((n) => n > 0).reduce((sum, n) => sum + (n / total) * Math.log(n / total), 0) / Math.log(8);
  const vector = {
    curv_angle_mean: r3(mean(angleMeans)),
    curv_angle_range: r3(median(angleRanges)),
    curv_dist_mean: r3(mean(dists)),
    move_dir_entropy: r3(entropy),
  };
  if (curved >= 4 && smooth / curved >= 0.8) signals.push({ code: 'bio.smooth_synthetic_curve', group: 'C', target: 'both', llr: 1.5, detail: `${smooth}/${curved} smooth curves` });
  return { signals, vector };
}

/**
 * Speed-curve shape (BeCAPTCHA-Mouse §3.1): people speed up, then slow down and fine-correct near the target.
 * Constant or accelerate-only speed is a generated trajectory.
 */
export function velocityFeatures(runs: readonly Pt[][]): { signals: Signal[]; vector: Record<string, number> } {
  const signals: Signal[] = [];
  const peakPos: number[] = [], endRatio: number[] = [], peaks: number[] = [];
  for (const run of runs) {
    const dur = run.length ? run[run.length - 1].t - run[0].t : 0;
    if (run.length < 10 || dur < 100 || pathLength(run) < 150) continue;
    const raw: number[] = [], mid: number[] = [];
    for (let i = 1; i < run.length; i++) {
      const dt = run[i].t - run[i - 1].t;
      if (dt <= 0) continue;
      raw.push(Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y) / dt);
      mid.push((run[i].t + run[i - 1].t) / 2);
    }
    if (raw.length < 8) continue;
    const smoothed = raw.map((_, i) => mean(raw.slice(Math.max(0, i - 1), i + 2)));
    const peak = Math.max(...smoothed);
    if (peak <= 0) continue;
    peakPos.push((mid[smoothed.indexOf(peak)] - run[0].t) / dur);
    endRatio.push(mean(smoothed.slice(Math.floor(smoothed.length * 0.8))) / peak);
    peaks.push(smoothed.filter((x, i) => i > 0 && i < smoothed.length - 1 && x > smoothed[i - 1] && x >= smoothed[i + 1] && x >= 0.3 * peak).length);
  }
  if (!peakPos.length) return { signals, vector: { vel_segments: 0 } };
  const vector = {
    vel_segments: peakPos.length,
    vel_peak_pos: r3(median(peakPos)),
    vel_end_ratio: r3(median(endRatio)),
    vel_peaks: median(peaks),
  };
  const flat = endRatio.filter((ratio) => ratio > 0.6).length;
  if (endRatio.length >= 3 && flat / endRatio.length >= 0.8) signals.push({ code: 'bio.no_deceleration', group: 'C', target: 'both', llr: 1.5, detail: `${flat}/${endRatio.length} no slowdown` });
  return { signals, vector };
}
