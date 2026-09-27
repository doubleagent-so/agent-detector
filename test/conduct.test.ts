import { describe, expect, it } from 'vitest';
import { assessConduct, applyConduct, DEFAULT_AGENT_POLICY, parseAgentPolicy, type AgentPolicy } from '../src/conduct.ts';
import { fuse } from '../src/fusion.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';
import type { Signal } from '../src/types.ts';
const verified: Signal = {
  code: 'verified.web_bot_auth',
  group: 'H',
  target: 'agent',
  llr: 9,
  hard: true,
  agentId: 'openai.chatgpt-agent',
  family: 'openai',
};
const policy: AgentPolicy = {
  ...DEFAULT_AGENT_POLICY,
  mode: 'enforce',
  rules: [{ id: 'shopping', effect: 'allow', actions: ['checkout'], agentIds: ['openai.chatgpt-agent'] }],
};
const input = { action: 'checkout', signals: [verified], policy };
const normal = { requests: 1, failedAuth: 0, deniedActions: 0, honeypotHits: 0 };
describe('observed conduct and authorization', () => {
  it('does not conflate automation, unknown identity, or verified identity with conduct', () => {
    for (const signals of [[], [verified], [{ ...verified, group: 'A' as const, code: 'marker.fake' }]]) {
      expect(assessConduct({ action: 'checkout', signals }).behavior.label).toBe('neutral');
    }
    expect(assessConduct({ ...input, signals: [{ ...verified, group: 'A', code: 'marker.fake' }] }).authorization.decision).toBe('unknown');
  });
  it('requires a server-verified scoped allow rule for friendly behavior', () => {
    expect(assessConduct(input)).toMatchObject({
      behavior: { label: 'friendly', risk: 0 },
      authorization: { decision: 'allowed', ruleId: 'shopping' },
    });
    expect(assessConduct({ ...input, action: 'payment' }).behavior.label).toBe('neutral');
    expect(assessConduct({ ...input, signals: [{ ...verified, agentId: 'some.other' }] }).behavior.label).toBe('neutral');
  });
  it('denies before allow even for a verified identity', () => {
    const p: AgentPolicy = {
      ...policy,
      rules: [...policy.rules, { id: 'no-checkout', effect: 'deny', actions: ['checkout'], agentIds: ['*'] }],
    };
    expect(assessConduct({ ...input, policy: p })).toMatchObject({ behavior: { label: 'rogue' }, authorization: { decision: 'denied' } });
  });
  it.each([
    [{ ...normal, requests: 121 }, 'abuse.request_rate'],
    [{ ...normal, failedAuth: 8 }, 'abuse.repeated_auth_failure'],
    [{ ...normal, deniedActions: 3 }, 'abuse.repeated_denied_action'],
    [{ ...normal, honeypotHits: 1 }, 'abuse.confirmed_trap'],
  ])('lets observed abuse override a friendly rule: %s', (activity, code) => {
    const result = assessConduct({ ...input, activity });
    expect(result.behavior.label).toBe('rogue');
    expect(result.behavior.reasons.some((r) => r.code === code && r.source === 'application')).toBe(true);
  });
  it('does not call one login mistake, missing signature, an IP burst or signature expiry rogue', () => {
    for (const over of [
      { activity: { ...normal, failedAuth: 1 } },
      { activity: { ...normal, deniedActions: 1 } },
      { integrity: { trust: 0.3, quarantined: true, reasons: ['ip_burst'] } },
      { signals: [verified, { ...verified, code: 'net.web_bot_auth_invalid', detail: 'expired' }] },
    ])
      expect(assessConduct({ ...input, ...over }).behavior.label).toBe('neutral');
  });
  it('monitor tags without automatic deny; enforce denies; quarantine never yields an allow', () => {
    const base = fuse({
      signals: [verified],
      profile: 'generic',
      action: 'checkout',
      sig: DEFAULT_SIGNATURES,
      behaviorReliability: 0,
      sessionId: 'session_123',
    });
    expect(base.recommendation).toBe('challenge');
    expect(applyConduct(base, input).recommendation).toBe('allow');
    const abusive = { ...input, activity: { ...normal, failedAuth: 9 } };
    expect(applyConduct(base, abusive).recommendation).toBe('deny');
    expect(applyConduct(base, { ...abusive, policy: { ...policy, mode: 'monitor' } }).recommendation).toBe('challenge');
    expect(applyConduct(base, { ...input, integrity: { trust: 0.2, quarantined: true, reasons: [] } })).toMatchObject({
      recommendation: 'challenge',
      behavior: { label: 'neutral' },
    });
  });
  it('validates policy bounds, unknown fields and duplicate rule IDs', () => {
    expect(parseAgentPolicy(policy)).toEqual(policy);
    for (const bad of [
      null,
      { ...policy, mode: 'allow_all' },
      { ...policy, limits: { ...policy.limits, requests: 0 } },
      { ...policy, rules: [...policy.rules, ...policy.rules] },
      { ...policy, trusted: true },
      { ...policy, rules: [{ ...policy.rules[0], actions: ['bad action'] }] },
    ])
      expect(() => parseAgentPolicy(bad)).toThrow();
  });
});

it('server-verified crawler identity takes precedence over a copied agent marker', () => {
  const v = fuse({
    signals: [
      { ...verified, target: 'bot', agentId: 'openai.gptbot' },
      { code: 'marker.claude_active', group: 'A', target: 'agent', llr: 9, hard: true, family: 'claude' },
    ],
    profile: 'generic',
    action: 'pageview',
    sig: DEFAULT_SIGNATURES,
    behaviorReliability: 0,
    sessionId: 'test',
  });
  expect(v.class).toBe('bot');
  expect(v.agent).toMatchObject({ id: 'openai.gptbot', verified: true, family: 'openai' });
});
