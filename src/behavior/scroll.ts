import type { Signal } from '../types.ts';
import { cv, median, r3 } from './stats.ts';
import type { TraceEvent } from './trace.ts';

interface Burst { t0: number; t1: number; n: number; d: number }

/** Input that explains a scroll: wheel, touch drag, a click (anchor link) or a key (End, PageDown, Space). */
const DRIVERS = new Set(['wh', 'tm', 'dn', 'kd']);

/**
 * Scroll bursts (FP-Agent §5.3.2): agents jump straight to an element or scroll in identical steps;
 * people scroll longer, uneven distances. `ev` holds trusted events only.
 */
export function scrollFeatures(ev: readonly TraceEvent[], completeSince: number): { signals: Signal[]; vector: Record<string, number> } {
  const bursts: Burst[] = [];
  let prev: number | undefined;
  let first: TraceEvent | undefined, lastSc: TraceEvent | undefined, n = 0;
  for (const e of ev) {
    if ((e.k !== 'sc' && e.k !== 'se') || e.sy === undefined) continue;
    if (e.k === 'sc') { first ??= e; lastSc = e; n++; continue; }
    // A visit's first burst has no known start position (`prev` is unset), so it is never measured.
    if (first && lastSc && prev !== undefined && (e.h ?? 0) > 0) bursts.push({ t0: first.t, t1: lastSc.t, n, d: Math.abs(e.sy - prev) / e.h! });
    prev = e.sy; first = lastSc = undefined; n = 0;
  }
  const signals: Signal[] = [];
  if (!bursts.length) return { signals, vector: {} };

  const drivers = ev.filter((e) => DRIVERS.has(e.k));
  const dist = bursts.map((b) => b.d);
  const jumps = bursts.filter((b, i) => dist[i] >= 0.5 && b.n <= 1 && b.t0 >= 1000 && b.t0 - 400 > completeSince && !drivers.some((x) => x.t <= b.t0 && x.t >= b.t0 - 400)).length;
  const vector = {
    scroll_bursts: bursts.length,
    scroll_dist_median: r3(median(dist)),
    scroll_dur_median: r3(median(bursts.map((b) => b.t1 - b.t0))),
    scroll_dist_cv: r3(cv(dist)),
    scroll_jump_ratio: r3(jumps / bursts.length),
  };
  if (jumps >= 2 && jumps / bursts.length >= 0.6) signals.push({ code: 'drive.scroll_jump', group: 'D', target: 'agent', llr: 1.2, detail: `${jumps}/${bursts.length} jumps` });

  const wheeled = bursts.filter((b) => drivers.some((x) => x.k === 'wh' && x.t >= b.t0 - 400 && x.t <= b.t1));
  if (wheeled.length >= 5) {
    const d = wheeled.map((b) => b.d);
    if (cv(d) < 0.02 && median(d) >= 0.3 && Math.min(...wheeled.slice(1).map((b, i) => b.t0 - wheeled[i].t1)) >= 1000) signals.push({ code: 'drive.uniform_scroll_bursts', group: 'D', target: 'agent', llr: 1.2, detail: `${wheeled.length}× ${median(d).toFixed(2)}vp` });
  }
  return { signals, vector };
}
