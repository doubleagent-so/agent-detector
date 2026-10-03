import { describe, expect, it } from 'vitest';
import { extractBehavior } from '../src/behavior/features.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';

const KEYS = ['rage_clicks', 'dead_clicks', 'error_clicks', 'js_errors'];
const click = (t: number, x = 100, y = 100, more: Partial<TraceEvent> = {}): TraceEvent => ({ k: 'ck', t, x, y, d: 1, ...more });
const tap = (t: number, x = 100, y = 100): TraceEvent => click(t, x, y, { ia: 1 });
/** The frustration features of a trace observed until `now`. */
const cues = (trace: TraceEvent[], now = 60_000): Record<string, number> => {
  const { vector } = extractBehavior([...trace].sort((a, b) => a.t - b.t), now);
  return Object.fromEntries(KEYS.filter((key) => key in vector).map((key) => [key, vector[key]]));
};

describe('frustration cues', () => {
  it('emits nothing for a trace with no clicks and no errors', () => {
    expect(cues([])).toEqual({});
    expect(cues([{ k: 'kd', t: 100 }, { k: 'sc', t: 200 }])).toEqual({});
  });

  it('emits every count once there is a click or an error', () => {
    expect(cues([tap(1000)])).toEqual({ rage_clicks: 0, dead_clicks: 0, error_clicks: 0, js_errors: 0 });
    expect(cues([{ k: 'er', t: 1000 }])).toEqual({ rage_clicks: 0, dead_clicks: 0, error_clicks: 0, js_errors: 1 });
  });

  describe('rage_clicks', () => {
    it('counts each burst of three or more clicks within 1 s inside 30 px', () => {
      expect(cues([tap(1000), tap(1200, 110, 110), tap(1400, 95, 120)]).rage_clicks).toBe(1);
      const twoBursts = [tap(1000), tap(1100), tap(1200), tap(1300), tap(1400), tap(5000), tap(5100), tap(5200)];
      expect(cues(twoBursts).rage_clicks).toBe(2);
    });

    it('two fast clicks are not rage', () => expect(cues([tap(1000), tap(1100)]).rage_clicks).toBe(0));

    it('three clicks 50 px apart are not rage', () => {
      expect(cues([tap(1000, 100), tap(1100, 150), tap(1200, 200)]).rage_clicks).toBe(0);
    });

    it('three clicks spread over more than 1 s are not rage', () => {
      expect(cues([tap(1000), tap(1600), tap(2200)]).rage_clicks).toBe(0);
    });

    it('ignores keyboard and synthetic clicks', () => {
      expect(cues([click(1000, 0, 0, { d: 0, ia: 1 }), click(1100, 0, 0, { d: 0, ia: 1 }), click(1200, 0, 0, { d: 0, ia: 1 })]).rage_clicks).toBe(0);
      expect(cues([tap(1000), tap(1100), click(1200, 100, 100, { u: true })]).rage_clicks).toBe(0);
    });
  });

  describe('dead_clicks', () => {
    it('counts clicks on non-interactive content that change nothing within 1 s', () => {
      expect(cues([click(1000), click(3000, 300, 300)]).dead_clicks).toBe(2);
    });

    it('a click on an interactive element (or its child) is not dead', () => {
      expect(cues([tap(1000)]).dead_clicks).toBe(0);
    });

    it('navigation, input or scroll within 1 s explains the click', () => {
      for (const k of ['vh', 'in', 'iv', 'ch', 'fo', 'sc', 'se'] as const) {
        expect(cues([click(1000), { k, t: 1800 }]).dead_clicks, k).toBe(0);
      }
      expect(cues([click(1000), { k: 'sc', t: 2100 }]).dead_clicks).toBe(1);
      expect(cues([{ k: 'sc', t: 900 }, click(1000)]).dead_clicks).toBe(1); // before the click explains nothing
    });

    it('a click in the last second of the trace is not judged yet', () => {
      expect(cues([click(1000)], 1500).dead_clicks).toBe(0);
      expect(cues([click(1000)], 2000).dead_clicks).toBe(1);
    });
  });

  describe('error_clicks and js_errors', () => {
    it('counts clicks within 1 s after a script error', () => {
      const trace = [{ k: 'er', t: 1000 } as TraceEvent, tap(1500), tap(1900), tap(2500)];
      expect(cues(trace)).toMatchObject({ error_clicks: 2, js_errors: 1 });
    });

    it('an error 1.5 s before a click is not an error click', () => {
      expect(cues([{ k: 'er', t: 1000 }, tap(2500)]).error_clicks).toBe(0);
    });

    it('an error after the click is not an error click', () => {
      expect(cues([tap(1000), { k: 'er', t: 1200 }]).error_clicks).toBe(0);
    });

    it('counts trusted errors only', () => {
      expect(cues([{ k: 'er', t: 1000 }, { k: 'er', t: 2000 }, { k: 'er', t: 3000, u: true }]).js_errors).toBe(2);
    });
  });

  it('adds no signals: the cues describe the visit, not the visitor', () => {
    const trace = [{ k: 'er', t: 900 } as TraceEvent, click(1000), click(1100), click(1200)];
    const withCues = extractBehavior(trace, 5000);
    const without = extractBehavior(trace.filter((event) => event.k !== 'er' && event.k !== 'ck'), 5000);
    expect(withCues.signals).toEqual(without.signals);
    expect(cues(trace, 5000)).toEqual({ rage_clicks: 1, dead_clicks: 3, error_clicks: 3, js_errors: 1 });
  });
});
