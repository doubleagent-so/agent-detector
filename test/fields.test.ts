import { describe, expect, it } from 'vitest';
import { fieldFeatures } from '../src/behavior/fields.ts';
import { extractBehavior } from '../src/behavior/features.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';

const code = 'drive.synthetic_field_fill';
const fired = (ev: TraceEvent[], since = 0) => fieldFeatures(ev, since).signals.some((s) => s.code === code);
const set = (t: number, fs: number, k: 'iv' | 'ch' = 'iv'): TraceEvent => ({ k, t, fs, u: true });

describe('fieldFeatures', () => {
  it('fires when two fields are set by script with no user action', () => {
    expect(fired([set(3000, 1), set(3001, 1, 'ch'), set(6000, 2)])).toBe(true);
    expect(fieldFeatures([set(3000, 1), set(6000, 2)], 0).vector).toEqual({ field_synthetic_events: 2, field_orphan_fields: 2 });
  });
  it('needs two distinct fields', () => {
    expect(fired([set(3000, 1), set(6000, 1)])).toBe(false);
  });
  it('ignores input masks: synthetic input right after a trusted keystroke', () => {
    expect(fired([{ k: 'kd', t: 2990 }, set(3000, 1), { k: 'kd', t: 5990 }, set(6000, 2)])).toBe(false);
  });
  it('ignores date pickers: synthetic change after a trusted click', () => {
    expect(fired([{ k: 'dn', t: 2900, pt: 'm' }, set(3000, 1, 'ch'), { k: 'dn', t: 5950, pt: 'm' }, set(6000, 2, 'ch')])).toBe(false);
  });
  it('ignores page-load prefill before 1.5 s', () => {
    expect(fired([set(200, 1), set(300, 2)])).toBe(false);
  });
  it('ignores events whose preceding second may have been evicted', () => {
    expect(fired([set(3000, 1), set(3500, 2)], 2500)).toBe(false);
  });
  it('ignores trusted autofill and events without a slot', () => {
    expect(fired([{ k: 'iv', t: 3000, fs: 1 }, { k: 'iv', t: 6000, fs: 2 }, { k: 'iv', t: 7000, u: true }])).toBe(false);
  });
  it('is wired into extractBehavior (which sees untrusted events)', () => {
    const b = extractBehavior([set(3000, 1), set(6000, 2)], 10000);
    expect(b.signals.map((s) => s.code)).toContain(code);
    expect(b.vector.field_orphan_fields).toBe(2);
  });
});
