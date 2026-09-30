import type { Action, Profile, Signal, Signatures, Verdict } from './types.ts';
import { DEFAULT_SIGNATURES } from './signatures.ts';
import { asyncEnvProbes, envContext, envProbes, hardProbes, scanGlobals } from './env/probes.ts';
import { clientHints, deviceFacts, type DeviceFacts } from './env/device.ts';
import { watchMarkers } from './env/markers.ts';
import { startCollector } from './behavior/collector.ts';
import { extractBehavior } from './behavior/features.ts';
import { detectPage, type PageContext } from './profile.ts';
import { fuse } from './fusion.ts';
import { timeline } from './timeline.ts';

export interface EngineOptions {
  signatures?: Signatures;
  profile?: Profile;
  sessionId?: string;
  /** Re-score interval (ms). */
  interval?: number;
  sitePrior?: { bot: number; agent: number };
  attackMode?: boolean;
  /** Force PCI-lite (auto-enabled when a payment context is detected). */
  pciLite?: boolean;
  onVerdict?: (v: Verdict) => void;
}

/** What the single per-session beacon carries (~1–2 KB). */
export interface BeaconPayload {
  v: 1;
  sid: string;
  sigv: string;
  page: { profile: Profile; action: Action; payment: boolean; host: string; path: string; ref?: string };
  verdict: Pick<Verdict, 'class' | 'probability' | 'confidence' | 'scores' | 'agent' | 'recommendation'>;
  /** c=code g=group l=llr d=detail t=target f=family h=hard (server never trusts client `verified.*` codes). */
  signals: { c: string; g: string; l: number; d?: string; t?: string; f?: string; h?: 1 }[];
  /** navigator.userAgent, compared server-side with the request header UA. */
  ua?: string;
  features: Record<string, number>;
  stats: { events: number; durationMs: number; pointer: string; reliability: number; driveReliability?: number };
  timeline: string[];
  env: { tz: string; lang: string; screen: string; dpr: number; hc?: number; mobile: boolean };
  /** Integration identifiers the server may need for late relabel (e.g. GA client_id). */
  ids?: Record<string, string>;
  /** Aggregate weight. Always 1: every session is tracked, humans included (no sampling). */
  w: number;
  /** What the browser says about the device (env/device.ts); kept in the 30-day raw tier. */
  device?: DeviceFacts;
  /** The visitor's pages this page load (built by the browser SDK's journey tracker). */
  pages?: { i: string; p: string; q?: Record<string, string>; r?: string; a: number; d: number; v: number; s: number }[];
}

export interface Engine {
  readonly sessionId: string;
  readonly page: PageContext;
  verdict(): Verdict;
  /** Recompute now, optionally for a specific action. */
  score(action?: Action): Verdict;
  /** Add server/edge/judge evidence (groups H/J). */
  addSignals(s: Signal[]): Verdict;
  payload(ids?: Record<string, string>): BeaconPayload;
  ready: Promise<Verdict>;
  stop(): void;
}

const rid = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
};

