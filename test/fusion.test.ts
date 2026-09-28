import { describe, expect, it } from 'vitest';
import { extractBehavior } from '../src/behavior/features.ts';
import { catalogRoles } from '../src/catalog/index.ts';
import { fuse } from '../src/fusion.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';
import { timeline } from '../src/timeline.ts';
import type { Signal } from '../src/types.ts';
import { aiAgent, humanDesktop, humanMobile, scriptedBot } from './traces.ts';

const verdictFor = (ev: ReturnType<typeof humanDesktop>, extra: Signal[] = [], action = 'pageview', profile: any = 'generic') => {
  const dur = ev.length ? ev[ev.length - 1].t + 500 : 0;
  const b = extractBehavior(ev, dur);
  return fuse({ signals: [...b.signals, ...extra], profile, action, sig: DEFAULT_SIGNATURES, behaviorReliability: b.stats.reliability, driveReliability: b.stats.driveReliability, sessionId: 't' });
};

describe('behaviour + fusion on synthetic traces', () => {
  it('classifies desktop humans as human across seeds', () => {
    for (let s = 1; s <= 25; s++) {
      const v = verdictFor(humanDesktop(s));
      expect(v.class, `seed ${s}: ${JSON.stringify(v.reasons)}`).toBe('human');
      expect(v.recommendation).toBe('allow');
    }
  });

  it('classifies mobile humans as human (missing mouse data is not bot evidence)', () => {
    for (let s = 1; s <= 10; s++) expect(verdictFor(humanMobile(s)).class).toBe('human');
  });

  it('classifies CDP-driven LLM agents as agent', () => {
    for (let s = 1; s <= 20; s++) {
      const v = verdictFor(aiAgent(s));
      expect(v.class, `seed ${s}: ${JSON.stringify(v.probability)}`).toBe('agent');
      expect(v.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['drive.click_without_approach']));
    }
  });

  it('classifies scripted bots as non-human', () => {
    const v = verdictFor(scriptedBot(), [{ code: 'env.webgl_software', group: 'E', target: 'both', llr: 2.2 }]);
    expect(v.class).not.toBe('human');
    expect(v.probability.human).toBeLessThan(0.1);
  });

  it('hard evidence short-circuits', () => {
    const v = verdictFor(humanDesktop(3), [{ code: 'marker.claude_active', group: 'A', target: 'agent', llr: 9, hard: true, family: 'claude' }]);
    expect(v.class).toBe('agent');
    expect(v.agent?.family).toBe('claude');
    expect(v.probability.agent).toBeGreaterThan(0.98);
  });

  it('empty short visit stays human-leaning with low confidence', () => {
    const v = verdictFor([]);
    expect(v.class).toBe('human');
    expect(v.confidence).toBeLessThan(0.3);
  });

  it('group caps prevent correlated environment signals from double counting', () => {
    const env: Signal[] = Array.from({ length: 10 }, (_, i) => ({ code: `env.x${i}`, group: 'E', target: 'bot', llr: 2 }));
    const v = verdictFor(humanDesktop(5), env);
    // cap E=4 against strong human behaviour: must not flip to certain bot
    expect(v.probability.bot).toBeLessThan(0.9);
  });

  it('policy: signup deny vs content tag-only vs verification grants no commerce permission', () => {
    const hard: Signal[] = [{ code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true }];
    expect(verdictFor([], hard, 'signup').recommendation).toBe('deny');
    expect(verdictFor([], hard, 'login').recommendation).toBe('step_up');
    expect(verdictFor([], hard, 'pageview', 'content').recommendation).toBe('tag');
    expect(verdictFor([], hard, 'signup', 'gov').recommendation).toBe('tag');
    const verified: Signal[] = [{ code: 'verified.web_bot_auth', group: 'H', target: 'agent', llr: 8, family: 'openai' }];
    const v = verdictFor(aiAgent(1), verified, 'checkout', 'ecommerce');
    expect(v.agent).toMatchObject({ family: 'openai', verified: true });
    expect(v.recommendation).toBe('challenge');
  });

  it('timeline is compact text with precomputed facts', () => {
    const lines = timeline(aiAgent(1));
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.length).toBeLessThanOrEqual(60);
    expect(lines.join('\n')).toMatch(/idle [0-9.]+s, 0 moves\) pointer-down mouse offset\(0\.00,/);
  });

  it('feature extraction is fast', () => {
    const ev = humanDesktop(9, 120000);
    extractBehavior(ev, 120000); // warm up
    // Best of five: a single sample measures GC pauses and runner noise, not the code.
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      extractBehavior(ev, 120000);
      best = Math.min(best, performance.now() - t);
    }
    // CI runs under coverage instrumentation on shared runners, several times slower.
    const ci = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CI; // core has no Node types
    expect(best).toBeLessThan(ci ? 90 : 30);
  });

  it('weights shadow codes at zero without hiding other evidence', () => {
    const s: Signal = { code: 'drive.click_without_approach', group: 'D', target: 'agent', llr: 2.5 };
    const base = { profile: 'generic' as const, action: 'pageview', behaviorReliability: 1, driveReliability: 1, sessionId: 'shadow' };
    const on = fuse({ ...base, signals: [s], sig: DEFAULT_SIGNATURES });
    const off = fuse({ ...base, signals: [s], sig: { ...DEFAULT_SIGNATURES, shadow: ['drive.click_without_approach'] } });
    expect(off.probability.agent).toBeLessThan(on.probability.agent);
    expect(off.reasons.map((r) => r.code)).not.toContain('drive.click_without_approach');
    expect(DEFAULT_SIGNATURES.shadow).toEqual(expect.any(Array));
  });

  it('shadowed hard signal does not short-circuit', () => {
    const hard: Signal = { code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true };
    const base = { profile: 'generic' as const, action: 'pageview', behaviorReliability: 1, driveReliability: 1, sessionId: 'hard-shadow' };
    const withHard = fuse({ ...base, signals: [hard], sig: DEFAULT_SIGNATURES });
    const shadowed = fuse({ ...base, signals: [hard], sig: { ...DEFAULT_SIGNATURES, shadow: ['auto.webdriver'] } });
    expect(1 - withHard.probability.human).toBeGreaterThanOrEqual(0.99);
    expect(withHard.class).toBe('bot');
    expect(shadowed.probability.bot).toBeLessThan(0.9);
    expect(shadowed.class).toBe('human');
  });

  it('shadowed verified.* signal does not short-circuit or attribute', () => {
    const v: Signal = { code: 'verified.x', group: 'H', target: 'agent', llr: 6, hard: true, family: 'openai' };
    const base = { profile: 'generic' as const, action: 'pageview', behaviorReliability: 1, driveReliability: 1, sessionId: 'verified-shadow' };
    const on = fuse({ ...base, signals: [v], sig: DEFAULT_SIGNATURES });
    const off = fuse({ ...base, signals: [v], sig: { ...DEFAULT_SIGNATURES, shadow: ['verified.x'] } });
    expect(on.agent).toMatchObject({ verified: true, method: 'verified.x' });
    expect(off.agent?.verified).not.toBe(true);
    expect(off.class).toBe('human');
    expect(off.probability.agent).toBeLessThan(on.probability.agent);
  });

  it('hard signal without shadow still short-circuits', () => {
    const hard: Signal = { code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true };
    const base = { profile: 'generic' as const, action: 'pageview', behaviorReliability: 1, driveReliability: 1, sessionId: 'hard-no-shadow' };
    const v = fuse({ ...base, signals: [hard], sig: DEFAULT_SIGNATURES });
    // Controller-only evidence without deliberate driving: a certain bot.
    expect(1 - v.probability.human).toBeGreaterThanOrEqual(0.99);
    expect(v.class).toBe('bot');
  });
});

