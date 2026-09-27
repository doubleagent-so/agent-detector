// Behaviour benchmark: scores labelled synthetic sessions and prints a confusion matrix per scenario.
// Run it before and after a change to weights, features or fusion, and paste both tables into the PR.
//   node bench/run.ts [--seeds 50] [--json]
import { DEFAULT_SIGNATURES, extractBehavior, fuse, type Signal, type VerdictClass } from '../src/index.ts';
import type { TraceEvent } from '../src/behavior/trace.ts';
import { aiAgent, humanDesktop, humanMobile, scriptedBot } from '../test/traces.ts';

const args = process.argv.slice(2);
const seeds = Number(args[args.indexOf('--seeds') + 1]) || 50;
const json = args.includes('--json');

/** A headless environment tell, as the env probes would report it for a scripted bot. */
const softwareGl: Signal[] = [{ code: 'env.webgl_software', group: 'E', target: 'both', llr: 2.2 }];

interface Scenario { name: string; expect: VerdictClass; trace: (seed: number) => TraceEvent[]; env?: Signal[] }
const SCENARIOS: Scenario[] = [
  { name: 'human desktop', expect: 'human', trace: (s) => humanDesktop(s) },
  { name: 'human mobile', expect: 'human', trace: (s) => humanMobile(s) },
  { name: 'ai agent', expect: 'agent', trace: (s) => aiAgent(s) },
  { name: 'scripted bot', expect: 'bot', trace: (s) => scriptedBot(s), env: softwareGl },
];

const score = (ev: TraceEvent[], env: Signal[] = []) => {
  const b = extractBehavior(ev, ev.length ? ev[ev.length - 1].t + 500 : 0);
  return fuse({
    signals: [...b.signals, ...env], profile: 'generic', action: 'pageview', sig: DEFAULT_SIGNATURES,
    behaviorReliability: b.stats.reliability, driveReliability: b.stats.driveReliability, sessionId: 'bench',
  });
};

const rows = SCENARIOS.map((sc) => {
  const counts: Record<VerdictClass, number> = { human: 0, bot: 0, agent: 0 };
  for (let seed = 1; seed <= seeds; seed++) counts[score(sc.trace(seed), sc.env).class]++;
  return { scenario: sc.name, expect: sc.expect, ...counts, accuracy: counts[sc.expect] / seeds };
});
const humans = rows.filter((r) => r.expect === 'human');
const falsePositiveRate = humans.reduce((n, r) => n + r.bot + r.agent, 0) / (humans.length * seeds);

if (json) {
  console.log(JSON.stringify({ signatures: DEFAULT_SIGNATURES.version, seeds, rows, falsePositiveRate }, null, 2));
} else {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`signatures ${DEFAULT_SIGNATURES.version}, ${seeds} seeds per scenario\n`);
  console.log('| scenario | expected | human | bot | agent | accuracy |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.scenario} | ${r.expect} | ${r.human} | ${r.bot} | ${r.agent} | ${pct(r.accuracy)} |`);
  console.log(`\nhuman false-positive rate: ${pct(falsePositiveRate)}`);
}