export function createEngine(w: Window & typeof globalThis, opts: EngineOptions = {}): Engine {
  const sig = opts.signatures ?? DEFAULT_SIGNATURES;
  const sessionId = opts.sessionId ?? rid();
  const page = detectPage(w, opts.profile);
  const pciLite = opts.pciLite ?? page.payment;
  const ctx = envContext(w);
  const t0 = performance.now();

  const staticSignals: Signal[] = [...hardProbes(w, sig), ...envProbes(w, ctx)];
  const dynamic = new Map<string, Signal>();
  const external = new Map<string, Signal>();
  const addDyn = (list: Signal[]) => list.forEach((signal) => dynamic.set(signal.code, signal));

  const { ring, stop: stopCollector } = startCollector(w, { pciLite });

  let current: Verdict;
  let lastBehavior = extractBehavior([], 0);

  const compute = (action: Action = page.action): Verdict => {
    const now = performance.now() - t0;
    lastBehavior = extractBehavior(ring.events, now, ring.completeSince);
    const signals = [...staticSignals, ...dynamic.values(), ...lastBehavior.signals, ...external.values()];
    return fuse({
      signals, profile: page.profile, action, sig, sessionId,
      behaviorReliability: lastBehavior.stats.reliability,
      driveReliability: lastBehavior.stats.driveReliability,
      sitePrior: opts.sitePrior, attackMode: opts.attackMode,
      stage: external.size && [...external.values()].some((signal) => signal.group === 'J') ? 'final' : 'provisional',
      judge: [...external.values()].find((signal) => signal.group === 'J')?.detail,
    });
  };
  let lastKey = '';
  const emit = () => {
    current = compute();
    const key = `${current.class}|${current.recommendation}|${Math.round(current.probability[current.class] * 20)}|${current.agent?.id ?? current.agent?.family}|${current.agent?.verified}|${current.stage}|${current.behavior?.label}`;
    if (key !== lastKey) { lastKey = key; opts.onVerdict?.(current); }
    return current;
  };
  current = compute();
  // watchMarkers scans synchronously: pre-existing markers must see initialized scoring state.
  const stopMarkers = watchMarkers(w.document, sig, (hits) => { addDyn(hits); emit(); });

  const device: DeviceFacts = deviceFacts(w);
  // Best-effort: a probe failure must never keep `ready` from resolving.
  const probeEnvironment = async (): Promise<Signal[]> => {
    try {
      return await asyncEnvProbes(w, ctx);
    } catch {
      return [];
    }
  };
  const ready = (async () => {
    addDyn(await probeEnvironment());
    const ch = await clientHints(w);
    if (ch) device.ch = ch;
    return emit();
  })();

  // Late-injected globals (agents attach after load): rescan a few times, then stop.
  let rescans = 0;
  const globalTimer = setInterval(() => {
    addDyn(scanGlobals(w, sig));
    if (++rescans >= 10) clearInterval(globalTimer);
  }, 3000);
  const scoreTimer = setInterval(emit, opts.interval ?? 2000);

  return {
    sessionId,
    page,
    ready,
    verdict: () => current,
    score: (action?: Action) => (action ? compute(action) : emit()),
    addSignals: (signals: Signal[]) => { signals.forEach((x) => external.set(x.code, x)); return emit(); },
    payload: (ids?: Record<string, string>): BeaconPayload => {
      const verdict = emit();
      const scr = w.screen;
      return {
        v: 1, sid: sessionId, sigv: sig.version,
        page: { profile: page.profile, action: page.action, payment: page.payment, host: w.location.host, path: w.location.pathname.slice(0, 120), ref: w.document.referrer ? new URL(w.document.referrer).host : undefined },
        verdict: { class: verdict.class, probability: verdict.probability, confidence: verdict.confidence, scores: verdict.scores, agent: verdict.agent, recommendation: verdict.recommendation },
        signals: [...staticSignals, ...dynamic.values(), ...lastBehavior.signals].map((signal) => ({ c: signal.code, g: signal.group, l: Math.round(signal.llr * 100) / 100, d: signal.detail?.slice(0, 80), t: signal.target, f: signal.family, h: signal.hard ? (1 as const) : undefined })),
        ua: w.navigator.userAgent.slice(0, 300),
        features: lastBehavior.vector,
        stats: { events: lastBehavior.stats.events, durationMs: Math.round(lastBehavior.stats.durationMs), pointer: lastBehavior.stats.pointer, reliability: Math.round(lastBehavior.stats.reliability * 100) / 100, driveReliability: Math.round(lastBehavior.stats.driveReliability * 100) / 100 },
        timeline: pciLite ? [] : timeline(ring.events.filter(event => !event.u && event.t >= ring.completeSince), 40),
        env: { tz: safeTz(), lang: w.navigator.language, screen: `${scr.width}x${scr.height}`, dpr: w.devicePixelRatio, hc: w.navigator.hardwareConcurrency, mobile: ctx.mobile },
        device,
        ids,
        w: 1,
      };
    },
    stop: () => { stopCollector(); stopMarkers(); clearInterval(globalTimer); clearInterval(scoreTimer); },
  };
}

const safeTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };
