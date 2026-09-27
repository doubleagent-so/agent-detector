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
    if (pendingKeys) { lines.push(`t+${s(keyStart)} typed ${pendingKeys} keys`); pendingKeys = 0; }
  };
  // Collector timestamps can arrive slightly out of order (delayed dispatch); the server rejects a timeline
  // that goes back in time. A stable sort keeps every event, unlike skipping the late ones.
  for (const e of [...ev].sort((a, b) => a.t - b.t)) {
    if (e.k === 'mv' || e.k === 'tm') { movesSince++; continue; }
    if (e.k === 'kd' && !e.sp) { if (!pendingKeys) keyStart = e.t; pendingKeys++; continue; }
    if (e.k === 'se' || e.k === 'iv') {
      if (e.k === 'se' && !(e.sy !== undefined && e.h)) continue;
      flushKeys();
      lines.push(`t+${s(e.t)} ${e.k === 'se' ? `scrolled to ${(e.sy! / e.h!).toFixed(1)} viewports` : 'field changed without typing'}`);
      if (lines.length >= maxLines) break;
      continue;
    }
    if (e.k === 'ku' || e.k === 'up' || e.k === 'sc') continue;
    flushKeys();
    const gap = e.t - lastAction;
    const pre = gap > 2000 ? `(idle ${s(gap)}, ${movesSince} moves) ` : '';
    let line = '';
    switch (e.k) {
      case 'dn': line = `pointer-down ${e.pt === 't' ? 'touch' : 'mouse'} offset(${f(e.ox)},${f(e.oy)}) approach=${movesSince} moves${e.sxm ? ' screen==client' : ''}${e.u ? ' untrusted' : ''}`; break;
      case 'ck': line = `click detail=${e.d}${e.u ? ' untrusted' : ''}`; break;
      case 'kd': line = `key ${({ b: 'backspace', t: 'tab', v: 'paste-shortcut', e: 'enter', n: 'nav' } as const)[e.sp!]}`; break;
      case 'in': line = `input ${({ t: 'insertText', p: 'paste', r: 'autofill', d: 'delete', c: 'ime', o: 'other' } as const)[e.it!]} len=${e.n ?? '?'}`; break;
      case 'ps': line = 'paste-event'; break;
      case 'wh': line = `wheel dy=${e.dy}`; break;
      case 'fo': line = 'focus field'; break;
      case 'ts': line = `touch-start force=${f(e.f)}`; break;
      case 'te': line = 'touch-end'; break;
      case 'vh': line = 'tab hidden'; break;
      case 'vv': line = 'tab visible'; break;
      case 'cm': line = 'context-menu'; break;
      default: continue;
    }
    lines.push(`t+${s(e.t)} ${pre}${line}`);
    lastAction = e.t;
    movesSince = 0;
    if (lines.length >= maxLines) break;
  }
  flushKeys();
  return lines.slice(0, maxLines);
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const f = (x?: number) => (x === undefined ? '?' : x.toFixed(2));
