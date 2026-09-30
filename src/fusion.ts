import { resolveRoles, type RoleCatalog, type Roles } from './attribution.ts';
import { fingerprintRoles } from './catalog/rules.ts';
import { hasAutomationEvidence, normalizeSoftSignal } from './evidence.ts';
import { neutralBehavior } from './conduct.ts';
import type { Action, Group, Profile, Reason, Signal, Signatures, VerdictClass, Verdict, Recommendation } from './types.ts';

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
  /** Catalog for attribution. Defaults to the fingerprints the browser bundle carries; servers pass `catalogRoles`. */
  catalog?: RoleCatalog;
}

const logit = (probability: number) => Math.log(probability / (1 - probability));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));
const byCode = (left: string, right: string): number => Number(left > right) - Number(left < right);
/** Strongest evidence first; the code breaks ties, so a choice never depends on signal order. */
const strongestFirst = (left: Signal, right: Signal): number => right.llr - left.llr || byCode(left.code, right.code);

export function fuse(inp: FuseInput): Verdict {
  const { sig } = inp;
  const shadow = new Set(inp.sig.shadow ?? []);
  const signals = inp.signals.map(normalizeSoftSignal).map((signal) => (shadow.has(signal.code) ? { ...signal, llr: 0, hard: false } : signal));
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
  for (const signal of signals) {
    for (const kind of ['bot', 'agent'] as const) {
      if (signal.target === kind || signal.target === 'both') sums[kind][signal.group] = (sums[kind][signal.group] ?? 0) + signal.llr;
    }
  }
  const clamp = (x: number, cap: number) => Math.max(-cap, Math.min(cap, x));
  const groupContribution = (kind: 'bot' | 'agent', group: Group) => rel[group] * clamp(sums[kind][group] ?? 0, sig.groupCaps[group]);

  const logits = { bot: base.bot, agent: base.agent };
  for (const kind of ['bot', 'agent'] as const) {
    for (const group of Object.keys(sums[kind]) as Group[]) logits[kind] += groupContribution(kind, group);
  }

  // Environment vs driving disambiguation.
  const envScore = sigm((sums.bot.E ?? 0) + (sums.bot.A ?? 0) - 1);
  const drivingScore = sigm(rel.D * ((sums.agent.D ?? 0) + (sums.agent.R ?? 0) + (sums.agent.C ?? 0)) - 1);
  if (drivingScore > 0.7 && envScore < 0.4) logits.agent += 1.2; // real browser, non-human hands → agent
  if (envScore > 0.8 && drivingScore < 0.5) logits.bot += 0.8; // fake browser → scripted bot

  let probability = softmax({ human: 0, bot: logits.bot, agent: logits.agent });

  // Hard evidence short-circuit. A server-verified identity outranks everything; the strongest one wins.
  const verified = signals
    .filter((signal) => signal.group === 'H' && signal.code.startsWith('verified.') && !shadow.has(signal.code))
    .sort(strongestFirst)[0];
  const hard = verified ? [verified] : signals.filter((signal) => signal.hard);
  const catalog = inp.catalog ?? fingerprintRoles;
  const roles = resolveRoles(signals, { catalog });
  if (hard.length) {
    const agentHard = hard.some((signal) => signal.target === 'agent');
    // An agent marker wins; a verified identity is a bot; an automation tool alone depends on its driving.
    const winner: VerdictClass = agentHard ? 'agent' : hardWinner(!!verified, drivingScore, sums.agent);
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

  const cls = (Object.keys(probability) as VerdictClass[]).reduce((best, candidate) => (probability[candidate] > probability[best] ? candidate : best));
  const nonHuman = 1 - probability.human;

  // Confidence: how far from the decision boundary and how much evidence exists.
  const evidenceMass = signals.reduce((sum, x) => sum + Math.abs(x.llr) * rel[x.group], 0);
  const confidence = hard.length ? 0.99 : r3(Math.min(insufficient ? 0.25 : 1, Math.min(1, evidenceMass / 8) * (0.5 + Math.abs(nonHuman - 0.5))));

  const reasons: Reason[] = signals
    .filter((signal) => (cls === 'human' ? signal.llr < 0 : signal.llr > 0 && (signal.target === cls || signal.target === 'both')))
    .map((signal) => ({ code: signal.code, detail: signal.detail, weight: r3(Math.abs(signal.llr) * rel[signal.group]) }))
    .sort((left, right) => right.weight - left.weight || byCode(left.code, right.code))
    .slice(0, 8);

  if (insufficient) reasons.unshift({ code: 'evidence.insufficient_automation', weight: 0, detail: 'Environment or ambiguous interaction signals lack corroboration; human-leaning, not verified human.' });

  return {
    behavior: neutralBehavior(),
    authorization: { decision: 'unknown' },
    sessionId: inp.sessionId,
    class: cls,
    probability: { human: r3(probability.human), bot: r3(probability.bot), agent: r3(probability.agent) },
    confidence,
    agent: cls === 'agent' || verified ? agentOf(roles, catalog, signals, hard, verified) : undefined,
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

/**
 * Controller-only hard evidence: an automation tool proves the visit is not human, not who drives it
 * (Browser Use and Stagehand run on Playwright). Only strong driving *with* think-then-act rhythm
 * makes it an agent: scripted runs can look driven, but not deliberate. Otherwise it stays a bot,
 * at full certainty, since SDK blocking thresholds read `probability.bot`.
 */
/** Without an agent marker: a verified identity is a bot; an automation tool alone depends on its driving. */
function hardWinner(verified: boolean, drivingScore: number, agentSums: Partial<Record<Group, number>>): VerdictClass {
  return verified ? 'bot' : automationWinner(drivingScore, agentSums);
}

function automationWinner(drivingScore: number, agentSums: Partial<Record<Group, number>>): VerdictClass {
  const rhythm = agentSums.R ?? 0;
  return drivingScore > 0.85 && rhythm > 1 ? 'agent' : 'bot';
}

/** The verdict's agent: the resolved roles, plus the legacy family and method. */
function agentOf(roles: Roles, catalog: RoleCatalog, signals: readonly Signal[], hard: readonly Signal[], verified: Signal | undefined): NonNullable<Verdict['agent']> {
  const agent = roles.agent?.evidence === 'spoofed' ? null : roles.agent;
  const family = verified?.family
    ?? (agent ? catalog.entry(agent.id)?.family : undefined)
    ?? signals.filter((signal) => signal.family && signal.llr > 0).sort(strongestFirst)[0]?.family
    ?? 'unknown';
  const method = verified?.code ?? agent?.source ?? hard.filter((signal) => signal.family).sort(strongestFirst)[0]?.code ?? 'behavioral';
  return {
    family,
    ...(agent ? { id: agent.id } : {}),
    verified: !!verified,
    method,
    ...(roles.operator ? { operator: roles.operator.id } : {}),
    ...(roles.controller ? { controller: roles.controller.id } : {}),
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

function softmax(logits: Record<VerdictClass, number>): Record<VerdictClass, number> {
  const max = Math.max(logits.human, logits.bot, logits.agent);
  const exps = { human: Math.exp(logits.human - max), bot: Math.exp(logits.bot - max), agent: Math.exp(logits.agent - max) };
  const total = exps.human + exps.bot + exps.agent;
  return { human: exps.human / total, bot: exps.bot / total, agent: exps.agent / total };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
export { logit, sigm };
