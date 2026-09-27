import { hasAutomationEvidence, normalizeSoftSignal } from './evidence.ts';
import { neutralBehavior } from './conduct.ts';
import type { Action, AgentFamily, Group, Profile, Reason, Signal, Signatures, VerdictClass, Verdict, Recommendation } from './types.ts';

/**
 * Heuristic log-odds fusion (weights require validation on labeled traffic).
 *
 *   L_c = log(prior_c / prior_human) + Σ_g  rel_g · clamp( Σ_{i∈g} llr_i,c , ±cap_g )     for c ∈ {bot, agent}
 *   P = softmax(0, L_bot, L_agent)
 *
 * - Signals targeting 'both' contribute to both hypotheses.
 * - Groups are capped so correlated evidence (e.g. five WebGL tells) can't double count.
 * - Behavioural groups (D/R/C) are scaled by reliability (how much interaction we observed),
 *   so a 2-second visit with no events is neither human nor bot evidence.
 * - Hard evidence (Tier A) short-circuits to ≥ 0.99.
 * - Environment vs driving sub-scores disambiguate bot vs agent: agents usually run in a clean
 *   real browser with non-human driving; scripted bots have a fake environment.
 */

export interface FuseInput {
  signals: Signal[];
  profile: Profile;
  action: Action;
  sig: Signatures;
  behaviorReliability: number;
  /** Reliability of group D (defaults to max(0.35, behaviorReliability)). */
  driveReliability?: number;
  /** Site-specific learned prior override (Beta-Binomial posterior from the server). */
  sitePrior?: { bot: number; agent: number };
  attackMode?: boolean;
  sessionId: string;
  stage?: 'provisional' | 'final';
  judge?: string;
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

export function fuse(inp: FuseInput): Verdict {
  const { sig } = inp;
  const shadow = new Set(inp.sig.shadow ?? []);
  const signals = inp.signals.map(normalizeSoftSignal).map((s) => (shadow.has(s.code) ? { ...s, llr: 0, hard: false } : s));
  const prior = inp.sitePrior ?? sig.priors[inp.profile] ?? sig.priors.generic;
  const boost = (sig.actionPriorBoost[inp.action] ?? 1) * (inp.attackMode ? 3 : 1);
  const pH = Math.max(0.01, 1 - prior.bot - prior.agent);
  const base = { bot: Math.log((prior.bot * boost) / pH), agent: Math.log((prior.agent * boost) / pH) };

  const rel: Record<Group, number> = {
    A: 1, E: 1, H: 1, J: 1,
    D: inp.driveReliability ?? Math.max(0.35, inp.behaviorReliability),
    R: inp.behaviorReliability,
    C: inp.behaviorReliability,
  };

  // Per-group sums per hypothesis.
  const sums: Record<'bot' | 'agent', Partial<Record<Group, number>>> = { bot: {}, agent: {} };
  for (const s of signals) {
    for (const c of ['bot', 'agent'] as const) {
      if (s.target === c || s.target === 'both') sums[c][s.group] = (sums[c][s.group] ?? 0) + s.llr;
    }
  }
  const clamp = (x: number, cap: number) => Math.max(-cap, Math.min(cap, x));
  const groupContribution = (c: 'bot' | 'agent', g: Group) => rel[g] * clamp(sums[c][g] ?? 0, sig.groupCaps[g]);

  const L = { bot: base.bot, agent: base.agent };
  for (const c of ['bot', 'agent'] as const) {
    for (const g of Object.keys(sums[c]) as Group[]) L[c] += groupContribution(c, g);
  }

  // Environment vs driving disambiguation.
  const envScore = sigm((sums.bot.E ?? 0) + (sums.bot.A ?? 0) - 1);
  const drivingScore = sigm(rel.D * ((sums.agent.D ?? 0) + (sums.agent.R ?? 0) + (sums.agent.C ?? 0)) - 1);
  if (drivingScore > 0.7 && envScore < 0.4) L.agent += 1.2; // real browser, non-human hands → agent
  if (envScore > 0.8 && drivingScore < 0.5) L.bot += 0.8; // fake browser → scripted bot

  let probability = softmax({ human: 0, bot: L.bot, agent: L.agent });

  // Hard evidence short-circuit.
  const verified = signals.find((s) => s.group === 'H' && s.code.startsWith('verified.') && !shadow.has(s.code));
  const hard = verified ? [verified] : signals.filter((s) => s.hard);
  const attributed = signals.find((s) => (s.family || s.agentId) && s.llr > 0);
  let family: AgentFamily | undefined = attributed?.family;
  if (hard.length) {
    const agentHard = hard.some((s) => s.target === 'agent');
    const cls: VerdictClass = agentHard ? 'agent' : 'bot';
    // An automation framework with agent-like driving is most likely an agent framework (Browser Use, Stagehand on Playwright).
    const agentish = !verified && !agentHard && drivingScore > 0.85 && (sums.agent.R ?? 0) > 1;
    const winner: VerdictClass = agentish ? 'agent' : cls;
    probability = winner === 'agent'
      ? { human: 0.004, bot: 0.006, agent: 0.99 }
      : { human: 0.004, bot: 0.99, agent: 0.006 };
  }

  // Three-class API: when positive observations are not sufficiently specific, retain a
  // low-confidence human leaning, not a bot/agent accusation from priors or environment.
  // These are guarded heuristic probabilities, not measured population calibration.
  const corroborated = hard.length > 0 || hasAutomationEvidence(signals, rel);
  const insufficient = !corroborated && probability.human < 0.5;
  if (insufficient) {
    const remaining = probability.bot + probability.agent;
    probability = { human: 0.51, bot: 0.49 * probability.bot / remaining, agent: 0.49 * probability.agent / remaining };
  }

  const cls = (Object.keys(probability) as VerdictClass[]).reduce((a, b) => (probability[b] > probability[a] ? b : a));
  const nonHuman = 1 - probability.human;

  // Confidence: how far from the decision boundary and how much evidence exists.
  const evidenceMass = signals.reduce((s, x) => s + Math.abs(x.llr) * rel[x.group], 0);
  const confidence = hard.length ? 0.99 : r3(Math.min(insufficient ? 0.25 : 1, Math.min(1, evidenceMass / 8) * (0.5 + Math.abs(nonHuman - 0.5))));

  const reasons: Reason[] = signals
    .filter((s) => (cls === 'human' ? s.llr < 0 : s.llr > 0 && (s.target === cls || s.target === 'both')))
    .map((s) => ({ code: s.code, detail: s.detail, weight: r3(Math.abs(s.llr) * rel[s.group]) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  if (insufficient) reasons.unshift({ code: 'evidence.insufficient_automation', weight: 0, detail: 'Environment or ambiguous interaction signals lack corroboration; human-leaning, not verified human.' });

  return {
    behavior: neutralBehavior(),
    authorization: { decision: 'unknown' },
    sessionId: inp.sessionId,
    class: cls,
    probability: { human: r3(probability.human), bot: r3(probability.bot), agent: r3(probability.agent) },
    confidence,
    agent: cls === 'agent' || verified
      ? {
          family: (verified?.family ?? family ?? 'unknown') as AgentFamily,
          ...(((verified ? verified.agentId : attributed?.agentId)) ? { id: (verified ? verified.agentId : attributed?.agentId) } : {}),
          verified: !!verified,
          method: verified ? verified.code : hard.find((s) => s.family)?.code ?? 'behavioral',
        }
      : undefined,
    reasons,
    scores: { automation: r3(nonHuman), environment: r3(envScore), driving: r3(drivingScore) },
    recommendation: recommend(inp.sig, inp.profile, inp.action, cls, nonHuman, !!verified),
    profile: inp.profile,
    action: inp.action,
    stage: inp.stage ?? 'provisional',
    model: `doubleagent-${sig.version}`,
    judge: inp.judge,
    ts: Date.now(),
  };
}

export function recommend(sig: Signatures, profile: Profile, action: Action, cls: VerdictClass, pNonHuman: number, verified: boolean): Recommendation {
  if (cls === 'human') return 'allow';
  const pol = sig.policies[profile]?.[action] ?? sig.policies.generic[action] ?? { challengeAt: 0.8 };
  if (pol.tagOnly) return 'tag';
  // Identity verification does not establish user delegation or action authorization.
  void verified;
  if (pol.denyAt !== undefined && pNonHuman >= pol.denyAt) return pol.stepUp ? 'step_up' : 'deny';
  if (pol.challengeAt !== undefined && pNonHuman >= pol.challengeAt) return 'challenge';
  return 'tag';
}

function softmax(l: Record<VerdictClass, number>): Record<VerdictClass, number> {
  const m = Math.max(l.human, l.bot, l.agent);
  const e = { human: Math.exp(l.human - m), bot: Math.exp(l.bot - m), agent: Math.exp(l.agent - m) };
  const z = e.human + e.bot + e.agent;
  return { human: e.human / z, bot: e.bot / z, agent: e.agent / z };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
export { logit, sigm };
