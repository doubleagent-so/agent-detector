import { describe, expect, it } from 'vitest';
import { scrollFeatures } from '../src/behavior/scroll.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';

const H = 800;
/** One scroll burst ending at position `sy`: n scroll events 40 ms apart, then its settle event. */
const burst = (t: number, sy: number, n = 1, from = sy): TraceEvent[] => [
  ...Array.from({ length: n }, (_, i) => ({ k: 'sc' as const, t: t + i * 40, sy: Math.round(from + ((sy - from) * (i + 1)) / n), h: H })),
  { k: 'se', t: t + (n - 1) * 40, sy, h: H },
];
const codes = (ev: TraceEvent[], since = 0) => scrollFeatures(ev, since).signals.map((s) => s.code);

describe('scrollFeatures', () => {
  it('flags repeated instant jumps with no input', () => {
    const ev = [...burst(1500, 0), ...burst(3000, 2400), ...burst(6000, 4800)];
    expect(codes(ev)).toContain('drive.scroll_jump');
    expect(scrollFeatures(ev, 0).vector.scroll_jump_ratio).toBe(1);
  });
  it('does not flag a single find-in-page jump among normal scrolling', () => {
    const ev = [...burst(1500, 0), ...burst(3000, 400, 6, 0), ...burst(6000, 3000), ...burst(9000, 3400, 6, 3000), ...burst(12000, 3800, 6, 3400)];
    expect(codes(ev)).not.toContain('drive.scroll_jump');
  });
  it('does not flag anchor links, End key or scroll restoration', () => {
    const anchor = [...burst(1500, 0), { k: 'dn', t: 2950, pt: 'm' } as TraceEvent, ...burst(3000, 2400), { k: 'kd', t: 5900, sp: 'n' } as TraceEvent, ...burst(6000, 4800)];
    expect(codes(anchor)).not.toContain('drive.scroll_jump');
    const restore = [...burst(100, 0), ...burst(300, 2400), ...burst(600, 4800)];
    expect(codes(restore)).not.toContain('drive.scroll_jump');
  });
  it('ignores jumps whose preceding 400 ms may have been evicted', () => {
    expect(codes([...burst(1500, 0), ...burst(3000, 2400), ...burst(6000, 4800)], 5800)).not.toContain('drive.scroll_jump');
  });
  it('flags identical wheel bursts separated by think time', () => {
    const ev: TraceEvent[] = [...burst(1000, 0)];
    for (let i = 1; i <= 6; i++) ev.push({ k: 'wh', t: i * 3000 - 5, dy: 500, dm: 0 }, ...burst(i * 3000, i * 500));
    expect(codes(ev)).toContain('drive.uniform_scroll_bursts');
    expect(scrollFeatures(ev, 0).vector.scroll_dist_cv).toBe(0);
  });
  it('does not flag varied human wheel scrolling', () => {
    const ev: TraceEvent[] = [...burst(1000, 0)];
    let sy = 0;
    for (const [i, notches] of [3, 5, 2, 4, 3, 6].entries()) {
      const t = (i + 1) * 3000;
      for (let n = 0; n < notches; n++) ev.push({ k: 'wh', t: t + n * 40, dy: 100, dm: 0 });
      ev.push(...burst(t + 5, sy + notches * 100, notches, sy));
      sy += notches * 100;
    }
    expect(codes(ev)).toEqual([]);
  });
  it('emits nothing without positioned scrolls', () => {
    expect(scrollFeatures([{ k: 'sc', t: 100 }, { k: 'sc', t: 200 }], 0)).toEqual({ signals: [], vector: {} });
  });
});
