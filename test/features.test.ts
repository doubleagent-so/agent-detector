import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../src/behavior/trace.ts';
import { extractBehavior } from '../src/behavior/features.ts';
import { fuse, recommend } from '../src/fusion.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';
import type { Signal } from '../src/types.ts';
import { bezierBot, functionBot, jsFillAgent, visionAgent } from './traces.ts';

const codes = (ev: TraceEvent[], now = 20000) => extractBehavior(ev, now).signals.map((s) => s.code);
const range = (n: number, f: (i: number) => TraceEvent): TraceEvent[] => Array.from({ length: n }, (_, i) => f(i));
const idx = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const E = (...e: TraceEvent[]): TraceEvent[] => e;

describe('extractBehavior branches', () => {
  it('empty trace: no pointer, zero reliability, no signals', () => {
    const b = extractBehavior([], 0);
    expect(b.stats).toEqual(expect.objectContaining({ pointer: 'none', reliability: 0, driveReliability: 0.4 }));
    expect(b.signals).toEqual([]);
  });

  it('untrusted events and CDP screen coords', () => {
    expect(codes([{ k: 'dn', t: 1, u: true, pt: 'm' }, { k: 'mv', t: 2, sxm: true }, { k: 'mv', t: 3, sxm: true }])).toEqual(expect.arrayContaining(['drive.untrusted_events', 'drive.cdp_screen_coords']));
  });

  it('coalesced samples: missing coalescing is neutral; many samples support human input', () => {
    const mv = (co: (i: number) => number) => range(25, (i) => ({ k: 'mv', t: i * 16, x: i, y: i, pt: 'm', co: co(i) }));
    expect(codes(mv(() => 1))).not.toContain('drive.no_coalesced_samples');
    expect(codes(mv(() => 3))).toContain('human.coalesced_samples');
    const mid = codes(mv((i) => (i === 0 ? 3 : 1)));
    expect(mid).not.toContain('drive.no_coalesced_samples');
    expect(mid).not.toContain('human.coalesced_samples');
    expect(codes(range(25, (i) => ({ k: 'mv', t: i * 16, x: i, y: i, pt: 'm' })))).not.toContain('drive.no_coalesced_samples'); // co unknown
  });

  it('clicks: teleport, approach, dead centre, scatter, zero/constant press', () => {
    const teleport: TraceEvent[] = [{ k: 'dn', t: 1000, pt: 'm', ox: 0, oy: 0, w: 100, h: 40 }, { k: 'up', t: 1001 }, { k: 'dn', t: 3000, pt: 'm', ox: 0.01, oy: 0.01, w: 100, h: 40 }, { k: 'up', t: 3002 }];
    expect(codes(teleport)).toEqual(expect.arrayContaining(['drive.click_without_approach', 'drive.click_dead_centre', 'drive.zero_press_duration']));
    const moves = range(40, (i) => ({ k: 'mv', t: 500 + i * 20, x: i * 3, y: i, pt: 'm' }));
    const human = E(...moves, { k: 'dn', t: 1200, pt: 'm', ox: 0.2, oy: -0.1, w: 100, h: 40 }, { k: 'up', t: 1300 }, { k: 'dn', t: 1290, pt: 'm', ox: -0.3, oy: 0.3, w: 100, h: 40 }, { k: 'up', t: 1400 }).sort((a, b) => a.t - b.t);
    expect(codes(human)).toEqual(expect.arrayContaining(['human.click_approach', 'human.click_scatter']));
    const constant: TraceEvent[] = [0, 1, 2].flatMap((i) => [{ k: 'dn', t: 1000 * (i + 1), pt: 'm' as const, ox: 0.1 * i, oy: 0.1, w: 10, h: 10 }, { k: 'up', t: 1000 * (i + 1) + 50 }]);
    expect(codes(constant)).toContain('drive.constant_press_duration');
    const tight: TraceEvent[] = [{ k: 'dn', t: 1000, pt: 'm', ox: 0.1, oy: 0.1, w: 100, h: 40 }, { k: 'dn', t: 2000, pt: 'm', ox: 0.11, oy: 0.1, w: 100, h: 40 }];
    expect(codes(tight)).not.toContain('human.click_scatter');
  });

  it('text entry: insert without keys (multi and single char), synthetic paste, shortcut and context-menu paste, instant fill', () => {
    expect(codes([{ k: 'in', t: 100, it: 't', n: 5 }])).toContain('drive.insert_text_without_keys');
    expect(codes([{ k: 'in', t: 100, it: 't', n: 1 }, { k: 'in', t: 200, it: 't', n: 1 }])).toContain('drive.insert_text_without_keys');
    expect(codes([{ k: 'in', t: 100, it: 't' }])).not.toContain('drive.insert_text_without_keys');
    expect(codes([{ k: 'kd', t: 90 }, { k: 'in', t: 100, it: 't', n: 1 }])).not.toContain('drive.insert_text_without_keys');
    expect(codes([{ k: 'in', t: 100, it: 'p', n: 9 }])).not.toContain('drive.paste_without_shortcut'); // trigger could predate collection
    expect(codes([{ k: 'in', t: 11000, it: 'p', n: 9 }])).toContain('drive.paste_without_shortcut');
    expect(codes([{ k: 'kd', t: 10950, sp: 'v', mod: true }, { k: 'in', t: 11000, it: 'p', n: 9 }])).not.toContain('drive.paste_without_shortcut');
    expect(codes([{ k: 'cm', t: 10950 }, { k: 'in', t: 11000, it: 'p', n: 9 }])).not.toContain('drive.paste_without_shortcut');
    const fill: TraceEvent[] = [{ k: 'fo', t: 1000 }, { k: 'in', t: 1010, it: 'p', n: 3 }, { k: 'fo', t: 1500 }, { k: 'in', t: 1510, it: 't', n: 3 }, { k: 'fo', t: 1900 }, { k: 'in', t: 1905, it: 'r' }];
    expect(codes(fill)).toContain('drive.instant_field_fill');
    expect(codes(fill.map(e => e.k === 'in' ? { ...e, it: 'd' } : e))).not.toContain('drive.instant_field_fill');
    const viaClick: TraceEvent[] = [{ k: 'dn', t: 90, pt: 'm' }, { k: 'fo', t: 100 }, { k: 'in', t: 110, it: 'd' }, { k: 'kd', t: 490, sp: 't' }, { k: 'fo', t: 500 }, { k: 'in', t: 510, it: 'd' }];
    expect(codes(viaClick)).not.toContain('drive.instant_field_fill');
  });

  it('keystroke dynamics: superhuman, uniform, human rhythm, constant hold, corrections', () => {
    const typed = (flight: (i: number) => number, hold = (_: number) => 80, n = 12, extra: TraceEvent[] = []) => {
      const ev: TraceEvent[] = [];
      let t = 1000;
      for (let i = 0; i < n; i++) { ev.push({ k: 'kd', t, ks: i }); ev.push({ k: 'ku', t: t + hold(i), ks: i }); t += flight(i); }
      return [...ev, ...extra].sort((a, b) => a.t - b.t);
    };
    expect(codes(typed(() => 10))).toContain('bio.superhuman_typing');
    expect(codes(typed(() => 100))).toEqual(expect.arrayContaining(['bio.uniform_typing', 'bio.constant_key_hold']));
    expect(codes(typed((i) => [60, 300, 120, 500, 90, 250][i % 6], (i) => 60 + (i % 5) * 15))).toContain('human.typing_rhythm');
    const withBackspace = typed((i) => [60, 300, 120, 500, 90, 250][i % 6], (i) => 60 + (i % 5) * 15, 22).map((e, i) => (i === 4 && e.k === 'kd' ? { ...e, sp: 'b' as const } : e));
    expect(codes(withBackspace)).toContain('human.corrections');
    expect(codes(typed(() => 5000))).not.toContain('bio.superhuman_typing'); // long pauses are not flights
  });

  it('mouse kinematics: linear interpolated paths, human curves, burst-dispatched moves', () => {
    const seg = (start: number, pts: [number, number][], dt = 16): TraceEvent[] => pts.map(([x, y], i) => ({ k: 'mv', t: start + i * dt, x, y, pt: 'm' }));
    const line = (s: number) => seg(s, idx(10).map((i) => [i * 20, i * 10] as [number, number]));
    expect(codes([...line(0), ...line(1000), ...line(2000)])).toContain('bio.linear_mouse_paths');
    const curve = (s: number) => seg(s, idx(12).map((i) => [i * 15 + (i % 3) * 4, 40 * Math.sin(i / 2) + (i % 2) * 6] as [number, number]), 10 + 0);
    const varied = (s: number) => curve(s).map((e, i) => ({ ...e, t: s + [0, 5, 30, 38, 70, 75, 110, 150, 160, 200, 230, 260][i] }));
    expect(codes([...varied(0), ...varied(1000), ...varied(2000)])).toContain('human.mouse_kinematics');
    const burst = [...line(0), ...line(1000), ...line(2000)].map((e, i) => ({ ...e, t: Math.floor(i / 10) * 1000 + (i % 10) * 1 }));
    expect(codes(burst)).toContain('bio.burst_dispatched_moves');
    const short = (s: number) => seg(s, [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]); // path < 40px
    expect(codes([...short(0), ...short(1000), ...short(2000)])).not.toContain('bio.linear_mouse_paths');
    expect(codes([{ k: 'mv', t: 1, pt: 'm' }])).toEqual([]); // moves without coordinates are skipped
    const still = (s: number) => seg(s, [[5, 5], [5, 5], [5, 5], [5, 5], [5, 5]], 0);
    expect(() => extractBehavior([...still(0), ...still(1000), ...still(2000)], 5000)).not.toThrow();
  });

  it('touch: synthetic taps vs human drift', () => {
    const taps = (drift: number, f = 0, r = 1): TraceEvent[] => idx(4).flatMap((i) => [
      { k: 'ts', t: i * 1000, x: 10, y: 10, f, r } as TraceEvent, { k: 'te', t: i * 1000 + 80, x: 10 + drift, y: 10 } as TraceEvent,
    ]);
    expect(codes(taps(0))).toContain('bio.synthetic_touch');
    expect(codes(taps(3, 0.4, 12))).toContain('human.touch_drift');
    expect(codes(range(4, (i) => ({ k: 'ts', t: i * 1000 })))).not.toContain('bio.synthetic_touch');
    expect(extractBehavior(taps(3), 5000).stats.pointer).toBe('touch');
  });

  it('scrolling and wheel: programmatic scroll, page-sized wheel, trackpad inertia', () => {
    expect(codes(range(5, (i) => ({ k: 'sc', t: i * 1000 })))).toContain('drive.programmatic_scroll');
    expect(codes(idx(5).flatMap((i) => [{ k: 'wh', t: i * 1000, dy: 100 } as TraceEvent, { k: 'sc', t: i * 1000 + 50 } as TraceEvent]))).not.toContain('drive.programmatic_scroll');
    expect(codes(range(5, (i) => ({ k: 'wh', t: i * 500, dy: 800 })))).toContain('drive.page_sized_wheel');
    expect(codes(range(5, (i) => ({ k: 'wh', t: i * 500, dy: 12.5 })))).toContain('human.trackpad_inertia');
    expect(codes(range(5, (i) => ({ k: 'wh', t: i * 500 })))).toEqual(expect.not.arrayContaining(['drive.page_sized_wheel', 'human.trackpad_inertia']));
  });

  it('rhythm: instant first action, think-then-act, continuous micro activity, hidden tab gaps', () => {
    expect(codes([{ k: 'dn', t: 100, pt: 'm' }])).toContain('rhythm.instant_first_action');
    const think = [1000, 5000, 9000, 13000].map((t) => ({ k: 'dn', t, pt: 'm' }) as TraceEvent);
    expect(codes(think)).toContain('rhythm.think_then_act');
    const busy = E(...think, ...range(40, (i) => ({ k: 'mv', t: 1300 + i * 300, x: i, y: i, pt: 'm' }))).sort((a, b) => a.t - b.t);
    expect(codes(busy)).toContain('human.continuous_micro_activity');
    const away = E(...think, { k: 'vh', t: 3000 }, { k: 'vh', t: 7000 }, { k: 'vh', t: 11000 }).sort((a, b) => a.t - b.t);
    const b = extractBehavior(away, 20000);
    expect(b.vector.silent_gap_ratio).toBe(0);
    const keysBurst: TraceEvent[] = [{ k: 'dn', t: 1000, pt: 'm' }, { k: 'kd', t: 1100 }, { k: 'in', t: 1150, it: 't', n: 1 }, { k: 'kd', t: 1200 }, { k: 'dn', t: 1500, pt: 'm' }, { k: 'dn', t: 2000, pt: 'm' }];
    expect(extractBehavior(keysBurst, 5000).vector.gap_cv).toBeDefined();
  });
});

