// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"disableJavaScriptEvaluation":true}}
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanMarkers, watchMarkers } from '../src/env/markers.ts';
import { detectPage, validAction } from '../src/profile.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';
import { timeline } from '../src/timeline.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';

/** Minimal window for detectPage: a real happy-dom document plus a fake location. */
const page = (html: string, url = 'https://shop.example/', globals: Record<string, unknown> = {}) => {
  document.head.innerHTML = '';
  document.body.innerHTML = html;
  const u = new URL(url);
  return { document, location: { host: u.host, pathname: u.pathname, search: u.search }, ...globals } as unknown as Window;
};

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('detectPage', () => {
  it.each([
    ['<script type="application/json" src="https://js.stripe.com/v3/"></script>', 'https://x.test/', 'payments', 'payment'],
    ['<input autocomplete="cc-number">', 'https://x.test/', 'payments', 'payment'],
    ['<form action="/cart/add"></form>', 'https://x.test/cart', 'ecommerce', 'add_to_cart'],
    ['<div itemtype="https://schema.org/Product"></div>', 'https://x.test/p', 'ecommerce', 'pageview'],
    ['', 'https://x.test/checkout', 'generic', 'checkout'],
    ['<input type="password"><input type="password">', 'https://x.test/', 'generic', 'signup'],
    ['<input type="password">', 'https://app.x.test/', 'saas', 'login'],
    ['', 'https://x.test/login', 'generic', 'login'],
    ['', 'https://dashboard.x.test/sign-up', 'saas', 'signup'],
    ['', 'https://x.test/forgot', 'generic', 'password_reset'],
    ['', 'https://x.test/?q=shoes', 'generic', 'search'],
    ['', 'https://x.test/search', 'generic', 'search'],
    ['<form class="hs-form"></form>', 'https://x.test/', 'leadgen', 'pageview'],
    ['', 'https://x.test/?gclid=1', 'leadgen', 'pageview'],
    ['<textarea name="comment"></textarea>', 'https://x.test/', 'social', 'pageview'],
  ])('%s at %s → %s / %s', (html, url, profile, action) => {
    const p = detectPage(page(html, url));
    expect([p.profile, p.action]).toEqual([profile, action]);
  });

  it('uses globals, head meta and explicit profiles, and tolerates bad selectors', () => {
    expect(detectPage(page('', 'https://x.test/', { Shopify: {} })).profile).toBe('ecommerce');
    expect(detectPage(page('', 'https://x.test/', { googletag: {} })).profile).toBe('content');
    document.head.innerHTML = '<meta property="og:type" content="article">';
    expect(detectPage({ document, location: { host: 'x', pathname: '/', search: '' } } as unknown as Window).profile).toBe('content');
    expect(detectPage(page('', 'https://x.test/'), 'fintech').profile).toBe('fintech');
    const w = page('');
    vi.spyOn(document, 'querySelector').mockImplementation(() => { throw new Error('bad selector'); });
    expect(detectPage(w)).toEqual(expect.objectContaining({ profile: 'generic', payment: false }));
  });

  it('validates action names', () => {
    expect(validAction('checkout/step_2')).toBe(true);
    expect(validAction('bad action!')).toBe(false);
    expect(validAction('x'.repeat(65))).toBe(false);
  });
});

