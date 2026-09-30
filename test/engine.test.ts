// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';

type W = Window & typeof globalThis;
const win = window as unknown as W & Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  // Keep async probes fast and deterministic: no worker, no client hints.
  Object.defineProperty(win, 'Worker', { value: undefined, configurable: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('createEngine', () => {
  it('keeps page-script interactions out of the physical-input timeline sent to the judge', async () => {
    // Happy DOM declares itself a headless browser; this case models a regular browser.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36');
    vi.spyOn(navigator, 'webdriver', 'get').mockReturnValue(false);
    const e = createEngine(win);
    try {
      await e.ready;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      window.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'scripted' }));
      const p = e.payload();
      expect(p.timeline).toEqual([]);
      expect(p.stats.events).toBe(0);
      expect(p.signals.some(s => s.c === 'drive.untrusted_events')).toBe(true);
      expect(p.verdict.class).toBe('human');
    } finally { e.stop(); }
  });
  it('accepts an agent marker already present at startup', async () => {
    document.body.innerHTML = '<div id="claude-agent-stop-container"></div>';
    const e = createEngine(win);
    try {
      await e.ready;
      expect(e.verdict().class).toBe('agent');
      expect(e.verdict().reasons.map(r => r.code)).toContain('marker.claude_active');
    } finally { e.stop(); }
  });

  it('scores immediately, resolves ready, and exposes page + session', async () => {
    const onVerdict = vi.fn();
    const e = createEngine(win, { sessionId: 'sess_fixed_0001', onVerdict });
    expect(e.sessionId).toBe('sess_fixed_0001');
    expect(e.verdict().sessionId).toBe('sess_fixed_0001');
    expect(e.page).toEqual(expect.objectContaining({ profile: expect.any(String), action: 'pageview' }));
    const v = await e.ready;
    expect(v.stage).toBe('provisional');
    expect(onVerdict).toHaveBeenCalledTimes(1);
    e.stop();
  });

  it('generates a 20-char session id when none is given', () => {
    const e = createEngine(win);
    expect(e.sessionId).toMatch(/^[a-z0-9]{20}$/);
    e.stop();
  });

  it('re-scores on the interval but only notifies on a changed verdict key', async () => {
    const onVerdict = vi.fn();
    const e = createEngine(win, { onVerdict, interval: 500 });
    await e.ready;
    await vi.advanceTimersByTimeAsync(2000);
    expect(onVerdict).toHaveBeenCalledTimes(1);
    const before = e.verdict().class;
    e.addSignals([{ code: 'auto.x', group: 'A', target: before === 'agent' ? 'bot' : 'agent', llr: 9, hard: true }]);
    expect(onVerdict).toHaveBeenCalledTimes(2);
    expect(e.verdict().class).not.toBe(before);
    e.stop();
  });

  it('picks up late-injected automation globals, then stops rescanning after 10 tries', async () => {
    const e = createEngine(win);
    await e.ready;
    win.__playwright_late = 1;
    await vi.advanceTimersByTimeAsync(3000);
    expect(e.score().reasons.map((r) => r.code)).toContain('global.playwright');
    const spy = vi.spyOn(Object, 'getOwnPropertyNames');
    await vi.advanceTimersByTimeAsync(3000 * 12);
    const calls = spy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000 * 3);
    expect(spy.mock.calls.length).toBe(calls); // rescans stopped
    delete win.__playwright_late;
    e.stop();
  });

  it('reports DOM agent markers as they appear', async () => {
    const onVerdict = vi.fn();
    const e = createEngine(win, { onVerdict });
    await e.ready;
    const el = document.createElement('div');
    el.id = 'claude-agent-stop-container';
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(300);
    expect(e.verdict().class).toBe('agent');
    e.stop();
  });

  it('judge evidence (group J) makes the verdict final', async () => {
    const e = createEngine(win);
    await e.ready;
    const v = e.addSignals([{ code: 'judge.jev', group: 'J', target: 'bot', llr: 2, detail: 'jev-latest' }]);
    expect(v.stage).toBe('final');
    expect(v.judge).toBe('jev-latest');
    expect(e.addSignals([{ code: 'edge.x', group: 'H', target: 'bot', llr: 0.1 }]).stage).toBe('final');
    e.stop();
  });

  it('score(action) computes for another action without changing the current verdict', async () => {
    const e = createEngine(win);
    await e.ready;
    const before = e.verdict();
    const v = e.score('signup');
    expect(v.action).toBe('signup');
    expect(e.verdict()).toBe(before);
    e.stop();
  });

  it('builds the beacon payload: referrer host, confident-human weight, signals and env', async () => {
    Object.defineProperty(document, 'referrer', { value: 'https://ref.example/path', configurable: true });
    const e = createEngine(win, { signatures: DEFAULT_SIGNATURES });
    await e.ready;
    e.addSignals([{ code: 'human.x', group: 'C', target: 'both', llr: -20 }]);
    const p = e.payload({ ga_client_id: '1.2' });
    expect(p).toEqual(expect.objectContaining({ v: 1, sid: e.sessionId, sigv: DEFAULT_SIGNATURES.version, ids: { ga_client_id: '1.2' } }));
    expect(p.page.ref).toBe('ref.example');
    expect(p.env).toEqual(expect.objectContaining({ lang: navigator.language, mobile: false }));
    expect(p.ua).toBe(navigator.userAgent.slice(0, 300));
    expect(Array.isArray(p.timeline)).toBe(true);
    // Every session is tracked: the weight is always 1, confident humans included (no sampling).
    expect(p.w).toBe(1);
    // External (H/J) evidence is never echoed back to the server.
    expect(p.signals.some((s) => s.c === 'human.x')).toBe(false);
    e.stop();
  });

  it('bots get weight 1; hard signals carry h=1; PCI-lite drops the timeline; no referrer → no ref', async () => {
    Object.defineProperty(document, 'referrer', { value: '', configurable: true });
    win.__playwright_x = 1;
    const e = createEngine(win, { pciLite: true });
    await e.ready;
    const p = e.payload();
    expect(p.w).toBe(1);
    expect(p.timeline).toEqual([]);
    expect(p.page.ref).toBeUndefined();
    expect(p.signals.find((s) => s.c === 'global.playwright')).toEqual(expect.objectContaining({ h: 1, t: 'bot', g: 'A' }));
    delete win.__playwright_x;
    e.stop();
  });

  it('survives async probes rejecting and an unavailable timezone', async () => {
    Object.defineProperty(navigator, 'permissions', { value: { query: () => Promise.reject(new Error('x')) }, configurable: true });
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('x'); });
    const e = createEngine(win);
    await e.ready;
    expect(e.payload().env.tz).toBe('');
    e.stop();
  });

  it('stop() halts timers and listeners', async () => {
    const onVerdict = vi.fn();
    const e = createEngine(win, { onVerdict, interval: 100 });
    await e.ready;
    e.stop();
    const n = onVerdict.mock.calls.length;
    win.__playwright_after_stop = 1;
    await vi.advanceTimersByTimeAsync(10000);
    expect(onVerdict.mock.calls.length).toBe(n);
    delete win.__playwright_after_stop;
  });
});
