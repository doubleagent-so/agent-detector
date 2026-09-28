import { describe, expect, it } from 'vitest';
import { resolveRoles, type RoleInput, type Roles } from '../src/attribution.ts';
import { catalogRoles, FINGERPRINTS, fingerprintRoles, ipListSources } from '../src/catalog/index.ts';
import type { Signal } from '../src/types.ts';

const header = (code: string, extra: Partial<Signal> = {}): Signal => ({ code, group: 'H', target: 'bot', llr: 4, ...extra });
const PLAYWRIGHT: Signal = { code: 'global.playwright', group: 'A', target: 'bot', llr: 9, hard: true, agentId: 'playwright.automation', detail: '__playwright__binding__' };
const WEBDRIVER: Signal = { code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true, detail: 'navigator.webdriver=true' };
const CLAUDEBOT_UA = header('ua.declared_agent:ClaudeBot', { family: 'claude', agentId: 'anthropic.claudebot' });
const ANTHROPIC_IP = header('verified.ip_range:anthropic', { llr: 5, family: 'claude' });
const NONE: Roles = { agent: null, operator: null, controller: null, client: null, conflict: false };
const roles = (signals: readonly Signal[], extra: Omit<RoleInput, 'catalog'> = {}) => resolveRoles(signals, { catalog: catalogRoles, ...extra });