describe('fusion branches', () => {
  const base = { profile: 'generic' as const, action: 'pageview', sig: DEFAULT_SIGNATURES, behaviorReliability: 1, sessionId: 's' };

  it('uses site priors, unknown-profile fallback, attack mode and explicit drive reliability', () => {
    const a = fuse({ ...base, signals: [] });
    const b = fuse({ ...base, signals: [], sitePrior: { bot: 0.6, agent: 0.1 } });
    expect(b.probability.human).toBeLessThan(a.probability.human);
    const c = fuse({ ...base, signals: [], profile: 'nope' as never });
    expect(c.probability).toEqual(a.probability);
    expect(fuse({ ...base, signals: [], attackMode: true }).probability.human).toBeLessThan(a.probability.human);
    const d: Signal = { code: 'd', group: 'D', target: 'bot', llr: 3 };
    expect(fuse({ ...base, signals: [d], driveReliability: 0 }).probability).toEqual(a.probability);
  });

  it('hard automation with agent-like driving and think-time is attributed to an agent framework', () => {
    const v = fuse({ ...base, signals: [
      { code: 'global.playwright', group: 'A', target: 'bot', llr: 9, hard: true },
      { code: 'drive.x', group: 'D', target: 'agent', llr: 3 },
      { code: 'rhythm.think_then_act', group: 'R', target: 'agent', llr: 2.2 },
    ] });
    expect(v.class).toBe('agent');
    expect(v.agent).toEqual(expect.objectContaining({ family: 'unknown', verified: false, method: 'behavioral' }));
  });

  it('hard agent evidence names the family and method; verified H evidence is reported', () => {
    const v = fuse({ ...base, signals: [{ code: 'marker.claude', group: 'A', target: 'agent', llr: 9, hard: true, family: 'claude' }] });
    expect(v.agent).toEqual({ family: 'claude', verified: false, method: 'marker.claude' });
    const w = fuse({ ...base, action: 'login', signals: [{ code: 'verified.web_bot_auth', group: 'H', target: 'agent', llr: 6, family: 'openai' }] });
    expect(w.agent).toEqual({ family: 'openai', verified: true, method: 'verified.web_bot_auth' });
    expect(w.recommendation).toBe('step_up');
  });

  it('recommend: human allow, unknown actions default, deny vs step-up, challenge, tag', () => {
    const S = DEFAULT_SIGNATURES;
    expect(recommend(S, 'generic', 'login', 'human', 1, false)).toBe('allow');
    expect(recommend(S, 'generic', 'pageview', 'bot', 1, false)).toBe('tag');
    expect(recommend(S, 'generic', 'checkout', 'agent', 1, true)).toBe('challenge');
    expect(recommend(S, 'generic', 'login', 'bot', 0.95, false)).toBe('step_up');
    expect(recommend(S, 'generic', 'signup', 'bot', 0.9, false)).toBe('deny');
    expect(recommend(S, 'generic', 'signup', 'bot', 0.6, false)).toBe('challenge');
    expect(recommend(S, 'generic', 'signup', 'bot', 0.1, false)).toBe('tag');
    expect(recommend(S, 'generic', 'custom/thing', 'bot', 0.85, false)).toBe('challenge');
    expect(recommend(S, 'nope' as never, 'search', 'bot', 0.9, false)).toBe('challenge');
    expect(recommend({ ...S, policies: { ...S.policies, generic: { odd: {} } } }, 'generic', 'odd', 'bot', 0.99, false)).toBe('tag');
  });
});

