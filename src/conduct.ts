import { resolveRoles, type Evidence, type RoleCatalog } from './attribution.ts';
import { catalogRoles } from './catalog/index.ts';
import type { Signal, Verdict } from './types.ts';

/** Observed conduct, independent of automation class and catalog task category. */
export type BehaviorLabel = 'friendly' | 'neutral' | 'rogue';
export interface BehaviorReason {
  code: string;
  source: 'policy' | 'application' | 'network' | 'integrity';
  severity: 'info' | 'suspicious' | 'violation';
}
export interface BehaviorAssessment {
  version: 1;
  label: BehaviorLabel;
  /** Rule severity, not a probability of malicious intent. */
  risk: number;
  source: 'browser' | 'server';
  scope: 'observation';
  reasons: BehaviorReason[];
}
export interface AuthorizationAssessment {
  decision: 'allowed' | 'denied' | 'unknown';
  ruleId?: string;
}
export interface IntegrityAssessment {
  trust: number;
  quarantined: boolean;
  reasons: string[];
}
export interface AgentPolicy {
  version: 1;
  mode: 'monitor' | 'enforce';
  rules: { id: string; effect: 'allow' | 'deny'; agentIds: string[]; actions: string[] }[];
  /** Limits per actor over a rolling 60-second window, supplied by the trusted application path. */
  limits: { requests: number; failedAuth: number; deniedActions: number };
}
export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  version: 1,
  mode: 'monitor',
  rules: [],
  limits: { requests: 120, failedAuth: 8, deniedActions: 3 },
};
export interface ApplicationActivity {
  requests: number;
  failedAuth: number;
  deniedActions: number;
  honeypotHits: number;
}
export interface ConductInput {
  action: string;
  signals: Signal[];
  policy?: AgentPolicy;
  integrity?: IntegrityAssessment;
  activity?: ApplicationActivity;
  /** Attribution catalog; the full catalog by default, since conduct runs on a server. */
  catalog?: RoleCatalog;
}
export const neutralBehavior = (): BehaviorAssessment => ({
  version: 1,
  label: 'neutral',
  risk: 0,
  source: 'browser',
  scope: 'observation',
  reasons: [],
});
/** Evidence that may carry policy: a signature or a published IP list, never a DOM marker or UA declaration. */
const POLICY_EVIDENCE: ReadonlySet<Evidence> = new Set<Evidence>(['signed', 'ip']);

/** Call only with server-owned evidence. No browser payload may supply policy/activity/integrity. */
export function assessConduct(input: ConductInput): { behavior: BehaviorAssessment; authorization: AuthorizationAssessment } {
  const policy = input.policy ?? DEFAULT_AGENT_POLICY;
  const reasons: BehaviorReason[] = [];
  let risk = 0;
  const add = (code: string, source: BehaviorReason['source'], severity: BehaviorReason['severity'], value: number) => {
    if (!reasons.some((r) => r.code === code)) reasons.push({ code, source, severity });
    risk = Math.max(risk, value);
  };
  // Attribution for policy is exclusively server-verified evidence, never a DOM marker or UA declaration.
  const agent = resolveRoles(input.signals, { catalog: input.catalog ?? catalogRoles }).agent;
  const identity = agent?.id && POLICY_EVIDENCE.has(agent.evidence) ? agent.id : undefined;
  const matches = policy.rules.filter(
    (r) =>
      (r.actions.includes(input.action) || r.actions.includes('*')) &&
      (r.agentIds.includes('*') || (!!identity && r.agentIds.includes(identity))),
  );
  const denied = matches.find((r) => r.effect === 'deny');
  // Wildcard allow still requires a verified identity: unknown clients cannot self-enrol as friendly.
  const allowed = identity ? matches.find((r) => r.effect === 'allow') : undefined;
  const authorization: AuthorizationAssessment = denied
    ? { decision: 'denied', ruleId: denied.id }
    : allowed
      ? { decision: 'allowed', ruleId: allowed.id }
      : { decision: 'unknown' };
  if (denied) add('policy.action_denied', 'policy', 'violation', 90);
  for (const signal of input.signals.filter((s) => s.group === 'H')) {
    // A cryptographic mismatch is stronger than expiry, network failure or missing key material.
    if (signal.code === 'net.web_bot_auth_invalid') add('identity.invalid_signature', 'network', 'suspicious', 60);
    if (signal.code.startsWith('net.unverified_claim:')) add('identity.unverified_claim', 'network', 'suspicious', 45);
    if (signal.code === 'net.ua_mismatch') add('identity.inconsistent_declaration', 'network', 'suspicious', 25);
  }
  for (const reason of input.integrity?.reasons ?? []) {
    if (['pow_invalid', 'ticket_invalid', 'evidence_tampered'].includes(reason)) add(`integrity.${reason}`, 'integrity', 'suspicious', 65);
    if (['ip_burst', 'threat_score'].includes(reason)) add(`integrity.${reason}`, 'integrity', 'suspicious', 45);
  }
  if (input.integrity?.quarantined) add('integrity.quarantined', 'integrity', 'suspicious', 65);
  const activity = input.activity;
  if (activity) {
    if (activity.requests > policy.limits.requests) add('abuse.request_rate', 'application', 'violation', 80);
    if (activity.failedAuth >= policy.limits.failedAuth) add('abuse.repeated_auth_failure', 'application', 'violation', 90);
    if (activity.deniedActions >= policy.limits.deniedActions) add('abuse.repeated_denied_action', 'application', 'violation', 90);
    if (activity.honeypotHits > 0) add('abuse.confirmed_trap', 'application', 'violation', 95);
    // One failure or denial prevents a friendly label, without treating ordinary mistakes as rogue.
    if (activity.failedAuth > 0 && activity.failedAuth < policy.limits.failedAuth)
      add('activity.auth_failure', 'application', 'suspicious', 15);
    if (activity.deniedActions > 0 && activity.deniedActions < policy.limits.deniedActions)
      add('activity.action_denied', 'application', 'suspicious', 25);
  }
  const rogue = reasons.some((r) => r.severity === 'violation');
  const friendly = !rogue && allowed && reasons.length === 0 && (!input.integrity || input.integrity.trust >= 0.7);
  if (friendly) add('policy.authorized_identity', 'policy', 'info', 0);
  return {
    behavior: {
      version: 1,
      label: rogue ? 'rogue' : friendly ? 'friendly' : 'neutral',
      risk,
      source: 'server',
      scope: 'observation',
      reasons,
    },
    authorization,
  };
}

