import type { Signal } from '../types.ts';
import type { TraceEvent } from './trace.ts';

/** Trusted input that explains a script changing a field (input masks, date pickers, typeahead). */
const EXPLAINS = new Set(['dn', 'kd', 'in', 'ps', 'ts', 'wh']);

/**
 * Field values set by script: untrusted input/change events on fields with no trusted user action in the
 * preceding second, after page load. Needs the raw trace, because untrusted events are the evidence here.
 */
export function fieldFeatures(trace: readonly TraceEvent[], completeSince: number): { signals: Signal[]; vector: Record<string, number> } {
  const explaining = trace.filter((event) => !event.u && EXPLAINS.has(event.k));
  const orphanFields = new Set<number>();
  let synthetic = 0;
  for (const event of trace) {
    if (!event.u || (event.k !== 'iv' && event.k !== 'ch') || event.fs === undefined) continue;
    synthetic++;
    if (event.t < 1500 || event.t - 1000 <= completeSince) continue;
    if (!explaining.some((x) => x.t <= event.t && x.t >= event.t - 1000)) orphanFields.add(event.fs);
  }
  const signals: Signal[] = [];
  if (orphanFields.size >= 2) signals.push({ code: 'drive.synthetic_field_fill', group: 'D', target: 'agent', llr: 2, detail: `${orphanFields.size} script-set fields` });
  return { signals, vector: { field_synthetic_events: synthetic, field_orphan_fields: orphanFields.size } };
}
