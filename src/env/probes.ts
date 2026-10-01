import { normalizeSoftSignal } from '../evidence.ts';
import type { Signal, Signatures } from '../types.ts';

/**
 * Environment probes (groups A and E). Each probe is defensive: any exception = no signal.
 * Brave / Tor / Firefox-RFP deliberately randomise or flatten fingerprints, so probes that
 * those browsers trip are down-weighted via `privacyMode`.
 */

type W = Window & typeof globalThis;

const safe = <T>(fn: () => T, fallback: T): T => {
  try { return fn(); } catch { return fallback; }
};

const isNative = (fn: unknown): boolean =>
  typeof fn === 'function' && /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn));

export interface EnvContext {
  privacyMode: 'none' | 'brave' | 'rfp';
  mobile: boolean;
  engine: 'blink' | 'gecko' | 'webkit' | 'unknown';
}

function engineOf(ua: string): EnvContext['engine'] {
  if (/Firefox\//.test(ua)) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'blink';
  return /AppleWebKit/.test(ua) ? 'webkit' : 'unknown';
}

/** eval.toString().length for the engine; `actual` when the engine is unknown. */
function evalLength(engine: EnvContext['engine'], actual: number): number {
  if (engine === 'blink') return 33;
  return engine === 'unknown' ? actual : 37;
}

function platformOf(ua: string): string {
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'Chrome OS';
  return /Linux/.test(ua) ? 'Linux' : '';
}

export function envContext(w: W): EnvContext {
  const nav = w.navigator as Navigator & { brave?: unknown; userAgentData?: { mobile?: boolean } };
  const ua = nav.userAgent || '';
  const engine = engineOf(ua);
  // Firefox resistFingerprinting clamps timers to ≥ 16.67ms/100ms and forces UTC.
  const rfp = engine === 'gecko' && safe(() => new Date().getTimezoneOffset() === 0 && w.screen.width % 200 === 0 && w.innerWidth % 200 === 0, false);
  const firefoxMode = rfp ? 'rfp' : 'none';
  const privacyMode = nav.brave ? 'brave' : firefoxMode;
  const mobile = nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(ua);
  return { privacyMode, mobile, engine };
}

/** Tier A: deterministic automation artifacts. */
export function hardProbes(w: W, sig: Signatures): Signal[] {
  const out: Signal[] = [];
  const nav = w.navigator;

  if (safe(() => nav.webdriver === true, false)) {
    out.push({ code: 'auto.webdriver', group: 'A', target: 'bot', llr: 9, hard: true, detail: 'navigator.webdriver=true' });
  }
  // Stealth plugins redefine webdriver; the getter then stops being native or moves onto the instance.
  safe(() => {
    const own = Object.getOwnPropertyDescriptor(nav, 'webdriver');
    const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nav), 'webdriver');
    if (own || (proto?.get && !isNative(proto.get))) {
      out.push({ code: 'auto.webdriver_patched', group: 'E', target: 'bot', llr: 1.5, detail: 'webdriver accessor modified' });
    }
  }, undefined);

  const ua = nav.userAgent || '';
  if (/HeadlessChrome/.test(ua)) out.push({ code: 'auto.headless_ua', group: 'A', target: 'bot', llr: 9, hard: true, detail: 'HeadlessChrome UA' });
  safe(() => {
    const brands = (nav as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
    if (brands?.some((brand) => /Headless/i.test(brand.brand))) {
      out.push({ code: 'auto.headless_brand', group: 'A', target: 'bot', llr: 9, hard: true });
    }
  }, undefined);

  out.push(...scanGlobals(w, sig));
  return out.map(normalizeSoftSignal);
}

/** Scan window/document own keys against signature regexes. Cheap: ~1k keys. */
export function scanGlobals(w: W, sig: Signatures): Signal[] {
  const out: Signal[] = [];
  const keys = safe(() => [...Object.getOwnPropertyNames(w), ...Object.getOwnPropertyNames(w.document)], [] as string[]);
  const seen = new Set<string>();
  for (const rule of sig.globals) {
    const re = new RegExp(rule.pattern);
    const hit = keys.find((k) => re.test(k));
    if (hit && !seen.has(rule.code)) {
      seen.add(rule.code);
      out.push({ code: rule.code, group: 'A', target: rule.target, llr: 9, hard: true, family: rule.family, ...(rule.agentId ? { agentId: rule.agentId } : {}), detail: hit });
    }
  }
  return out.map(normalizeSoftSignal);
}