/** Behavior tagging is always on. Explicit enforcement is tenant-configurable. Integrity is mandatory. */
export function applyConduct(verdict: Verdict, input: ConductInput): Verdict {
  const result = assessConduct(input);
  const policy = input.policy ?? DEFAULT_AGENT_POLICY;
  // A prior-only human guess is not affirmative evidence for access.
  let recommendation = verdict.class === 'human' && verdict.confidence === 0 && verdict.recommendation === 'allow' ? 'challenge' : verdict.recommendation;
  if (input.integrity?.quarantined) recommendation = 'challenge';
  if (policy.mode === 'enforce') {
    if (result.behavior.label === 'rogue' || result.authorization.decision === 'denied') recommendation = 'deny';
    else if (result.behavior.label === 'friendly') recommendation = 'allow';
  }
  return {
    ...verdict,
    ...result,
    ...(input.integrity
      ? {
          integrity: {
            trust: input.integrity.trust,
            quarantined: input.integrity.quarantined,
            reasons: input.integrity.reasons.slice(0, 20),
          },
        }
      : {}),
    recommendation,
  };
}

/** Strict, bounded policy validation shared by management APIs and configuration reads. */
export function parseAgentPolicy(value: unknown): AgentPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('agent_policy must be an object');
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).some((k) => !['version', 'mode', 'rules', 'limits'].includes(k)) ||
    p.version !== 1 ||
    !['monitor', 'enforce'].includes(String(p.mode)) ||
    !Array.isArray(p.rules) ||
    p.rules.length > 50
  )
    throw new Error('invalid agent_policy version, mode or rules');
  const ids = new Set<string>();
  const rules = p.rules.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid policy rule');
    const r = raw as Record<string, unknown>;
    if (
      Object.keys(r).some((k) => !['id', 'effect', 'agentIds', 'actions'].includes(k)) ||
      typeof r.id !== 'string' ||
      !/^[\w-]{1,64}$/.test(r.id) ||
      ids.has(r.id) ||
      !['allow', 'deny'].includes(String(r.effect))
    )
      throw new Error('invalid or duplicate policy rule');
    ids.add(r.id);
    const list = (v: unknown, re: RegExp) => {
      if (!Array.isArray(v) || v.length < 1 || v.length > 50 || v.some((x) => typeof x !== 'string' || !re.test(x)))
        throw new Error('invalid policy match list');
      return [...new Set(v)] as string[];
    };
    return {
      id: r.id,
      effect: r.effect as 'allow' | 'deny',
      agentIds: list(r.agentIds, /^(?:\*|[a-z0-9][a-z0-9._-]{0,99})$/),
      actions: list(r.actions, /^(?:\*|[A-Za-z0-9/_]{1,64})$/),
    };
  });
  const limits = p.limits as Record<string, unknown>;
  if (
    !limits ||
    typeof limits !== 'object' ||
    Array.isArray(limits) ||
    Object.keys(limits).some((k) => !['requests', 'failedAuth', 'deniedActions'].includes(k))
  )
    throw new Error('invalid policy limits');
  for (const key of ['requests', 'failedAuth', 'deniedActions'])
    if (!Number.isInteger(limits[key]) || Number(limits[key]) < 1 || Number(limits[key]) > 1_000_000)
      throw new Error(`invalid limit ${key}`);
  return {
    version: 1,
    mode: p.mode as AgentPolicy['mode'],
    rules,
    limits: { requests: Number(limits.requests), failedAuth: Number(limits.failedAuth), deniedActions: Number(limits.deniedActions) },
  };
}
