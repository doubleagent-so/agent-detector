// Behaviour benchmark: scores labelled synthetic sessions and prints a confusion matrix per scenario.
// Run it before and after a change to weights, features or fusion, and paste both tables into the PR.
//   node bench/run.ts [--seeds 50] [--json] [--signals] [--unshadow]
import { DEFAULT_SIGNATURES, extractBehavior, fuse, type Signal, type VerdictClass } from '../src/index.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';
import { aiAgent, bezierBot, functionBot, humanDesktop, humanMobile, jsFillAgent, scriptedBot, visionAgent } from '../test/traces.ts';

const args = process.argv.slice(2);
const seeds = Number(args[args.indexOf('--seeds') + 1]) || 50;
const json = args.includes('--json');
const showSignals = args.includes('--signals');
const sig = args.includes('--unshadow') ? { ...DEFAULT_SIGNATURES, shadow: [] } : DEFAULT_SIGNATURES;
const WATCH = ['drive.synthetic_field_fill', 'drive.scroll_jump', 'drive.uniform_scroll_bursts', 'bio.smooth_synthetic_curve', 'bio.no_deceleration'];

/** A headless environment tell, as the env probes would report it for a scripted bot. */
const softwareGl: Signal[] = [{ code: 'env.webgl_software', group: 'E', target: 'both', llr: 2.2 }];

interface Scenario { name: string; expect: VerdictClass; trace: (seed: number) => TraceEvent[]; env?: Signal[] }
const SCENARIOS: Scenario[] = [
  { name: 'human desktop', expect: 'human', trace: (s) => humanDesktop(s) },
  { name: 'human mobile', expect: 'human', trace: (s) => humanMobile(s) },
  { name: 'ai agent', expect: 'agent', trace: (s) => aiAgent(s) },
  { name: 'vision agent', expect: 'agent', trace: (s) => visionAgent(s) },
  { name: 'js-fill agent', expect: 'agent', trace: (s) => jsFillAgent(s) },
  { name: 'scripted bot', expect: 'bot', trace: (s) => scriptedBot(s), env: softwareGl },
  { name: 'bezier bot', expect: 'bot', trace: (s) => bezierBot(s), env: softwareGl },
  { name: 'function bot (quad/const)', expect: 'bot', trace: (s) => functionBot(s, 'quadratic', 'constant'), env: softwareGl },
  { name: 'function bot (exp/gauss)', expect: 'bot', trace: (s) => functionBot(s, 'exponential', 'gauss'), env: softwareGl },
];

const score = (ev: TraceEvent[], env: Signal[] = []) => {
  const b = extractBehavior(ev, ev.length ? ev[ev.length - 1].t + 500 : 0);
  const verdict = fuse({
    signals: [...b.signals, ...env], profile: 'generic', action: 'pageview', sig,
    behaviorReliability: b.stats.reliability, driveReliability: b.stats.driveReliability, sessionId: 'bench',
  });
  return { verdict, codes: new Set(b.signals.map((s) => s.code)) };
};

const rows = SCENARIOS.map((sc) => {
  const counts: Record<VerdictClass, number> = { human: 0, bot: 0, agent: 0 };
  const fires: Record<string, number> = Object.fromEntries(WATCH.map((c) => [c, 0]));
  for (let seed = 1; seed <= seeds; seed++) {
    const { verdict, codes } = score(sc.trace(seed), sc.env);
    counts[verdict.class]++;
    for (const c of WATCH) if (codes.has(c)) fires[c]++;
  }
  return { scenario: sc.name, expect: sc.expect, ...counts, accuracy: counts[sc.expect] / seeds, fires };
});
const humans = rows.filter((r) => r.expect === 'human');
const falsePositiveRate = humans.reduce((n, r) => n + r.bot + r.agent, 0) / (humans.length * seeds);

if (json) {
  console.log(JSON.stringify({ signatures: DEFAULT_SIGNATURES.version, seeds, rows, falsePositiveRate, shadow: sig.shadow ?? [] }, null, 2));
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`signatures ${DEFAULT_SIGNATURES.version}, ${seeds} seeds per scenario\n`);
  console.log('| scenario | expected | human | bot | agent | accuracy |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.scenario} | ${r.expect} | ${r.human} | ${r.bot} | ${r.agent} | ${pct(r.accuracy)} |`);
  console.log(`\nhuman false-positive rate: ${pct(falsePositiveRate)}`);
  if (showSignals) {
    console.log(`\n| scenario | ${WATCH.join(' | ')} |`);
    console.log(`|---|${WATCH.map(() => '---').join('|')}|`);
    for (const r of rows) console.log(`| ${r.scenario} | ${WATCH.map((c) => pct(r.fires[c] / seeds)).join(' | ')} |`);
  }
}
