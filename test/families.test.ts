import { describe, expect, it } from 'vitest';
import { extractBehavior } from '../src/behavior/features.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';
import { BEHAVIOR_FAMILIES } from '../src/evidence.ts';
import { FAMILIES_C2B } from '../src/families.ts';
import { fuse, type FuseInput } from '../src/fusion.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';
import type { Signal, Verdict } from '../src/types.ts';
import { aiAgent, bezierBot, functionBot, humanDesktop, humanMobile, jsFillAgent, scriptedBot, visionAgent } from './traces.ts';

const noApproach: Signal = { code: 'drive.click_without_approach', group: 'D', target: 'agent', llr: 2.5 };
const pauses: Signal = { code: 'rhythm.think_then_act', group: 'R', target: 'agent', llr: 2.2 };
const zeroPress: Signal = { code: 'drive.zero_press_duration', group: 'D', target: 'both', llr: 2 };
const superhumanTyping: Signal = { code: 'bio.superhuman_typing', group: 'C', target: 'both', llr: 2.5 };
const insertWithoutKeys: Signal = { code: 'drive.insert_text_without_keys', group: 'D', target: 'agent', llr: 2 };

const observed = (signals: Signal[], extra: Partial<FuseInput> = {}): Verdict =>
  fuse({ signals, profile: 'generic', action: 'pageview', sig: DEFAULT_SIGNATURES, behaviorReliability: 1, driveReliability: 1, sessionId: 'f', ...extra });

describe('corroboration families', () => {
  it('keeps no-approach and motionless pauses out of the default families', () => {
    expect(BEHAVIOR_FAMILIES['drive.click_without_approach']).toBeUndefined();
    expect(BEHAVIOR_FAMILIES['rhythm.think_then_act']).toBeUndefined();
  });

  it('C2b adds exactly no-approach and motionless pauses to geometry', () => {
    expect(FAMILIES_C2B).toEqual({
      ...BEHAVIOR_FAMILIES,
      'drive.click_without_approach': 'geometry',
      'rhythm.think_then_act': 'geometry',
    });
    expect(Object.isFrozen(FAMILIES_C2B)).toBe(true);
  });

  it('guards zero-duration presses with no approach by default', () => {
    const v = observed([zeroPress, noApproach]);
    expect(v.class).toBe('human');
    expect(v.probability.human).toBe(0.51);
    expect(v.evidence).toBe('insufficient');
  });

  it.each([
    ['zero-duration presses with no approach', [zeroPress, noApproach]],
    ['zero-duration presses with motionless pauses', [zeroPress, pauses]],
    ['superhuman typing with no approach', [superhumanTyping, noApproach]],
  ])('corroborates %s with the C2b families', (_name, signals) => {
    const v = observed(signals, { families: FAMILIES_C2B });
    expect(v.class).toBe('agent');
    expect(v.evidence).toBe('sufficient');
    expect(v.reasons.map((reason) => reason.code)).not.toContain('evidence.insufficient_automation');
  });

  it('still counts a text family with pauses under C2b (the dictation risk the shadow measures)', () => {
    expect(observed([insertWithoutKeys, pauses]).class).toBe('human');
    expect(observed([insertWithoutKeys, pauses], { families: FAMILIES_C2B }).class).toBe('agent');
  });

  it('accepts any family map, so the server can try a rule without a client release', () => {
    const v = observed([zeroPress, noApproach], { families: { 'drive.zero_press_duration': 'a', 'drive.click_without_approach': 'b' } });
    expect(v.class).toBe('agent');
    expect(observed([zeroPress, noApproach], { families: {} }).evidence).toBe('insufficient');
  });
});

describe('verdict.evidence (the corroboration guard)', () => {
  it('reports sufficient when nothing needed guarding', () => {
    expect(observed([]).evidence).toBe('sufficient');
    expect(observed([{ code: 'auto.webdriver', group: 'A', target: 'bot', llr: 8, hard: true }]).evidence).toBe('sufficient');
  });

  it('reports insufficient whenever the guard rewrites the verdict, and never changes the class', () => {
    const v = observed([noApproach]);
    expect(v.evidence).toBe('insufficient');
    expect(v.class).toBe('human');
    expect(v.confidence).toBeLessThanOrEqual(0.25);
    expect(v.reasons[0].code).toBe('evidence.insufficient_automation');
  });
});

describe('the default family map is the default path', () => {
  const traces: Array<[string, (seed: number) => TraceEvent[], Signal[]]> = [
    ['human desktop', (s) => humanDesktop(s), []],
    ['human mobile', (s) => humanMobile(s), []],
    ['ai agent', (s) => aiAgent(s), []],
    ['vision agent', (s) => visionAgent(s), []],
    ['js-fill agent', (s) => jsFillAgent(s), []],
    ['scripted bot', (s) => scriptedBot(s), []],
    ['bezier bot', (s) => bezierBot(s), []],
    ['function bot', (s) => functionBot(s), []],
  ];
  const fused = (events: TraceEvent[], families?: Readonly<Record<string, string>>) => {
    const b = extractBehavior(events, events.length ? events[events.length - 1].t + 500 : 0);
    const { ts: _ts, ...verdict } = observed(b.signals, {
      behaviorReliability: b.stats.reliability,
      driveReliability: b.stats.driveReliability,
      ...(families ? { families } : {}),
    });
    return verdict;
  };

  it.each(traces)('fuses %s identically with no map and with the default map', (_name, trace) => {
    for (let seed = 1; seed <= 10; seed++) {
      const events = trace(seed);
      expect(fused(events, BEHAVIOR_FAMILIES)).toEqual(fused(events));
    }
  });
});