describe('attribution in the verdict', () => {
  const base = { profile: 'generic' as const, action: 'pageview', sig: DEFAULT_SIGNATURES, behaviorReliability: 0, sessionId: 'roles' };
  const PLAYWRIGHT: Signal = { code: 'global.playwright', group: 'A', target: 'bot', llr: 9, hard: true, agentId: 'playwright.automation' };
  const WEBDRIVER: Signal = { code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true };
  const CLAUDEBOT_UA: Signal = { code: 'ua.declared_agent:ClaudeBot', group: 'H', target: 'bot', llr: 4, family: 'claude', agentId: 'anthropic.claudebot' };
  const ANTHROPIC_IP: Signal = { code: 'verified.ip_range:anthropic', group: 'H', target: 'bot', llr: 5, family: 'claude' };
  const permutations = <Item,>(items: readonly Item[]): Item[][] =>
    items.length <= 1 ? [[...items]] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));

  it('attributes ClaudeBot on Anthropic IPs in a Playwright browser identically in every signal order', () => {
    const verdicts = permutations([PLAYWRIGHT, WEBDRIVER, CLAUDEBOT_UA, ANTHROPIC_IP]).map((signals) => fuse({ ...base, signals, catalog: catalogRoles }));
    for (const v of verdicts) {
      expect(v.class).toBe('bot');
      expect(v.agent).toEqual({
        family: 'claude', id: 'anthropic.claudebot', verified: true, method: 'verified.ip_range:anthropic', operator: 'anthropic', controller: 'playwright.automation',
      });
      expect({ ...v, ts: 0 }).toEqual({ ...verdicts[0], ts: 0 });
    }
  });

  it('keeps an idle automation tool a certain bot, above the SDK blocking thresholds', () => {
    for (const signals of [[WEBDRIVER], [PLAYWRIGHT], [PLAYWRIGHT, WEBDRIVER]]) {
      const idle = fuse({ ...base, signals });
      expect(idle.class).toBe('bot');
      expect(idle.probability.bot).toBeGreaterThanOrEqual(0.9);
      expect(idle.probability.human).toBeLessThanOrEqual(0.01);
      expect(idle.confidence).toBe(0.99);
    }
    // Recommendations follow non-human probability, so they are unchanged.
    expect(fuse({ ...base, action: 'signup', signals: [PLAYWRIGHT] }).recommendation).toBe('deny');
  });

  it('keeps a scripted automation run a bot when drive evidence has no human-like rhythm', () => {
    const scripted = fuse({
      ...base, behaviorReliability: 1, driveReliability: 1,
      signals: [PLAYWRIGHT, { code: 'drive.x', group: 'D', target: 'agent', llr: 2 }, { code: 'cadence.x', group: 'C', target: 'agent', llr: 1 }],
    });
    expect(scripted.scores.driving).toBeGreaterThan(0.85);
    expect(scripted.class).toBe('bot');
    expect(scripted.probability).toEqual({ human: 0.004, bot: 0.99, agent: 0.006 });
  });

  it('calls an automation tool with strong driving and rhythm an agent', () => {
    const driven = fuse({
      ...base, behaviorReliability: 1, driveReliability: 1,
      signals: [PLAYWRIGHT, { code: 'drive.x', group: 'D', target: 'agent', llr: 3 }, { code: 'rhythm.think_then_act', group: 'R', target: 'agent', llr: 2.2 }],
    });
    expect(driven.class).toBe('agent');
    expect(driven.probability).toEqual({ human: 0.004, bot: 0.006, agent: 0.99 });
    expect(driven.agent).toEqual({ family: 'unknown', verified: false, method: 'behavioral', controller: 'playwright.automation' });
  });

  it('leaves verified-agent verdicts unchanged', () => {
    const signed: Signal = { code: 'verified.web_bot_auth', group: 'H', target: 'agent', llr: 9, hard: true, family: 'openai', agentId: 'openai.chatgpt-agent', detail: 'chatgpt.com' };
    const v = fuse({ ...base, signals: [PLAYWRIGHT, signed], catalog: catalogRoles });
    expect(v.class).toBe('agent');
    expect(v.probability).toEqual({ human: 0.004, bot: 0.006, agent: 0.99 });
    expect(v.agent).toEqual({
      family: 'openai', id: 'openai.chatgpt-agent', verified: true, method: 'verified.web_bot_auth', operator: 'openai', controller: 'playwright.automation',
    });
  });

  it('attributes with the browser fingerprints by default, where header evidence names no product', () => {
    const marker: Signal = { code: 'marker.claude_active', group: 'A', target: 'agent', llr: 9, hard: true, family: 'claude', agentId: 'anthropic.claude-in-chrome' };
    expect(fuse({ ...base, signals: [CLAUDEBOT_UA, marker] }).agent).toEqual({
      family: 'claude', id: 'anthropic.claude-in-chrome', verified: false, method: 'marker.claude_active', operator: 'anthropic',
    });
  });
});