/** Tier B/C environment consistency (group E). */
export function envProbes(w: W, ctx: EnvContext): Signal[] {
  const out: Signal[] = [];
  const nav = w.navigator as Navigator & { deviceMemory?: number; connection?: { rtt?: number } };
  const ua = nav.userAgent || '';
  const soft = ctx.privacyMode !== 'none' ? 0.3 : 1; // privacy browsers lie on purpose

  // WebGL renderer: software rasterisers are typical of headless/cloud VMs.
  const webgl = (): void => {
    const gl = webglInfo(w);
    if (!gl) {
      if (ctx.engine === 'blink' && !ctx.mobile) out.push({ code: 'env.no_webgl', group: 'E', target: 'both', llr: 1 * soft });
      return;
    }
    if (/SwiftShader|llvmpipe|softpipe|Mesa OffScreen|Microsoft Basic Render/i.test(gl.renderer)) {
      out.push({ code: 'env.webgl_software', group: 'E', target: 'both', llr: 2.2 * soft, detail: gl.renderer });
    }
    const mac = /Mac OS X|Macintosh/.test(ua), win = /Windows/.test(ua);
    if ((win && /Apple (M\d|GPU)/.test(gl.renderer)) || (mac && /Direct3D|D3D11/.test(gl.renderer))) {
      out.push({ code: 'env.gpu_platform_mismatch', group: 'E', target: 'bot', llr: 3 * soft, detail: gl.renderer });
    }
  };
  webgl();

  // Browser chrome: headless/kiosk windows have outer == inner.
  safe(() => {
    if (!ctx.mobile && w.outerWidth > 0 && w.outerWidth === w.innerWidth && w.outerHeight === w.innerHeight) {
      out.push({ code: 'env.no_browser_chrome', group: 'E', target: 'both', llr: 1.2, detail: `${w.innerWidth}x${w.innerHeight}` });
    }
    if (w.outerWidth === 0 && w.outerHeight === 0) {
      out.push({ code: 'env.zero_outer', group: 'E', target: 'bot', llr: 3 });
    }
  }, undefined);

  // Known agent VM resolutions (FP-Agent, arXiv 2605.01247). Weak alone: many humans share them.
  safe(() => {
    const resolution = `${w.screen.width}x${w.screen.height}`;
    if (['1280x960', '1280x1100', '1024x768', '800x600'].includes(resolution) && !ctx.mobile) {
      out.push({ code: 'env.agent_vm_resolution', group: 'E', target: 'agent', llr: 0.8, detail: resolution });
    }
    if (!ctx.mobile && w.screen.availHeight === w.screen.height && /Windows|Mac OS X/.test(ua)) {
      out.push({ code: 'env.no_taskbar', group: 'E', target: 'both', llr: 0.4 * soft });
    }
  }, undefined);

  // Hardware oddities.
  const hardware = (): void => {
    const hc = nav.hardwareConcurrency;
    if (hc && ![1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 64, 96, 128].includes(hc)) {
      out.push({ code: 'env.odd_cpu_count', group: 'E', target: 'both', llr: 1.5 * soft, detail: String(hc) });
    }
    if (!ctx.mobile && /Linux x86_64/.test(ua) && nav.maxTouchPoints >= 5) {
      out.push({ code: 'env.touch_on_linux_desktop', group: 'E', target: 'both', llr: 1.5 });
    }
  };
  hardware();

  // An empty plugin list is normal when inline PDF viewing is disabled (HTML spec).
  safe(() => {
    if (ctx.engine === 'blink' && !ctx.mobile && nav.pdfViewerEnabled === true && nav.plugins.length === 0) {
      out.push({ code: 'env.no_plugins', group: 'E', target: 'both', llr: 2 });
    }
    if (ctx.engine === 'blink' && !ctx.mobile && nav.pdfViewerEnabled === false && nav.plugins.length > 0) {
      out.push({ code: 'env.plugins_inconsistent', group: 'E', target: 'bot', llr: 1.5 });
    }
  }, undefined);

  // Languages.
  safe(() => {
    if (!nav.languages || nav.languages.length === 0) out.push({ code: 'env.no_languages', group: 'E', target: 'bot', llr: 2.5 });
    else if (nav.language && !nav.languages.includes(nav.language)) out.push({ code: 'env.language_mismatch', group: 'E', target: 'bot', llr: 1.5 });
  }, undefined);

  // Timezone consistency: Intl zone vs offset.
  safe(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const off = new Date().getTimezoneOffset();
    if ((tz === 'UTC' || tz === 'Etc/UTC') && off !== 0) out.push({ code: 'env.tz_mismatch', group: 'E', target: 'bot', llr: 2.5 });
    if ((tz === 'UTC' || tz === 'Etc/UTC') && ctx.privacyMode === 'none' && !/Linux/.test(ua)) {
      out.push({ code: 'env.utc_consumer', group: 'E', target: 'both', llr: 0.8, detail: tz });
    }
  }, undefined);

  // eval.toString length must match the engine (BotD).
  safe(() => {
    // eslint-disable-next-line no-eval -- reads eval's source length as an engine fingerprint; never calls it
    const n = eval.toString().length;
    const expected = evalLength(ctx.engine, n);
    if (ctx.engine !== 'unknown' && n !== expected && !(ctx.engine === 'webkit' && n === 39)) {
      out.push({ code: 'env.engine_mismatch', group: 'E', target: 'bot', llr: 3, detail: `eval.len=${n}` });
    }
  }, undefined);

  if (safe(() => nav.connection?.rtt === 0 && ctx.engine === 'blink' && !ctx.mobile, false)) {
    out.push({ code: 'env.rtt_zero', group: 'E', target: 'bot', llr: 0.7 });
  }
  // Read inside safe(): a page can define a throwing `process` getter.
  const globals = w as W & { process?: { versions?: { node?: string } } };
  if (safe(() => typeof globals.process === 'object' && globals.process?.versions?.node, false)) {
    out.push({ code: 'auto.node_process', group: 'E', target: 'bot', llr: 1 });
  }
  return out.map(normalizeSoftSignal);
}

