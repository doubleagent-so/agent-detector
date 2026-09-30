import type { TraceEvent } from './behavior/trace.ts';

/**
 * Compact textual timeline for an optional judge model. "Code calculates, the model judges": numbers are
 * pre-computed here (offsets, approach counts, gaps) so the model reads facts, not arithmetic.
 * Mouse moves are summarised, never listed. Capped at `maxLines`.
 */
export function timeline(ev: readonly TraceEvent[], maxLines = 60): string[] {
  const lines: string[] = [];
  let lastAction = 0;
  let movesSince = 0;
  let pendingKeys = 0, keyStart = 0;
  const flushKeys = () => {
    if (pendingKeys) { lines.push(`t+${seconds(keyStart)} typed ${pendingKeys} keys`); pendingKeys = 0; }
  };
  /** Moves and plain keys are counted, not listed; releases and scroll steps are left out. */
  const absorb = (event: TraceEvent): boolean => {
    if (event.k === 'mv' || event.k === 'tm') { movesSince++; return true; }
    if (event.k === 'kd' && !event.sp) { if (!pendingKeys) keyStart = event.t; pendingKeys++; return true; }
    return event.k === 'ku' || event.k === 'up' || event.k === 'sc';
  };
  /** A scroll end or field change is noted in place; any other event closes a run of keys. */
  const write = (event: TraceEvent): void => {
    const change = event.k === 'se' || event.k === 'iv';
    const line = change ? changeLine(event) : ACTION_LINES[event.k]?.(event, movesSince);
    if (change && !line) return;
    flushKeys();
    if (!line) return;
    const gap = event.t - lastAction;
    const pre = !change && gap > 2000 ? `(idle ${seconds(gap)}, ${movesSince} moves) ` : '';
    lines.push(`t+${seconds(event.t)} ${pre}${line}`);
    if (!change) { lastAction = event.t; movesSince = 0; }
  };
  // Collector timestamps can arrive slightly out of order (delayed dispatch); the server rejects a timeline
  // that goes back in time. A stable sort keeps every event, unlike skipping the late ones.
  for (const event of [...ev].sort((left, right) => left.t - right.t)) {
    if (absorb(event)) continue;
    write(event);
    if (lines.length >= maxLines) break;
  }
  flushKeys();
  return lines.slice(0, maxLines);
}

/** A scroll end (where it stopped) or a field change without typing; nothing for a scroll end without a position. */
function changeLine(event: TraceEvent): string | undefined {
  if (event.k === 'iv') return 'field changed without typing';
  return event.sy !== undefined && event.h ? `scrolled to ${(event.sy / event.h).toFixed(1)} viewports` : undefined;
}

const untrusted = (event: TraceEvent) => (event.u ? ' untrusted' : '');

/** One line per action kind; kinds not listed are left out of the timeline. */
const ACTION_LINES: Partial<Record<TraceEvent['k'], (event: TraceEvent, movesSince: number) => string>> = {
  dn: (event, movesSince) => `pointer-down ${event.pt === 't' ? 'touch' : 'mouse'} offset(${fixed(event.ox)},${fixed(event.oy)}) approach=${movesSince} moves${event.sxm ? ' screen==client' : ''}${untrusted(event)}`,
  ck: (event) => `click detail=${event.d}${untrusted(event)}`,
  kd: (event) => `key ${({ b: 'backspace', t: 'tab', v: 'paste-shortcut', e: 'enter', n: 'nav' } as const)[event.sp!]}`,
  in: (event) => `input ${({ t: 'insertText', p: 'paste', r: 'autofill', d: 'delete', c: 'ime', o: 'other' } as const)[event.it!]} len=${event.n ?? '?'}`,
  ps: () => 'paste-event',
  wh: (event) => `wheel dy=${event.dy}`,
  fo: () => 'focus field',
  ts: (event) => `touch-start force=${fixed(event.f)}`,
  te: () => 'touch-end',
  vh: () => 'tab hidden',
  vv: () => 'tab visible',
  cm: () => 'context-menu',
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const fixed = (x?: number) => (x === undefined ? '?' : x.toFixed(2));
