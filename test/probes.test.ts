import { afterEach, describe, expect, it, vi } from 'vitest';
import { asyncEnvProbes, envContext, envProbes, hardProbes, scanGlobals, webglInfo, type EnvContext } from '../src/env/probes.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const LINUX_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

type Any = Record<string, any>;

/** A plausible desktop Chrome window; override any part. */
function fakeWin(o: { nav?: Any; win?: Any; renderer?: string | null; ext?: boolean; navProto?: Any } = {}): any {
  const renderer = o.renderer === undefined ? 'ANGLE (NVIDIA GeForce RTX 3080)' : o.renderer;
  const gl = renderer === null ? null : {
    VENDOR: 1, RENDERER: 2,
    getExtension: (n: string) => (n === 'WEBGL_debug_renderer_info' ? (o.ext === false ? null : { UNMASKED_VENDOR_WEBGL: 3, UNMASKED_RENDERER_WEBGL: 4 }) : n === 'WEBGL_lose_context' ? { loseContext: vi.fn() } : null),
    getParameter: (p: number) => (p === 1 || p === 3 ? 'Google Inc.' : renderer),
  };
  const nav = Object.assign(Object.create(o.navProto ?? {}), {
    userAgent: CHROME_WIN, languages: ['en-US', 'en'], language: 'en-US', hardwareConcurrency: 8, maxTouchPoints: 0,
    plugins: { length: 5 }, pdfViewerEnabled: true,
  }, o.nav);
  return Object.assign({
    navigator: nav,
    screen: { width: 1920, height: 1080, availHeight: 1040 },
    outerWidth: 1920, innerWidth: 1900, outerHeight: 1080, innerHeight: 950,
    document: { createElement: () => ({ getContext: (t: string) => (t === 'webgl' ? gl : null) }) },
  }, o.win);
}

const codes = (s: { code: string }[]) => s.map((x) => x.code);
const ctx = (over: Partial<EnvContext> = {}): EnvContext => ({ privacyMode: 'none', mobile: false, engine: 'blink', ...over });

afterEach(() => vi.restoreAllMocks());

