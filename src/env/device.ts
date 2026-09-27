import { webglInfo } from './probes.ts';

type W = Window & typeof globalThis;

/**
 * Device facts for the raw tier (30 days): what the browser says about itself. Short keys keep the
 * beacon small. `ch` holds high-entropy client hints (Chromium only), filled in asynchronously.
 */
export interface DeviceFacts {
  langs?: string[];
  cd?: number;
  mem?: number;
  touch?: number;
  net?: string;
  save?: boolean;
  avail?: string;
  plat?: string;
  glv?: string;
  gl?: string;
  ch?: Record<string, string>;
}

const s = (v: unknown, n = 120): string | undefined => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function deviceFacts(w: W): DeviceFacts {
  try {
    const nav = w.navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } };
    const gl = webglInfo(w);
    const out: DeviceFacts = {
      langs: [...(nav.languages ?? [])].slice(0, 5).map((l) => l.slice(0, 35)),
      cd: num(w.screen?.colorDepth),
      mem: num(nav.deviceMemory),
      touch: num(nav.maxTouchPoints),
      net: s(nav.connection?.effectiveType, 16),
      save: nav.connection?.saveData,
      avail: w.screen ? `${w.screen.availWidth}x${w.screen.availHeight}` : undefined,
      plat: s(nav.platform, 32),
      glv: s(gl?.vendor),
      gl: s(gl?.renderer),
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as DeviceFacts;
  } catch { return {}; }
}

/** High-entropy client hints, when the browser offers them. */
export async function clientHints(w: W): Promise<Record<string, string> | undefined> {
  const uad = (w.navigator as Navigator & { userAgentData?: { getHighEntropyValues?(h: string[]): Promise<Record<string, unknown>> } }).userAgentData;
  if (!uad?.getHighEntropyValues) return undefined;
  try {
    const h = await uad.getHighEntropyValues(['platform', 'platformVersion', 'model', 'architecture', 'bitness', 'fullVersionList']);
    const brands = (h.fullVersionList as { brand: string; version: string }[] | undefined)?.map((b) => `${b.brand} ${b.version}`).join(', ');
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries({ platform: h.platform, platformVersion: h.platformVersion, model: h.model, architecture: h.architecture, bitness: h.bitness, brands })) {
      const t = s(v, 200);
      if (t) out[k] = t;
    }
    return out;
  } catch { return undefined; }
}
