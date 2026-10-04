import { describe, expect, it } from 'vitest';
import { extractBehavior } from '../src/behavior/features.ts';
import { Ring, type TraceEvent } from '../src/behavior/trace.ts';
import { fuse } from '../src/fusion.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';
import { SOFT_SIGNAL_REVISIONS } from '../src/evidence.ts';
import { FAMILIES_C2B } from '../src/families.ts';
import type { Profile, Signal } from '../src/types.ts';
import { aiAgent, humanDesktop, humanMobile, scriptedBot } from './traces.ts';

const score = (events: readonly TraceEvent[], extra: Signal[] = [], profile: Profile = 'generic') => {
  const b = extractBehavior(events, 30000);
  return fuse({
    signals: [...extra, ...b.signals],
    profile,
    action: 'pageview',
    sig: DEFAULT_SIGNATURES,
    behaviorReliability: b.stats.reliability,
    driveReliability: b.stats.driveReliability,
    sessionId: 'fp',
  });
};
const software: Signal[] = [{ code: 'env.webgl_software', group: 'E', target: 'both', llr: 2.2 }];
describe('human false-positive regression scenarios', () => {
  it.each(Object.entries(SOFT_SIGNAL_REVISIONS))('softens legacy %s observations even when reported as hard', (code, revision) => {
    const v = score([], [{ code, group: revision.previousGroup, target: 'bot', llr: revision.previousLlr, hard: revision.previousHard }]);
    expect(v.class).toBe('human');
    expect(v.confidence).toBeLessThanOrEqual(0.25);
  });

  it('requires distinct behavior families, not two correlated timing rules', () => {
    const v = score(
      [],
      [
        ...software,
        { code: 'drive.zero_press_duration', group: 'D', target: 'both', llr: 2 },
        { code: 'drive.constant_press_duration', group: 'D', target: 'both', llr: 1.8 },
      ],
    );
    expect(v.class).toBe('human');
    expect(v.reasons).toContainEqual(expect.objectContaining({ code: 'evidence.insufficient_automation' }));
  });

  describe('C2b families: missing approach and motionless pauses never corroborate each other', () => {
    const observed = (signals: Signal[]) =>
      fuse({
        signals, profile: 'generic', action: 'pageview', sig: DEFAULT_SIGNATURES, behaviorReliability: 1, driveReliability: 1,
        sessionId: 'fp', families: FAMILIES_C2B,
      });
    const noApproach: Signal = { code: 'drive.click_without_approach', group: 'D', target: 'agent', llr: 2.5 };
    const pauses: Signal = { code: 'rhythm.think_then_act', group: 'R', target: 'agent', llr: 2.2 };
    const deadCentre: Signal = { code: 'drive.click_dead_centre', group: 'D', target: 'agent', llr: 2 };

    it.each([
      ['no approach and pauses (voice control, reading)', [noApproach, pauses]],
      ['no approach and dead-centre clicks (one geometry family)', [noApproach, deadCentre]],
      ['pauses and dead-centre clicks (one geometry family)', [pauses, deadCentre]],
      ['pauses alone', [pauses]],
      ['no approach alone', [noApproach]],
    ])('stays human-leaning for %s', (_name, signals) => {
      const v = observed(signals as Signal[]);
      expect(v.class).toBe('human');
      expect(v.evidence).toBe('insufficient');
    });
  });

  it('does not mistake reading pauses, keyboard navigation and page scrolling for an agent', () => {
    const events: TraceEvent[] = [1000, 5000, 9000, 14000].flatMap((t) => [
      { k: 'kd', t, sp: 't' },
      { k: 'fo', t: t + 10 },
      { k: 'ck', t: t + 100, d: 0 },
      { k: 'sc', t: t + 700 },
    ]);
    expect(score(events, software).class).toBe('human');
  });
  it.each(Object.keys(DEFAULT_SIGNATURES.priors) as Profile[])('does not label a passive software-rendered %s visitor a bot', (profile) => {
    const v = score([], software, profile);
    expect(v.class).toBe('human');
    expect(v.confidence).toBeLessThanOrEqual(0.25);
  });
  it('does not turn environment-only anomalies into confirmed automation', () => {
    const v = score(
      [],
      [
        ...software,
        { code: 'env.no_plugins', group: 'E', target: 'both', llr: 2 },
        { code: 'env.no_browser_chrome', group: 'E', target: 'both', llr: 1.2 },
      ],
    );
    expect(v.class).toBe('human');
    expect(v.confidence).toBeLessThanOrEqual(0.25);
  });
  it('does not classify an empty visit from a site prior or attack mode alone', () => {
    const v = fuse({
      signals: [],
      profile: 'ticketing',
      action: 'gift_card',
      attackMode: true,
      sitePrior: { bot: 0.8, agent: 0.1 },
      sig: DEFAULT_SIGNATURES,
      behaviorReliability: 0,
      sessionId: 'fp',
    });
    expect(v.class).toBe('human');
    expect(v.confidence).toBe(0);
  });
  it('does not treat uncoalesced pointer samples as automation', () => {
    const events: TraceEvent[] = Array.from({ length: 30 }, (_, i) => ({
      k: 'mv',
      t: 1000 + i * 16,
      pt: 'm',
      x: i * 2,
      y: Math.sin(i) * 4,
      co: 1,
    }));
    expect(extractBehavior(events, 30000).signals.map((s) => s.code)).not.toContain('drive.no_coalesced_samples');
    expect(score(events, software).class).toBe('human');
  });
  it('does not label browser-menu paste, dictation and password-manager fill as agents', () => {
    const events: TraceEvent[] = [1000, 5000, 9000, 14000].flatMap((t) => [
      { k: 'fo', t },
      { k: 'ps', t: t + 5 },
      { k: 'in', t: t + 10, it: 'p', n: 15 },
      { k: 'in', t: t + 200, it: 't', n: 6 },
    ]);
    expect(score(events, software).class).toBe('human');
    expect(extractBehavior(events, 30000).signals.map((s) => s.code)).not.toContain('drive.paste_without_shortcut');
  });
  it('ignores missing keystrokes for touch keyboards and IME composition', () => {
    const events: TraceEvent[] = [1000, 5000, 9000].flatMap((t) => [
      { k: 'ts', t, x: 20, y: 20 },
      { k: 'in', t: t + 100, it: 'c', n: 2 },
      { k: 'in', t: t + 200, it: 't', n: 4 },
    ]);
    expect(extractBehavior(events, 30000).signals.map((s) => s.code)).not.toContain('drive.insert_text_without_keys');
    expect(score(events, software).class).toBe('human');
  });
  it('does not infer teleport clicks when the ring has already evicted approach movement', () => {
    const ring = new Ring(4000, 20);
    for (const event of humanDesktop(3)) ring.push(event);
    expect(ring.completeSince).toBeGreaterThan(0);
    expect(extractBehavior(ring.events, 30000, ring.completeSince).signals.map((s) => s.code)).not.toContain(
      'drive.click_without_approach',
    );
  });
  it('does not identify page-dispatched synthetic events as the visitor being a bot', () => {
    const events = scriptedBot().map((e) => ({ ...e, u: true }));
    expect(score(events, software).class).toBe('human');
  });
  it('does not treat rounded zero keyboard timestamps as superhuman typing', () => {
    const events: TraceEvent[] = Array.from(
      { length: 14 },
      (_, i) =>
        [
          { k: 'kd', t: 1000, ks: i },
          { k: 'ku', t: 1000, ks: i },
        ] as TraceEvent[],
    ).flat();
    const codes = extractBehavior(events, 30000).signals.map((s) => s.code);
    expect(codes).not.toContain('bio.superhuman_typing');
    expect(codes).not.toContain('bio.constant_key_hold');
  });
  it('does not treat timestamp-rounded clicks as zero-duration bot presses', () => {
    const events: TraceEvent[] = [2000, 6000, 10000, 14000].flatMap((t) => [
      { k: 'dn', t, pt: 'm', ox: 0, oy: 0, w: 100, h: 40 },
      { k: 'up', t },
    ]);
    expect(extractBehavior(events, 30000).signals.map((s) => s.code)).not.toContain('drive.zero_press_duration');
    expect(score(events, software).class).toBe('human');
  });
  it('still detects explicit automation and representative agents/bots', () => {
    expect(score([], [{ code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true }]).class).toBe('bot');
    expect(score(scriptedBot(), software).class).not.toBe('human');
    for (let seed = 1; seed <= 20; seed++) expect(score(aiAgent(seed)).class, `agent ${seed}`).toBe('agent');
  });

  it('detects centred automated clicks with coincident native timestamps from behavior alone', () => {
    const events: TraceEvent[] = [1200, 1800, 2400, 3000].flatMap((t) => [
      { k: 'dn', t, pt: 'm', ox: 0, oy: 0, w: 180, h: 40 },
      { k: 'up', t, pt: 'm', holdMs: 0.5 },
    ]);
    expect(extractBehavior(events, 5000).signals.map(s => s.code)).toContain('drive.zero_press_duration');
    expect(score(events).class).not.toBe('human');
  });

  it.each(['rounded-native', 'queued-dispatch'] as const)('retains human press duration with %s timing', (clock) => {
    const events: TraceEvent[] = [2000, 6000, 10000, 14000].flatMap((t, i) => [
      { k: 'dn', t, pt: 'm', ox: 0, oy: 0, w: 100, h: 40 },
      { k: 'up', t: t + (clock === 'queued-dispatch' ? 70 + i * 20 : 0), holdMs: clock === 'rounded-native' ? 70 + i * 20 : 0.5 },
    ]);
    expect(extractBehavior(events, 30000).signals.map(s => s.code)).not.toContain('drive.zero_press_duration');
    expect(score(events, software).class).toBe('human');
  });
});