describe('envContext', () => {
  it('detects engine, privacy mode and mobile', () => {
    expect(envContext(fakeWin())).toEqual({ privacyMode: 'none', mobile: false, engine: 'blink' });
    expect(envContext(fakeWin({ nav: { userAgent: SAFARI } })).engine).toBe('webkit');
    expect(envContext(fakeWin({ nav: { userAgent: 'curl/8' } })).engine).toBe('unknown');
    expect(envContext(fakeWin({ nav: { brave: {} } })).privacyMode).toBe('brave');
    expect(envContext(fakeWin({ nav: { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Mobile' } })).mobile).toBe(true);
    expect(envContext(fakeWin({ nav: { userAgentData: { mobile: true } } })).mobile).toBe(true);
  });

  it('detects Firefox resistFingerprinting (UTC + 200px-rounded sizes)', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
    expect(envContext(fakeWin({ nav: { userAgent: FIREFOX }, win: { screen: { width: 1400 }, innerWidth: 1200 } })).privacyMode).toBe('rfp');
    expect(envContext(fakeWin({ nav: { userAgent: FIREFOX }, win: { screen: { width: 1366 }, innerWidth: 1200 } })).privacyMode).toBe('none');
    const w = fakeWin({ nav: { userAgent: FIREFOX } });
    Object.defineProperty(w, 'screen', { get() { throw new Error('x'); } });
    expect(envContext(w).privacyMode).toBe('none');
  });
});

describe('hardProbes', () => {
  it('is clean for a normal browser', () => {
    expect(hardProbes(fakeWin(), DEFAULT_SIGNATURES)).toEqual([]);
  });

  it('flags webdriver=true, patched getters, HeadlessChrome and headless brands', () => {
    const nativeTrue = { get webdriver() { return true; } };
    Object.defineProperty(nativeTrue, 'webdriver', { get: (() => true).bind(null) }); // bound = "[native code]"
    expect(codes(hardProbes(fakeWin({ navProto: nativeTrue }), DEFAULT_SIGNATURES))).toEqual(['auto.webdriver']);
    const patched = { get webdriver() { return false; } };
    expect(codes(hardProbes(fakeWin({ navProto: patched }), DEFAULT_SIGNATURES))).toEqual(['auto.webdriver_patched']);
    expect(hardProbes(fakeWin({ navProto: patched }), DEFAULT_SIGNATURES)[0]).toMatchObject({ group: 'E', hard: false, llr: 1.5 });
    expect(codes(hardProbes(fakeWin({ nav: { webdriver: false } }), DEFAULT_SIGNATURES))).toEqual(['auto.webdriver_patched']); // own prop
    expect(codes(hardProbes(fakeWin({ nav: { userAgent: 'HeadlessChrome/140' } }), DEFAULT_SIGNATURES))).toEqual(['auto.headless_ua']);
    expect(codes(hardProbes(fakeWin({ nav: { userAgentData: { brands: [{ brand: 'HeadlessChrome' }] } } }), DEFAULT_SIGNATURES))).toEqual(['auto.headless_brand']);
    expect(codes(hardProbes(fakeWin({ nav: { userAgent: undefined } }), DEFAULT_SIGNATURES))).toEqual([]);
  });

  it('survives throwing navigator getters', () => {
    const evil = { get webdriver(): boolean { throw new Error('nope'); } };
    const w = fakeWin({ navProto: evil });
    Object.defineProperty(w.navigator, 'userAgentData', { get() { throw new Error('nope'); } });
    expect(codes(hardProbes(w, DEFAULT_SIGNATURES))).toEqual(['auto.webdriver_patched']);
  });
});

describe('scanGlobals', () => {
  it('matches automation globals on window and document once per rule', () => {
    const w = fakeWin({ win: { cdc_adoQpoasnfa76pfcZLmcfl_Array: 1, $cdc_x: 1, __stagehandInjected: 1 } });
    w.document.__playwright_evaluation = 1;
    const s = scanGlobals(w, DEFAULT_SIGNATURES);
    expect(codes(s).sort()).toEqual(['global.chromedriver', 'global.playwright', 'global.stagehand']);
    expect(s.find((x) => x.code === 'global.stagehand')).toEqual(expect.objectContaining({ target: 'agent', family: 'browserbase', agentId: 'browserbase.stagehand', hard: true }));
    expect(s.find((x) => x.code === 'global.chromedriver')).toEqual(expect.objectContaining({ target: 'bot', agentId: 'selenium.webdriver' }));
  });

  it('returns nothing when keys cannot be read', () => {
    expect(scanGlobals({ get document() { throw new Error('x'); } } as any, DEFAULT_SIGNATURES)).toEqual([]);
  });
});

describe('webglInfo', () => {
  it('reads the unmasked renderer, falls back to the masked one, and handles no WebGL', () => {
    expect(webglInfo(fakeWin())).toEqual({ vendor: 'Google Inc.', renderer: 'ANGLE (NVIDIA GeForce RTX 3080)' });
    expect(webglInfo(fakeWin({ ext: false }))).toEqual({ vendor: 'Google Inc.', renderer: 'ANGLE (NVIDIA GeForce RTX 3080)' });
    expect(webglInfo(fakeWin({ renderer: null }))).toBeNull();
    expect(webglInfo({ document: { createElement: () => { throw new Error('x'); } } } as any)).toBeNull();
  });
});

describe('envProbes', () => {
  it.each([false, undefined])('does not flag empty plugins when PDF support is %s', (pdfViewerEnabled) => {
    expect(codes(envProbes(fakeWin({ nav: { plugins: { length: 0 }, pdfViewerEnabled } }), ctx()))).not.toContain('env.no_plugins');
  });

  it('treats Node integration in desktop browsers as a soft environment observation', () => {
    const node = envProbes(fakeWin({ win: { process: { versions: { node: '24' } } } }), ctx()).find(s => s.code === 'auto.node_process');
    expect(node).toMatchObject({ group: 'E', llr: 1, hard: false });
  });
  it('is clean for a normal desktop Chrome', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ timeZone: 'Europe/Berlin' }) } as any);
    expect(envProbes(fakeWin(), ctx())).toEqual([]);
  });

  it.each([
    ['env.webgl_software', { renderer: 'Google SwiftShader' }],
    ['env.gpu_platform_mismatch', { renderer: 'Apple M2' }],
    ['env.gpu_platform_mismatch', { renderer: 'ANGLE (Direct3D11)', nav: { userAgent: CHROME_MAC } }],
    ['env.no_webgl', { renderer: null }],
    ['env.no_browser_chrome', { win: { outerWidth: 1280, innerWidth: 1280, outerHeight: 800, innerHeight: 800 } }],
    ['env.zero_outer', { win: { outerWidth: 0, outerHeight: 0 } }],
    ['env.agent_vm_resolution', { win: { screen: { width: 1280, height: 960, availHeight: 920 } } }],
    ['env.no_taskbar', { win: { screen: { width: 1920, height: 1080, availHeight: 1080 } } }],
    ['env.odd_cpu_count', { nav: { hardwareConcurrency: 7 } }],
    ['env.touch_on_linux_desktop', { nav: { userAgent: LINUX_CHROME, maxTouchPoints: 10 } }],
    ['env.no_plugins', { nav: { plugins: { length: 0 } } }],
    ['env.plugins_inconsistent', { nav: { pdfViewerEnabled: false } }],
    ['env.no_languages', { nav: { languages: [] } }],
    ['env.no_languages', { nav: { languages: undefined } }],
    ['env.language_mismatch', { nav: { language: 'fr-FR' } }],
    ['env.rtt_zero', { nav: { connection: { rtt: 0 } } }],
    ['auto.node_process', { win: { process: { versions: { node: '24' } } } }],
  ] as [string, Any][])('flags %s', (code, o) => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ timeZone: 'Europe/Berlin' }) } as any);
    expect(codes(envProbes(fakeWin(o), ctx()))).toContain(code);
  });

  it('flags UTC with a non-zero offset, and UTC on a consumer OS', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({ resolvedOptions: () => ({ timeZone: 'UTC' }) } as any);
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120);
    expect(codes(envProbes(fakeWin(), ctx()))).toEqual(expect.arrayContaining(['env.tz_mismatch', 'env.utc_consumer']));
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
    expect(codes(envProbes(fakeWin({ nav: { userAgent: LINUX_CHROME } }), ctx()))).not.toContain('env.utc_consumer');
  });

  it('checks eval.toString length per engine (node reports 33, like blink)', () => {
    expect(codes(envProbes(fakeWin({ nav: { userAgent: FIREFOX } }), ctx({ engine: 'gecko' })))).toContain('env.engine_mismatch');
    expect(codes(envProbes(fakeWin({ nav: { userAgent: SAFARI } }), ctx({ engine: 'webkit' })))).toContain('env.engine_mismatch');
    expect(codes(envProbes(fakeWin(), ctx({ engine: 'unknown' })))).not.toContain('env.engine_mismatch');
    expect(codes(envProbes(fakeWin(), ctx()))).not.toContain('env.engine_mismatch');
  });

  it('down-weights under privacy modes and skips desktop-only checks on mobile', () => {
    const soft = envProbes(fakeWin({ renderer: 'llvmpipe', nav: { hardwareConcurrency: 3 } }), ctx({ privacyMode: 'brave' }));
    expect(soft.find((s) => s.code === 'env.webgl_software')!.llr).toBeCloseTo(0.66);
    expect(soft.find((s) => s.code === 'env.odd_cpu_count')!.llr).toBeCloseTo(0.45);
    const mobile = codes(envProbes(fakeWin({ renderer: null, nav: { plugins: { length: 0 } }, win: { outerWidth: 400, innerWidth: 400, outerHeight: 800, innerHeight: 800, screen: { width: 800, height: 600, availHeight: 600 } } }), ctx({ mobile: true })));
    expect(mobile).not.toEqual(expect.arrayContaining(['env.no_webgl']));
    expect(mobile).not.toContain('env.no_plugins');
    expect(mobile).not.toContain('env.no_browser_chrome');
    expect(mobile).not.toContain('env.agent_vm_resolution');
  });

  it('tolerates throwing window getters', () => {
    const w = fakeWin({ nav: { hardwareConcurrency: 0 } });
    Object.defineProperty(w, 'outerWidth', { get() { throw new Error('x'); } });
    Object.defineProperty(w, 'screen', { get() { throw new Error('x'); } });
    Object.defineProperty(w.navigator, 'plugins', { get() { throw new Error('x'); } });
    Object.defineProperty(w.navigator, 'languages', { get() { throw new Error('x'); } });
    Object.defineProperty(w.navigator, 'connection', { get() { throw new Error('x'); } });
    Object.defineProperty(w, 'process', { get() { throw new Error('x'); } });
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('x'); });
    expect(() => envProbes(w, ctx())).not.toThrow();
  });
});

