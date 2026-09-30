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
  // Collector timestamps can arrive slightly out of order (delayed dispatch); the server rejects a timeline
  // that goes back in time. A stable sort keeps every event, unlike skipping the late ones.
  for (const event of [...ev].sort((left, right) => left.t - right.t)) {
    if (event.k === 'mv' || event.k === 'tm') { movesSince++; continue; }
    if (event.k === 'kd' && !event.sp) { if (!pendingKeys) keyStart = event.t; pendingKeys++; continue; }
    if (event.k === 'se' || event.k === 'iv') {
      if (event.k === 'se' && !(event.sy !== undefined && event.h)) continue;
      flushKeys();
      lines.push(`t+${seconds(event.t)} ${event.k === 'se' ? `scrolled to ${(event.sy! / event.h!).toFixed(1)} viewports` : 'field changed without typing'}`);
      if (lines.length >= maxLines) break;
      continue;
    }
    if (event.k === 'ku' || event.k === 'up' || event.k === 'sc') continue;
    flushKeys();
    const gap = event.t - lastAction;
    const pre = gap > 2000 ? `(idle ${seconds(gap)}, ${movesSince} moves) ` : '';
    let line: string;
    switch (event.k) {
      case 'dn': line = `pointer-down ${event.pt === 't' ? 'touch' : 'mouse'} offset(${fixed(event.ox)},${fixed(event.oy)}) approach=${movesSince} moves${event.sxm ? ' screen==client' : ''}${event.u ? ' untrusted' : ''}`; break;
      case 'ck': line = `click detail=${event.d}${event.u ? ' untrusted' : ''}`; break;
      case 'kd': line = `key ${({ b: 'backspace', t: 'tab', v: 'paste-shortcut', e: 'enter', n: 'nav' } as const)[event.sp!]}`; break;
      case 'in': line = `input ${({ t: 'insertText', p: 'paste', r: 'autofill', d: 'delete', c: 'ime', o: 'other' } as const)[event.it!]} len=${event.n ?? '?'}`; break;
      case 'ps': line = 'paste-event'; break;
      case 'wh': line = `wheel dy=${event.dy}`; break;
      case 'fo': line = 'focus field'; break;
      case 'ts': line = `touch-start force=${fixed(event.f)}`; break;
      case 'te': line = 'touch-end'; break;
      case 'vh': line = 'tab hidden'; break;
      case 'vv': line = 'tab visible'; break;
      case 'cm': line = 'context-menu'; break;
      default: continue;
    }
    lines.push(`t+${seconds(event.t)} ${pre}${line}`);
    lastAction = event.t;
    movesSince = 0;
    if (lines.length >= maxLines) break;
  }
  flushKeys();
  return lines.slice(0, maxLines);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const fixed = (x?: number) => (x === undefined ? '?' : x.toFixed(2));