describe('markers', () => {
  it('scans agent DOM markers, skipping invalid selectors', () => {
    document.body.innerHTML = '<div id="claude-agent-stop-container"></div><div data-skyvern-otp-box></div>';
    const s = scanMarkers(document, DEFAULT_SIGNATURES);
    expect(s.map((x) => x.code)).toEqual(['marker.claude_active', 'marker.claude', 'marker.skyvern']);
    expect(s[0]).toEqual(expect.objectContaining({ hard: true, family: 'claude', group: 'A' }));
    const bad = { ...DEFAULT_SIGNATURES, markers: [{ selector: '[[', family: 'claude' as const, target: 'agent' as const, code: 'x' }, { selector: '#claude-agent-stop-container', family: 'claude' as const, target: 'agent' as const, code: 'soft', llr: 3 }] };
    expect(scanMarkers(document, bad)).toEqual([expect.objectContaining({ code: 'soft', hard: false, llr: 3 })]);
  });

  it('watches for late markers once each, debounced, and stops cleanly', async () => {
    vi.useFakeTimers();
    const hits: string[][] = [];
    const stop = watchMarkers(document, DEFAULT_SIGNATURES, (s) => hits.push(s.map((x) => x.code)));
    expect(hits).toEqual([]);
    const el = document.createElement('div');
    el.id = 'pplx-agent-overlay-stop-button';
    document.body.appendChild(el);
    await vi.advanceTimersByTimeAsync(10);
    document.body.appendChild(document.createElement('span')); // second mutation inside the debounce window
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(300);
    expect(hits).toEqual([['marker.comet']]);
    document.body.appendChild(document.createElement('p'));
    await vi.advanceTimersByTimeAsync(300);
    expect(hits).toHaveLength(1); // already reported
    document.body.appendChild(document.createElement('i'));
    stop(); // clears a pending timer
    await vi.advanceTimersByTimeAsync(300);
    expect(hits).toHaveLength(1);
    stop();
  });

  it('reports markers present at start and works without MutationObserver', () => {
    document.body.innerHTML = '<div unique_id="1"></div>';
    const hits: string[][] = [];
    const MO = globalThis.MutationObserver;
    // @ts-expect-error simulate an environment without MutationObserver
    delete globalThis.MutationObserver;
    try {
      const stop = watchMarkers(document, DEFAULT_SIGNATURES, (s) => hits.push(s.map((x) => x.code)));
      stop();
    } finally { globalThis.MutationObserver = MO; }
    expect(hits).toEqual([['marker.skyvern_ids']]);
  });
});

describe('timeline', () => {
  it('renders every event kind, summarises moves and typing, notes idle gaps and caps lines', () => {
    const ev: TraceEvent[] = [
      { k: 'mv', t: 10 }, { k: 'tm', t: 20 },
      { k: 'dn', t: 100, pt: 'm', ox: 0.1, oy: -0.2, sxm: true, u: true },
      { k: 'up', t: 120 }, { k: 'sc', t: 130 }, { k: 'ku', t: 131 },
      { k: 'ck', t: 140, d: 1, u: true },
      { k: 'kd', t: 200 }, { k: 'kd', t: 250 },
      { k: 'kd', t: 300, sp: 'b' },
      { k: 'in', t: 310, it: 'p', n: 12 }, { k: 'in', t: 311, it: 't' },
      { k: 'ps', t: 320 }, { k: 'wh', t: 330, dy: 4 }, { k: 'fo', t: 340 },
      { k: 'ts', t: 5000, f: 0.5 }, { k: 'ts', t: 5001 }, { k: 'te', t: 5010 },
      { k: 'dn', t: 5020, pt: 't' },
      { k: 'vh', t: 5030 }, { k: 'vv', t: 5040 }, { k: 'cm', t: 5050 },
      { k: 'kd', t: 6000 },
    ];
    const lines = timeline(ev);
    expect(lines).toEqual([
      't+0.1s pointer-down mouse offset(0.10,-0.20) approach=2 moves screen==client untrusted',
      't+0.1s click detail=1 untrusted',
      't+0.2s typed 2 keys',
      't+0.3s key backspace',
      't+0.3s input paste len=12',
      't+0.3s input insertText len=?',
      't+0.3s paste-event',
      't+0.3s wheel dy=4',
      't+0.3s focus field',
      't+5.0s (idle 4.7s, 0 moves) touch-start force=0.50',
      't+5.0s touch-start force=?',
      't+5.0s touch-end',
      't+5.0s pointer-down touch offset(?,?) approach=0 moves',
      't+5.0s tab hidden',
      't+5.0s tab visible',
      't+5.0s context-menu',
      't+6.0s typed 1 keys',
    ]);
    expect(timeline(ev, 3)).toHaveLength(3);
    expect(timeline([{ k: 'kd', t: 1 }, { k: 'x' as never, t: 2 }])).toEqual(['t+0.0s typed 1 keys']);
  });
});