function permutations<Item>(items: readonly Item[]): Item[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe('resolveRoles', () => {
  it('names agent, operator and controller separately, whatever the signal order', () => {
    const expected: Roles = {
      agent: { id: 'anthropic.claudebot', evidence: 'declared', source: 'ua.declared_agent:ClaudeBot' },
      operator: { id: 'anthropic', evidence: 'ip', source: 'verified.ip_range:anthropic' },
      controller: { id: 'playwright.automation', evidence: 'marker', source: 'global.playwright' },
      client: null,
      conflict: false,
    };
    const orders = permutations([PLAYWRIGHT, WEBDRIVER, CLAUDEBOT_UA, ANTHROPIC_IP]);
    expect(orders).toHaveLength(24);
    for (const order of orders) expect(roles(order), order.map((s) => s.code).join(' ')).toEqual(expected);
  });

  it('a controller alone names no agent and no operator', () => {
    expect(roles([PLAYWRIGHT, WEBDRIVER])).toEqual({ ...NONE, controller: { id: 'playwright.automation', evidence: 'marker', source: 'global.playwright' } });
  });

  it('a single-entry IP list names the agent; a shared list names only the operator', () => {
    const user = 'openai.chatgpt-user';
    expect(roles([header('ua.declared_agent:ChatGPT-User', { agentId: user }), header('verified.ip_range:openai_chatgpt_user', { llr: 5, agentId: user })])).toEqual({
      ...NONE,
      agent: { id: user, evidence: 'ip', source: 'verified.ip_range:openai_chatgpt_user' },
      operator: { id: 'openai', evidence: 'ip', source: 'verified.ip_range:openai_chatgpt_user' },
    });
    expect(roles([header('verified.ip_range:openai_gptbot', { llr: 5, agentId: 'openai.gptbot' })]).agent)
      .toEqual({ id: 'openai.gptbot', evidence: 'ip', source: 'verified.ip_range:openai_gptbot' });
    expect(roles([ANTHROPIC_IP])).toEqual({ ...NONE, operator: { id: 'anthropic', evidence: 'ip', source: 'verified.ip_range:anthropic' } });
  });

  it("drops a declared agent whose operator disagrees with the verified operator, and keeps that operator", () => {
    const google = header('verified.ip_range:google_user_fetchers', { llr: 5, family: 'google' });
    for (const order of permutations([CLAUDEBOT_UA, google]))
      expect(roles(order)).toEqual({ ...NONE, operator: { id: 'google', evidence: 'ip', source: 'verified.ip_range:google_user_fetchers' }, conflict: true });
  });

  it('prefers a Web Bot Auth signature, and a signer host proves its operator', () => {
    const signed = header('verified.web_bot_auth', { llr: 9, target: 'agent', agentId: 'openai.chatgpt-agent', detail: 'chatgpt.com' });
    expect(roles([header('ua.declared_agent:ChatGPT Agent', { agentId: 'openai.chatgpt-agent' }), signed])).toEqual({
      ...NONE,
      agent: { id: 'openai.chatgpt-agent', evidence: 'signed', source: 'verified.web_bot_auth' },
      operator: { id: 'openai', evidence: 'signed', source: 'verified.web_bot_auth' },
    });
    expect(roles([header('verified.web_bot_auth', { llr: 9, detail: 'operator.chatgpt.com' })]))
      .toEqual({ ...NONE, operator: { id: 'openai', evidence: 'signed', source: 'verified.web_bot_auth' } });
    expect(roles([header('verified.web_bot_auth', { llr: 9, detail: 'unknown.example' })])).toEqual(NONE);
  });

  it('takes an ERC-8004 declaration as the agent, authenticated when request auth is bound to it', () => {
    const declaration = { name: 'acme.shopper', authenticated: false };
    expect(roles([], { declaration })).toEqual({
      ...NONE,
      agent: { id: 'acme.shopper', evidence: 'declared', source: 'erc8004' },
      operator: { id: 'acme', evidence: 'declared', source: 'erc8004' },
    });
    // Authenticated evidence is proof of the agent itself: another operator's shared list is no conflict.
    expect(roles([header('verified.ip_range:google_user_fetchers', { llr: 5 })], { declaration: { ...declaration, authenticated: true } })).toEqual({
      ...NONE,
      agent: { id: 'acme.shopper', evidence: 'authenticated', source: 'erc8004' },
      operator: { id: 'acme', evidence: 'authenticated', source: 'erc8004' },
    });
    // A catalog token outranks an equally unproven declaration; a tool token names the controller.
    expect(roles([CLAUDEBOT_UA], { declaration }).agent?.id).toBe('anthropic.claudebot');
    expect(roles([header('ua.declared_agent:HeadlessChrome', { agentId: 'chrome.headless' })], { declaration })).toMatchObject({
      agent: { id: 'acme.shopper' },
      controller: { id: 'chrome.headless', evidence: 'declared', source: 'ua.declared_agent:HeadlessChrome' },
    });
  });

  it('ignores a blank declaration name: there is nothing to attribute to', () => {
    expect(roles([], { declaration: { name: '', authenticated: false } })).toEqual(NONE);
    expect(roles([], { declaration: { name: '   ', authenticated: true } })).toEqual(NONE);
  });

  it('proves the operator of an unknown agent id from its IP list', () => {
    const signal = header('verified.ip_range:anthropic', { llr: 5, agentId: 'nobody.nothing' });
    expect(roles([signal])).toEqual({ ...NONE, operator: { id: 'anthropic', evidence: 'ip', source: 'verified.ip_range:anthropic' } });
  });

  it('leaves an impersonated client unattributed and distrusts the rest of its user agent', () => {
    const spoofed = [
      header('ua.declared_agent:GPTBot', { agentId: 'openai.gptbot' }),
      header('net.unverified_claim:GPTBot', { llr: 1.5, agentId: 'openai.gptbot', detail: 'not in openai_gptbot' }),
    ];
    const expected: Roles = { ...NONE, agent: { id: null, evidence: 'spoofed', source: 'net.unverified_claim:GPTBot' } };
    for (const order of permutations(spoofed)) expect(roles(order)).toEqual(expected);
    expect(roles(spoofed, { declaration: { name: 'acme.shopper', authenticated: false } })).toEqual(expected);
    // What the page itself showed still counts.
    const marker: Signal = { code: 'marker.claude_active', group: 'A', target: 'agent', llr: 9, hard: true, agentId: 'anthropic.claude-in-chrome' };
    expect(roles([...spoofed, marker]).agent).toEqual({ id: 'anthropic.claude-in-chrome', evidence: 'marker', source: 'marker.claude_active' });
  });

  it('an authenticated declaration outranks a spoofed claim; an unauthenticated one does not', () => {
    const spoofed = [
      header('ua.declared_agent:GPTBot', { agentId: 'openai.gptbot' }),
      header('net.unverified_claim:GPTBot', { llr: 1.5, agentId: 'openai.gptbot', detail: 'not in openai_gptbot' }),
    ];
    expect(roles(spoofed, { declaration: { name: 'acme.shopper', authenticated: true } })).toEqual({
      ...NONE,
      agent: { id: 'acme.shopper', evidence: 'authenticated', source: 'erc8004' },
      operator: { id: 'acme', evidence: 'authenticated', source: 'erc8004' },
    });
    expect(roles(spoofed, { declaration: { name: 'acme.shopper', authenticated: false } }))
      .toEqual({ ...NONE, agent: { id: null, evidence: 'spoofed', source: 'net.unverified_claim:GPTBot' } });
  });

  it('names nobody for a human, and ignores negative or shadowed evidence and unknown ids', () => {
    expect(roles([{ code: 'human.mouse_kinematics', group: 'C', target: 'both', llr: -1.5 }])).toEqual(NONE);
    expect(roles([header('ua.declared_agent:GPTBot', { llr: -1, agentId: 'openai.gptbot' })])).toEqual(NONE);
    expect(roles([{ ...PLAYWRIGHT, llr: 0 }])).toEqual(NONE);
    expect(roles([header('ua.declared_agent:x', { agentId: 'nobody.nothing' }), PLAYWRIGHT]).agent).toBeNull();
  });

  it('prefers what the page showed for a controller, then strength, then id', () => {
    const headless = header('ua.declared_agent:HeadlessChrome', { agentId: 'chrome.headless' });
    const selenium: Signal = { code: 'global.selenium', group: 'A', target: 'bot', llr: 9, hard: true, agentId: 'selenium.webdriver' };
    for (const order of permutations([headless, PLAYWRIGHT])) expect(roles(order).controller?.id).toBe('playwright.automation');
    for (const order of permutations([selenium, PLAYWRIGHT])) expect(roles(order).controller?.id).toBe('playwright.automation');
  });

  it('breaks a tie between equal evidence and llr by id, whichever order they arrive in', () => {
    const a: Signal = { code: 'marker.a', group: 'A', target: 'agent', llr: 9, agentId: 'anthropic.claude-in-chrome' };
    const b: Signal = { code: 'marker.b', group: 'A', target: 'agent', llr: 9, agentId: 'perplexity.comet' };
    for (const order of permutations([a, b])) expect(roles(order).agent?.id).toBe('anthropic.claude-in-chrome');
  });

  it('marks model-only attribution as detected, and passes the client through', () => {
    const judged: Signal = { code: 'judge.model', group: 'J', target: 'agent', llr: 3, agentId: 'openai.chatgpt-agent' };
    expect(roles([judged]).agent).toEqual({ id: 'openai.chatgpt-agent', evidence: 'detected', source: 'judge.model' });
    const client = { browser: 'Chrome', version: '140', os: 'Linux', evidence: 'declared' as const };
    expect(roles([], { client }).client).toEqual(client);
  });
});

describe('role catalogs', () => {
  it('the browser fingerprints agree with the full catalog', () => {
    for (const fingerprint of FINGERPRINTS)
      expect(fingerprintRoles.entry(fingerprint.id), fingerprint.id).toEqual(catalogRoles.entry(fingerprint.id));
    expect(fingerprintRoles.entry('openai.gptbot')).toBeUndefined();
    expect(fingerprintRoles.ipListOperator('anthropic')).toBeUndefined();
    expect(fingerprintRoles.hostOperator('chatgpt.com')).toBeUndefined();
  });

  it('knows controllers, list operators and signer hosts', () => {
    expect(catalogRoles.entry('anthropic.claudebot')).toEqual({ id: 'anthropic.claudebot', operator: 'anthropic', family: 'claude', controller: false });
    expect(catalogRoles.entry('python.requests')?.controller).toBe(true);
    expect(catalogRoles.entry('playwright.automation')?.controller).toBe(true);
    expect(catalogRoles.entry('nobody.nothing')).toBeUndefined();
    expect(catalogRoles.ipListOperator('anthropic')).toBe('anthropic');
    expect(catalogRoles.ipListOperator('no_such_list')).toBeUndefined();
    expect(catalogRoles.hostOperator('operator.chatgpt.com')).toBe('openai');
    for (const list of ipListSources()) expect(new Set(list.entries.map((entry) => entry.operator)).size, list.vendor).toBe(1);
  });
});