/** Worker double: answers with the given navigator (or never / errors). */
function workerClass(mode: { reply?: Any; error?: boolean; throws?: boolean; silent?: boolean }) {
  return class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminate = vi.fn();
    constructor() {
      if (mode.throws) throw new Error('CSP');
      queueMicrotask(() => {
        if (mode.error) this.onerror?.();
        else if (!mode.silent) this.onmessage?.({ data: mode.reply });
      });
    }
  };
}

describe('asyncEnvProbes', () => {
  const base = (o: Any = {}) => fakeWin({ nav: { userAgent: CHROME_WIN, ...o.nav }, win: { Worker: workerClass({ reply: { ua: CHROME_WIN, hc: 8, lang: 'en-US' } }), ...o.win } });

  it('is clean when client hints, permissions and the worker agree', async () => {
    const w = base({
      nav: {
        userAgentData: { getHighEntropyValues: async () => ({ platform: 'Windows', fullVersionList: [{ brand: 'Google Chrome', version: '140.0.1' }] }) },
        permissions: { query: async () => ({ state: 'granted' }) },
      },
      win: { Notification: { permission: 'granted' } },
    });
    expect(await asyncEnvProbes(w, ctx())).toEqual([]);
  });

  it('flags client-hint platform and version mismatches', async () => {
    const w = base({ nav: { userAgentData: { getHighEntropyValues: async () => ({ platform: 'Linux', fullVersionList: [{ brand: 'Chromium', version: '120.0' }] }) } } });
    expect(codes(await asyncEnvProbes(w, ctx()))).toEqual(['env.client_hints_platform_mismatch', 'env.client_hints_version_mismatch']);
    for (const ua of [CHROME_MAC, 'Mozilla/5.0 (Linux; Android 14) Chrome/140', 'Mozilla/5.0 (X11; CrOS x86_64) Chrome/140', LINUX_CHROME, 'Other/1.0']) {
      const x = base({ nav: { userAgent: ua, userAgentData: { getHighEntropyValues: async () => ({ platform: 'Windows' }) } }, win: { Worker: workerClass({ reply: { ua, hc: 8, lang: 'en-US' } }) } });
      const got = codes(await asyncEnvProbes(x, ctx()));
      expect(got.includes('env.client_hints_platform_mismatch')).toBe(ua !== 'Other/1.0');
    }
    const rejects = base({ nav: { userAgentData: { getHighEntropyValues: async () => { throw new Error('x'); } } } });
    expect(await asyncEnvProbes(rejects, ctx())).toEqual([]);
    const empty = base({ nav: { userAgentData: { getHighEntropyValues: async () => ({}) } } });
    expect(await asyncEnvProbes(empty, ctx())).toEqual([]);
  });

  it('flags denied notifications with a prompt permission state', async () => {
    const w = base({ nav: { permissions: { query: async () => ({ state: 'prompt' }) } }, win: { Notification: { permission: 'denied' } } });
    expect(codes(await asyncEnvProbes(w, ctx()))).toEqual(['env.permissions_inconsistent']);
    const throws = base({ nav: { permissions: { query: async () => { throw new Error('x'); } } }, win: { Notification: { permission: 'denied' } } });
    expect(await asyncEnvProbes(throws, ctx())).toEqual([]);
  });

  it('treats worker vs main-thread mismatches as soft environmental evidence', async () => {
    const w = base({ win: { Worker: workerClass({ reply: { ua: 'HeadlessChrome', hc: 2, lang: 'de' } }) } });
    const [s] = await asyncEnvProbes(w, ctx());
    expect(s).toEqual(expect.objectContaining({ code: 'env.worker_mismatch', group: 'E', llr: 2, hard: false, detail: 'ua,cpu,lang' }));
    const brave = base({ win: { Worker: workerClass({ reply: { ua: CHROME_WIN, hc: 2, lang: 'en-US' } }) } });
    expect(await asyncEnvProbes(brave, ctx({ privacyMode: 'brave' }))).toEqual([]);
    const cpu = await asyncEnvProbes(brave, ctx());
    expect(cpu[0]).toEqual(expect.objectContaining({ hard: false, detail: 'cpu' }));
  });

  it('gives up on a worker that errors, throws (CSP) or never answers', async () => {
    expect(await asyncEnvProbes(base({ win: { Worker: workerClass({ error: true }) } }), ctx())).toEqual([]);
    expect(await asyncEnvProbes(base({ win: { Worker: workerClass({ throws: true }) } }), ctx())).toEqual([]);
    vi.useFakeTimers();
    try {
      const p = asyncEnvProbes(base({ win: { Worker: workerClass({ silent: true }) } }), ctx());
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