describe('FP-Agent / BeCAPTCHA detectors on generated sessions', () => {
  const fires = (ev: TraceEvent[], code: string) => extractBehavior(ev, ev[ev.length - 1].t + 500).signals.some((s) => s.code === code);
  it('script fill agent', () => expect(fires(jsFillAgent(), 'drive.synthetic_field_fill')).toBe(true));
  it('vision agent wheel steps', () => expect(fires(visionAgent(), 'drive.uniform_scroll_bursts')).toBe(true));
  it('Bézier bot', () => expect(fires(bezierBot(), 'bio.smooth_synthetic_curve')).toBe(true));
  it('BeCAPTCHA quadratic × constant and exponential × log', () => {
    expect(fires(functionBot(5, 'quadratic', 'constant'), 'bio.smooth_synthetic_curve')).toBe(true);
    expect(fires(functionBot(5, 'quadratic', 'constant'), 'bio.no_deceleration')).toBe(true);
    expect(fires(functionBot(5, 'exponential', 'log'), 'bio.no_deceleration')).toBe(true);
  });
  it('drags at constant speed (sliders, games) are not no_deceleration', () => {
    const drags = idx(4).flatMap((d): TraceEvent[] => {
      const start = 1000 + d * 2000;
      const moves = range(30, (i) => ({ k: 'mv', t: start + 10 + i * 16.7, x: i * 14, y: 100 + d * 60, pt: 'm' }));
      return [{ k: 'dn', t: start, pt: 'm', x: 0, y: 100 + d * 60 }, ...moves, { k: 'up', t: start + 520 }];
    });
    expect(fires(drags, 'bio.no_deceleration')).toBe(false);
  });
});
