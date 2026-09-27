import { describe, expect, it } from 'vitest';
import { curvatureAngle, curvatureDistance, curvatureFeatures, pathLength, points, segmentMoves, turnFlips, type Pt } from '../src/behavior/kinematics.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';
import { rng } from './traces.ts';

const P = (x: number, y: number, t = 0): Pt => ({ x, y, t });
/** A quarter-circle arc sampled at 60 Hz; `noise` px of jitter. */
const arc = (seed: number, noise: number, n = 30, r0 = 300): Pt[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * (Math.PI / 3);
    return P(r0 * Math.cos(a) + (r() - 0.5) * 2 * noise, r0 * Math.sin(a) + (r() - 0.5) * 2 * noise, i * 16.7);
  });
};

describe('kinematics primitives', () => {
  it('measures angles and curvature distance like FP-Agent', () => {
    expect(curvatureAngle(P(0, 0), P(1, 0), P(2, 0))).toBeCloseTo(180);
    expect(curvatureAngle(P(0, 0), P(1, 0), P(1, 1))).toBeCloseTo(90);
    expect(curvatureDistance(P(0, 0), P(1, 1), P(2, 0))).toBeCloseTo(0.5);
    expect(curvatureDistance(P(0, 0), P(1, 1), P(0, 0))).toBe(0);
    expect(pathLength([P(0, 0), P(3, 4)])).toBe(5);
  });
  it('dedupes repeated coordinates', () => {
    const mv = (t: number, x: number): TraceEvent => ({ k: 'mv', t, x, y: 0, pt: 'm' });
    expect(points([mv(0, 1), mv(16, 1), mv(32, 2)])).toHaveLength(2);
  });
  it('segments on the given gap and minimum', () => {
    const mv = (t: number): TraceEvent => ({ k: 'mv', t, x: t, y: 0, pt: 'm' });
    const ev = [0, 16, 32, 232, 248, 264].map(mv); // 200 ms gap
    expect(segmentMoves(ev, 150, 3)).toHaveLength(2);
    expect(segmentMoves(ev, 250, 3)).toHaveLength(1);
    expect(segmentMoves(ev)).toHaveLength(0); // default minPoints 5
  });
  it('counts turn-direction reversals, ignoring sub-degree wobble', () => {
    expect(turnFlips(arc(1, 0))).toBe(0);
    expect(turnFlips(arc(1, 2))).toBeGreaterThan(2);
    expect(turnFlips([P(0, 0), P(10, 0), P(20, 0.01), P(30, 0)])).toBe(0);
  });
});

describe('curvatureFeatures', () => {
  it('flags smooth synthetic curves', () => {
    const f = curvatureFeatures([1, 2, 3, 4, 5].map((s) => arc(s, 0)));
    expect(f.signals.map((s) => s.code)).toContain('bio.smooth_synthetic_curve');
    expect(f.vector.curv_angle_mean).toBeGreaterThan(170);
  });
  it('does not flag jittery human curves', () => {
    expect(curvatureFeatures([1, 2, 3, 4, 5].map((s) => arc(s, 1.5))).signals).toEqual([]);
  });
  it('needs four curved runs and ignores short or straight ones', () => {
    expect(curvatureFeatures([1, 2, 3].map((s) => arc(s, 0))).signals).toEqual([]);
    const straight = Array.from({ length: 20 }, (_, i) => P(i * 10, 0, i * 16));
    expect(curvatureFeatures([straight, straight, straight, straight]).signals).toEqual([]);
    expect(curvatureFeatures([[P(0, 0), P(1, 1)]])).toEqual({ signals: [], vector: {} });
  });
});
