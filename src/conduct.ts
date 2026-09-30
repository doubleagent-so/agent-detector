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

type AddReason = (code: string, source: BehaviorReason['source'], severity: BehaviorReason['severity'], value: number) => void;

/** The policy rules for this action and agent: a deny wins; an allow needs a server-verified identity. */
function authorize(input: ConductInput, policy: AgentPolicy) {
  // Attribution for policy is exclusively server-verified evidence, never a DOM marker or UA declaration.
  const agent = resolveRoles(input.signals, { catalog: input.catalog ?? catalogRoles }).agent;
  const identity = agent?.id && POLICY_EVIDENCE.has(agent.evidence) ? agent.id : undefined;
  const matches = policy.rules.filter(
    (rule) =>
      (rule.actions.includes(input.action) || rule.actions.includes('*')) &&
      (rule.agentIds.includes('*') || (!!identity && rule.agentIds.includes(identity))),
  );
  const denied = matches.find((rule) => rule.effect === 'deny');
  // Wildcard allow still requires a verified identity: unknown clients cannot self-enrol as friendly.
  const allowed = identity ? matches.find((rule) => rule.effect === 'allow') : undefined;
  let authorization: AuthorizationAssessment = allowed ? { decision: 'allowed', ruleId: allowed.id } : { decision: 'unknown' };
  if (denied) authorization = { decision: 'denied', ruleId: denied.id };
  return { authorization, allowed, denied };
}

function identityReasons(signals: readonly Signal[], add: AddReason): void {
  for (const signal of signals.filter((candidate) => candidate.group === 'H')) {
    // A cryptographic mismatch is stronger than expiry, network failure or missing key material.
    if (signal.code === 'net.web_bot_auth_invalid') add('identity.invalid_signature', 'network', 'suspicious', 60);
    if (signal.code.startsWith('net.unverified_claim:')) add('identity.unverified_claim', 'network', 'suspicious', 45);
    if (signal.code === 'net.ua_mismatch') add('identity.inconsistent_declaration', 'network', 'suspicious', 25);
  }
}

function integrityReasons(integrity: ConductInput['integrity'], add: AddReason): void {
  for (const reason of integrity?.reasons ?? []) {
    if (['pow_invalid', 'ticket_invalid', 'evidence_tampered'].includes(reason)) add(`integrity.${reason}`, 'integrity', 'suspicious', 65);
    if (['ip_burst', 'threat_score'].includes(reason)) add(`integrity.${reason}`, 'integrity', 'suspicious', 45);
  }
  if (integrity?.quarantined) add('integrity.quarantined', 'integrity', 'suspicious', 65);
}

function activityReasons(activity: NonNullable<ConductInput['activity']>, limits: AgentPolicy['limits'], add: AddReason): void {
  if (activity.requests > limits.requests) add('abuse.request_rate', 'application', 'violation', 80);
  if (activity.failedAuth >= limits.failedAuth) add('abuse.repeated_auth_failure', 'application', 'violation', 90);
  if (activity.deniedActions >= limits.deniedActions) add('abuse.repeated_denied_action', 'application', 'violation', 90);
  if (activity.honeypotHits > 0) add('abuse.confirmed_trap', 'application', 'violation', 95);
  // One failure or denial prevents a friendly label, without treating ordinary mistakes as rogue.
  if (activity.failedAuth > 0 && activity.failedAuth < limits.failedAuth) add('activity.auth_failure', 'application', 'suspicious', 15);
  if (activity.deniedActions > 0 && activity.deniedActions < limits.deniedActions) add('activity.action_denied', 'application', 'suspicious', 25);
}

/** Call only with server-owned evidence. No browser payload may supply policy/activity/integrity. */
export function assessConduct(input: ConductInput): { behavior: BehaviorAssessment; authorization: AuthorizationAssessment } {
  const policy = input.policy ?? DEFAULT_AGENT_POLICY;
  const reasons: BehaviorReason[] = [];
  let risk = 0;
  const add: AddReason = (code, source, severity, value) => {
    if (!reasons.some((reason) => reason.code === code)) reasons.push({ code, source, severity });
    risk = Math.max(risk, value);
  };
  const { authorization, allowed, denied } = authorize(input, policy);
  if (denied) add('policy.action_denied', 'policy', 'violation', 90);
  identityReasons(input.signals, add);
  integrityReasons(input.integrity, add);
  if (input.activity) activityReasons(input.activity, policy.limits, add);
  const rogue = reasons.some((reason) => reason.severity === 'violation');
  const friendly = !rogue && allowed && reasons.length === 0 && (!input.integrity || input.integrity.trust >= 0.7);
  if (friendly) add('policy.authorized_identity', 'policy', 'info', 0);
  const calmLabel = friendly ? 'friendly' : 'neutral';
  return {
    behavior: {
      version: 1,
      label: rogue ? 'rogue' : calmLabel,
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

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((k) => keys.includes(k));

/** 1–50 distinct strings, each matching `re`. */
function matchList(field: unknown, re: RegExp): string[] {
  if (!Array.isArray(field) || field.length < 1 || field.length > 50 || field.some((x) => typeof x !== 'string' || !re.test(x)))
    throw new Error('invalid policy match list');
  return [...new Set(field)] as string[];
}

/** One allow or deny rule with a unique id; `ids` collects the ids seen so far. */
function parseRule(raw: unknown, ids: Set<string>): AgentPolicy['rules'][number] {
  if (!isRecord(raw)) throw new Error('invalid policy rule');
  const rule = raw;
  if (
    !onlyKeys(rule, ['id', 'effect', 'agentIds', 'actions']) ||
    typeof rule.id !== 'string' ||
    !/^[\w-]{1,64}$/.test(rule.id) ||
    ids.has(rule.id) ||
    !['allow', 'deny'].includes(String(rule.effect))
  )
    throw new Error('invalid or duplicate policy rule');
  ids.add(rule.id);
  return {
    id: rule.id,
    effect: rule.effect as 'allow' | 'deny',
    agentIds: matchList(rule.agentIds, /^(?:\*|[a-z0-9][a-z0-9._-]{0,99})$/),
    actions: matchList(rule.actions, /^(?:\*|[A-Za-z0-9/_]{1,64})$/),
  };
}

/** Each limit a whole number from 1 to 1,000,000. */
function parseLimits(value: unknown): AgentPolicy['limits'] {
  if (!isRecord(value) || !onlyKeys(value, ['requests', 'failedAuth', 'deniedActions'])) throw new Error('invalid policy limits');
  for (const key of ['requests', 'failedAuth', 'deniedActions'])
    if (!Number.isInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > 1_000_000)
      throw new Error(`invalid limit ${key}`);
  return { requests: Number(value.requests), failedAuth: Number(value.failedAuth), deniedActions: Number(value.deniedActions) };
}

/** Strict, bounded policy validation shared by management APIs and configuration reads. */
export function parseAgentPolicy(value: unknown): AgentPolicy {
  if (!isRecord(value)) throw new Error('agent_policy must be an object');
  const policy = value;
  if (
    !onlyKeys(policy, ['version', 'mode', 'rules', 'limits']) ||
    policy.version !== 1 ||
    !['monitor', 'enforce'].includes(String(policy.mode)) ||
    !Array.isArray(policy.rules) ||
    policy.rules.length > 50
  )
    throw new Error('invalid agent_policy version, mode or rules');
  const ids = new Set<string>();
  const rules = policy.rules.map((raw) => parseRule(raw, ids));
  const limits = parseLimits(policy.limits);
  return {
    version: 1,
    mode: policy.mode as AgentPolicy['mode'],
    rules,
    limits,
  };
}
