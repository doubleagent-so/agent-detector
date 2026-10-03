import type { TraceEvent } from './trace.ts';

// What a click can visibly change within a second: navigation away (vh), an input or focus, or a scroll.
const RESPONSES = new Set(['vh', 'in', 'iv', 'ch', 'fo', 'sc', 'se']);

/** Bursts of 3+ pointer clicks, each within 1 s and 30 px of the burst's first click. */
function rageBursts(clicks: readonly TraceEvent[]): number {
  let bursts = 0, first: TraceEvent | undefined, n = 0;
  for (const click of clicks) {
    if (click.d === 0) continue; // keyboard activation: no position
    if (first && click.t - first.t <= 1000 && Math.hypot(click.x! - first.x!, click.y! - first.y!) <= 30) n++;
    else { if (n >= 3) bursts++; first = click; n = 1; }
  }
  return n >= 3 ? bursts + 1 : bursts;
}

/**
 * Frustration cues: features that describe the visit (UX friction), not who the visitor is, so they never emit
 * signals. `ev` holds trusted, time-ordered events. Nothing is emitted for a trace with no click and no error.
 * - `rage_clicks`: bursts of 3+ clicks within 1 s inside a 30 px radius.
 * - `dead_clicks`: clicks on non-interactive content with no navigation, input or scroll in the next second. A click
 *   in the trace's last second is not judged yet.
 * - `error_clicks`: clicks within 1 s after a script error.
 * - `js_errors`: script errors and unhandled rejections (the collector keeps one per 500 ms, 100 per page).
 */
export function frustrationFeatures(ev: readonly TraceEvent[], nowMs: number): Record<string, number> {
  const clicks = ev.filter((event) => event.k === 'ck');
  const errors = ev.filter((event) => event.k === 'er');
  if (!clicks.length && !errors.length) return {};
  const after = (click: TraceEvent, match: (event: TraceEvent) => boolean) =>
    ev.some((event) => event.t > click.t && event.t <= click.t + 1000 && match(event));
  const dead = clicks.filter((click) => !click.ia && click.t + 1000 <= nowMs && !after(click, (event) => RESPONSES.has(event.k)));
  const errorClicks = clicks.filter((click) => errors.some((error) => error.t <= click.t && error.t >= click.t - 1000));
  return { rage_clicks: rageBursts(clicks), dead_clicks: dead.length, error_clicks: errorClicks.length, js_errors: errors.length };
}
