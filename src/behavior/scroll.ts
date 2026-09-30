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
/** Scroll events up to each scroll end, as bursts with their distance in viewport heights. */
function burstsOf(ev: readonly TraceEvent[]): Burst[] {
  const bursts: Burst[] = [];
  let prev: number | undefined;
  let first: TraceEvent | undefined, lastSc: TraceEvent | undefined, n = 0;
  for (const event of ev) {
    if ((event.k !== 'sc' && event.k !== 'se') || event.sy === undefined) continue;
    if (event.k === 'sc') { first ??= event; lastSc = event; n++; continue; }
    // A visit's first burst has no known start position (`prev` is unset), so it is never measured.
    if (first && lastSc && prev !== undefined && (event.h ?? 0) > 0) bursts.push({ t0: first.t, t1: lastSc.t, n, d: Math.abs(event.sy - prev) / event.h! });
    prev = event.sy; first = lastSc = undefined; n = 0;
  }
  return bursts;
}

/** A single-event burst of half a viewport or more, with no input before it (while the trace is complete). */
const isJump = (burst: Burst, drivers: readonly TraceEvent[], completeSince: number): boolean =>
  burst.d >= 0.5 && burst.n <= 1 && burst.t0 >= 1000 && burst.t0 - 400 > completeSince && !drivers.some((x) => x.t <= burst.t0 && x.t >= burst.t0 - 400);

export function scrollFeatures(ev: readonly TraceEvent[], completeSince: number): { signals: Signal[]; vector: Record<string, number> } {
  const bursts = burstsOf(ev);
  const signals: Signal[] = [];
  if (!bursts.length) return { signals, vector: {} };

  const drivers = ev.filter((event) => DRIVERS.has(event.k));
  const dist = bursts.map((burst) => burst.d);
  const jumps = bursts.filter((burst) => isJump(burst, drivers, completeSince)).length;
  const vector = {
    scroll_bursts: bursts.length,
    scroll_dist_median: r3(median(dist)),
    scroll_dur_median: r3(median(bursts.map((burst) => burst.t1 - burst.t0))),
    scroll_dist_cv: r3(cv(dist)),
    scroll_jump_ratio: r3(jumps / bursts.length),
  };
  if (jumps >= 2 && jumps / bursts.length >= 0.6) signals.push({ code: 'drive.scroll_jump', group: 'D', target: 'agent', llr: 1.2, detail: `${jumps}/${bursts.length} jumps` });

  const wheeled = bursts.filter((burst) => drivers.some((x) => x.k === 'wh' && x.t >= burst.t0 - 400 && x.t <= burst.t1));
  if (wheeled.length >= 5) {
    const distances = wheeled.map((burst) => burst.d);
    if (cv(distances) < 0.02 && median(distances) >= 0.3 && Math.min(...wheeled.slice(1).map((burst, i) => burst.t0 - wheeled[i].t1)) >= 1000) signals.push({ code: 'drive.uniform_scroll_bursts', group: 'D', target: 'agent', llr: 1.2, detail: `${wheeled.length}× ${median(distances).toFixed(2)}vp` });
  }
  return { signals, vector };
}