const NEW_CODES = ['drive.synthetic_field_fill', 'drive.scroll_jump', 'drive.uniform_scroll_bursts', 'bio.smooth_synthetic_curve', 'bio.no_deceleration'];
const newCodes = (ev: TraceEvent[], now = 30000, since = 0) => extractBehavior(ev, now, since).signals.map((s) => s.code).filter((c) => NEW_CODES.includes(c));

describe('FP-Agent / BeCAPTCHA detectors: human false-positive regressions', () => {
  it('stay silent on 50 seeds of synthetic desktop and mobile humans', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(newCodes(humanDesktop(seed))).toEqual([]);
      expect(newCodes(humanMobile(seed))).toEqual([]);
    }
  });
  it('input mask reformatting while typing', () => {
    const ev: TraceEvent[] = [2000, 2150, 2300, 2450, 2600].flatMap((t, i) => [
      { k: 'kd', t, ks: i }, { k: 'in', t: t + 1, it: 't', n: 1 }, { k: 'iv', t: t + 2, fs: 1, u: true }, { k: 'iv', t: t + 3, fs: 2, u: true },
    ]);
    expect(newCodes(ev)).toEqual([]);
  });
  it('date picker and dependent-field scripts after clicks', () => {
    const ev: TraceEvent[] = [3000, 6000, 9000].flatMap((t, i) => [{ k: 'dn', t, pt: 'm' }, { k: 'ch', t: t + 200, fs: 10 + i, u: true }]);
    expect(newCodes(ev)).toEqual([]);
  });
  it('page-load prefill and scroll restoration', () => {
    const ev: TraceEvent[] = [
      { k: 'iv', t: 100, fs: 1, u: true }, { k: 'iv', t: 120, fs: 2, u: true },
      { k: 'sc', t: 50, sy: 0, h: 800 }, { k: 'se', t: 50, sy: 0, h: 800 },
      { k: 'sc', t: 200, sy: 2400, h: 800 }, { k: 'se', t: 200, sy: 2400, h: 800 },
      { k: 'sc', t: 400, sy: 4800, h: 800 }, { k: 'se', t: 400, sy: 4800, h: 800 },
    ];
    expect(newCodes(ev)).toEqual([]);
  });
  it('anchor-link navigation and End key', () => {
    const ev: TraceEvent[] = [
      { k: 'sc', t: 1200, sy: 0, h: 800 }, { k: 'se', t: 1200, sy: 0, h: 800 },
      { k: 'dn', t: 3000, pt: 'm' }, { k: 'sc', t: 3100, sy: 2400, h: 800 }, { k: 'se', t: 3100, sy: 2400, h: 800 },
      { k: 'kd', t: 6000, sp: 'n' }, { k: 'sc', t: 6050, sy: 9000, h: 800 }, { k: 'se', t: 6050, sy: 9000, h: 800 },
    ];
    expect(newCodes(ev)).toEqual([]);
  });
});