const glCache = new WeakMap<object, { vendor: string; renderer: string } | null>();

/** Unmasked WebGL vendor and renderer, read once per window (each read creates a GL context). */
export function webglInfo(w: W): { vendor: string; renderer: string } | null {
  if (glCache.has(w)) return glCache.get(w)!;
  const info = readWebgl(w);
  glCache.set(w, info);
  return info;
}

function readWebgl(w: W): { vendor: string; renderer: string } | null {
  return safe(() => {
    const canvas = w.document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { vendor, renderer };
  }, null);
}

/** Async probes: client hints vs UA, permissions, worker-vs-main consistency. */
// eslint-disable-next-line complexity -- kept whole for the browser bundle budget (17 KB gzip, scripts/size.mjs)
export async function asyncEnvProbes(w: W, ctx: EnvContext): Promise<Signal[]> {
  const out: Signal[] = [];
  const nav = w.navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ platform?: string; fullVersionList?: { brand: string; version: string }[] }> } };
  const ua: string = nav.userAgent || '';

  // Client hints must agree with the UA string.
  if (nav.userAgentData?.getHighEntropyValues) {
    try {
      const h = await nav.userAgentData.getHighEntropyValues(['platform', 'fullVersionList']);
      const plat: string = h.platform || '';
      const uaPlat = platformOf(ua);
      if (plat && uaPlat && plat !== uaPlat) {
        out.push({ code: 'env.client_hints_platform_mismatch', group: 'E', target: 'bot', llr: 3.5, detail: `${plat}≠${uaPlat}` });
      }
      const chrome = (h.fullVersionList as { brand: string; version: string }[] | undefined)?.find((brand) => /Chromium|Google Chrome/.test(brand.brand));
      const match = ua.match(/Chrome\/(\d+)/);
      if (chrome && match && chrome.version.split('.')[0] !== match[1]) {
        out.push({ code: 'env.client_hints_version_mismatch', group: 'E', target: 'bot', llr: 3, detail: `${chrome.version}≠${match[1]}` });
      }
    } catch { /* ignore */ }
  }

  // Classic headless permission inconsistency.
  try {
    if (w.Notification && nav.permissions?.query) {
      const st = await nav.permissions.query({ name: 'notifications' as PermissionName });
      if (w.Notification.permission === 'denied' && st.state === 'prompt') {
        out.push({ code: 'env.permissions_inconsistent', group: 'E', target: 'bot', llr: 3 });
      }
    }
  } catch { /* ignore */ }

  // Worker vs main thread: stealth patches usually only cover the main thread.
  const wk = await workerNavigator(w);
  if (wk) {
    const diffs: string[] = [];
    if (wk.ua !== ua) diffs.push('ua');
    if (wk.hc !== nav.hardwareConcurrency && ctx.privacyMode !== 'brave') diffs.push('cpu');
    if (wk.lang !== nav.language) diffs.push('lang');
    if (diffs.length) out.push({ code: 'env.worker_mismatch', group: 'E', target: 'bot', llr: 2, detail: diffs.join(',') });
  }
  return out.map(normalizeSoftSignal);
}

function workerNavigator(w: W): Promise<{ ua: string; hc: number; lang: string } | null> {
  return new Promise((resolve) => {
    try {
      const src = 'postMessage({ua:navigator.userAgent,hc:navigator.hardwareConcurrency,lang:navigator.language})';
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      const wk = new w.Worker(url);
      const t = setTimeout(() => { wk.terminate(); resolve(null); }, 1000);
      wk.onmessage = (event) => { clearTimeout(t); wk.terminate(); URL.revokeObjectURL(url); resolve(event.data); };
      wk.onerror = () => { clearTimeout(t); resolve(null); };
    } catch { resolve(null); } // CSP may forbid blob workers
  });
}
