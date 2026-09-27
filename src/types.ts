import type { BehaviorAssessment, AuthorizationAssessment, IntegrityAssessment } from './conduct.ts';
/** Session classes DoubleAgent emits. */
export type VerdictClass = 'human' | 'bot' | 'agent';

/** Site vertical profiles. Priors and policies vary by profile; signal models do not. */
export type Profile =
  | 'saas' | 'ecommerce' | 'content' | 'social' | 'payments'
  | 'fintech' | 'ticketing' | 'leadgen' | 'gov' | 'generic';

/** Canonical action vocabulary (custom names allowed: [A-Za-z0-9/_]). */
export type Action =
  | 'pageview' | 'search' | 'login' | 'signup' | 'password_reset' | 'add_to_cart'
  | 'checkout' | 'payment' | 'gift_card' | 'promo' | 'post' | 'message'
  | 'lead_form' | 'api_key' | (string & {});

export type Recommendation = 'allow' | 'tag' | 'challenge' | 'step_up' | 'rate_limit' | 'deny';

/**
 * Evidence groups. Correlated signals share a group and the group's total contribution
 * is capped, which prevents naive-Bayes double counting.
 *  A = hard automation/agent artifacts, E = environment, D = input driving (CDP/synthetic),
 *  R = rhythm (LLM think-time), C = biometrics, H = server header evidence, J = judge (optional server-side model).
 */
export type Group = 'A' | 'E' | 'D' | 'R' | 'C' | 'H' | 'J';

/** Which non-human hypothesis a signal supports. */
export type Target = 'bot' | 'agent' | 'both';

export interface Signal {
  /** Stable reason code, e.g. `env.webgl_software`. */
  code: string;
  group: Group;
  target: Target;
  /** Natural-log likelihood ratio P(obs|target)/P(obs|human). Negative = evidence for human. */
  llr: number;
  /** Hard evidence short-circuits the verdict. */
  hard?: boolean;
  /** Agent family this signal attributes to, if any. */
  family?: AgentFamily;
  /** Catalog entry id this signal attributes to, e.g. `openai.gptbot` (packages/core/src/catalog). */
  agentId?: string;
  detail?: string;
}

export type AgentFamily =
  | 'claude' | 'openai' | 'perplexity' | 'google' | 'browser_use' | 'browserbase'
  | 'skyvern' | 'manus' | 'amazon' | 'unknown';

export interface Reason {
  code: string;
  detail?: string;
  /** Contribution to the winning class in log-odds after caps/reliability. */
  weight: number;
}

export interface Verdict {
  /** Observation-level conduct, separate from class and catalog behaviour. Absent on legacy verdicts. */
  behavior?: BehaviorAssessment;
  authorization?: AuthorizationAssessment;
  integrity?: IntegrityAssessment;
  sessionId: string;
  class: VerdictClass;
  probability: Record<VerdictClass, number>;
  /** 0..1 — how much evidence the verdict rests on (not the same as probability). */
  confidence: number;
  /** `id` is the catalog entry (packages/core/src/catalog); `family` is the legacy coarse label. */
  agent?: { family: AgentFamily; id?: string; verified: boolean; method: string };
  reasons: Reason[];
  scores: { automation: number; environment: number; driving: number };
  recommendation: Recommendation;
  profile: Profile;
  action: Action;
  stage: 'provisional' | 'final';
  model: string;
  judge?: string;
  /** Signed verdict token (present once the collector has signed it). */
  token?: string;
  ts: number;
}

export interface ActionPolicy {
  challengeAt?: number;
  denyAt?: number;
  /** Use step_up instead of deny (login/fintech). */
  stepUp?: boolean;
  /** Never recommend beyond `tag` (content, gov). */
  tagOnly?: boolean;
}

/** Remote-updatable rules + weights. Served as immutable versioned JSON from the CDN. */
export interface Signatures {
  version: string;
  /** Prior P(bot), P(agent) per profile. */
  priors: Record<Profile, { bot: number; agent: number }>;
  /** Multiplier on prior odds per action (e.g. signup attracts more bots). */
  actionPriorBoost: Record<string, number>;
  /** Per-group cap on |log-odds| contribution. */
  groupCaps: Record<Group, number>;
  markers: MarkerRule[];
  globals: GlobalRule[];
  policies: Record<Profile, Record<string, ActionPolicy>>;
  /** Fraction of confident-human sessions that send a beacon (aggregates reweighted by 1/rate). */
  /** Ambiguity band for escalation to the judge. */
  judgeBand: [number, number];
}

export interface MarkerRule {
  /** CSS selector matched against the live DOM. */
  selector: string;
  family: AgentFamily;
  agentId?: string;
  target: Target;
  code: string;
  /** Persistent marker = evidence of past agent control rather than current. */
  llr?: number;
}

export interface GlobalRule {
  /** Regex source tested against own property names of window/document. */
  pattern: string;
  target: Target;
  code: string;
  family?: AgentFamily;
  agentId?: string;
}
