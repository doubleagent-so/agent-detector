import type { AgentFamily, Signal } from './types.ts';

/**
 * Who a session is, as four roles with their own evidence:
 *  agent      – who acts (ClaudeBot, a declared ERC-8004 agent)
 *  operator   – who runs the agent (Anthropic)
 *  controller – what drives the browser or the request (Playwright, python-requests)
 *  client     – the browser it presents (Chrome)
 * An agent can use many controllers and clients without becoming a different agent.
 */

/** How a claim is known, strongest first. `rdns` (forward-confirmed reverse DNS) has no signal yet. */
export type Evidence = 'signed' | 'authenticated' | 'ip' | 'rdns' | 'declared' | 'marker' | 'detected' | 'spoofed';
/** Evidence that names someone. A spoofed claim names nobody: see {@link SpoofedClaim}. */
export type ProvenEvidence = Exclude<Evidence, 'spoofed'>;

export interface RoleClaim {
  /** Stable id: a catalog id (`anthropic.claudebot`), an operator slug (`anthropic`) or a declared name. */
  id: string;
  evidence: ProvenEvidence;
  /** The reason code that established the claim; `erc8004` for a user-agent declaration. */
  source: string;
}
/** A client claimed from outside its published IPs: the claimed agent stays unattributed. */
export interface SpoofedClaim {
  id: null;
  evidence: 'spoofed';
  source: string;
}
export interface ClientRole {
  browser: string | null;
  version: string | null;
  os: string | null;
  evidence: 'declared';
}
export interface Roles {
  agent: RoleClaim | SpoofedClaim | null;
  operator: RoleClaim | null;
  controller: RoleClaim | null;
  client: ClientRole | null;
  /** The agent's operator disagreed with a verified operator: the agent is left unnamed, the operator kept. */
  conflict: boolean;
}

/** The catalog facts attribution needs about one entry. */
export interface RoleEntry {
  id: string;
  operator: string;
  family: AgentFamily;
  /** Software anyone can run (automation tools, HTTP libraries): a controller, never an agent. */
  controller: boolean;
}
/** Catalog lookups: `fingerprintRoles` inside the browser bundle, `catalogRoles` on a server. */
export interface RoleCatalog {
  entry(id: string): RoleEntry | undefined;
  /** Operator of a published IP list (`verified.ip_range:<vendor>`), shared by several products or not. */
  ipListOperator(vendor: string): string | undefined;
  /** Operator owning a Web Bot Auth signature host (the `verified.web_bot_auth` detail). */
  hostOperator(host: string): string | undefined;
}
/** A user-agent declaration (an ERC-8004 name), shaped here so core needs no identity library. */
export interface RoleDeclaration {
  name: string;
  /** ERC-8128 request authentication is bound to the declared registry token. */
  authenticated: boolean;
}
export interface RoleInput {
  catalog: RoleCatalog;
  declaration?: RoleDeclaration | null;
  client?: ClientRole | null;
}

const RANK: Readonly<Record<Evidence, number>> = {
  signed: 0, authenticated: 1, ip: 2, rdns: 3, declared: 4, marker: 5, detected: 6, spoofed: 7,
};
/** For a controller, seeing it in the page beats its own user-agent token. */
const CONTROLLER_RANK: Readonly<Record<Evidence, number>> = { ...RANK, marker: -1 };
/** Evidence that proves an operator by itself: its signature or its network. */
const OPERATOR_PROOF: ReadonlySet<Evidence> = new Set<Evidence>(['signed', 'ip', 'rdns']);
/** Agent evidence that yields to a verified operator it disagrees with. */
const SELF_ASSERTED: ReadonlySet<Evidence> = new Set<Evidence>(['declared', 'marker', 'detected']);
const IP_RANGE = 'verified.ip_range:';
const DECLARATION_SOURCE = 'erc8004';

interface Candidate extends RoleClaim {
  operator: string;
  llr: number;
}

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const strongest = (rank: Readonly<Record<Evidence, number>>) => (left: Candidate, right: Candidate): number =>
  rank[left.evidence] - rank[right.evidence] || right.llr - left.llr || byText(left.id, right.id) || byText(left.source, right.source);

function evidenceOf(signal: Signal): ProvenEvidence {
  if (signal.code === 'verified.web_bot_auth') return 'signed';
  if (signal.code.startsWith(IP_RANGE)) return 'ip';
  if (signal.code.startsWith('ua.declared_agent:')) return 'declared';
  return signal.group === 'A' ? 'marker' : 'detected';
}

const claimOf = (candidate: Candidate | undefined): RoleClaim | null =>
  candidate ? { id: candidate.id, evidence: candidate.evidence, source: candidate.source } : null;

const candidateOf = (entry: RoleEntry, signal: Signal, evidence: ProvenEvidence): Candidate =>
  ({ id: entry.id, operator: entry.operator, evidence, llr: signal.llr, source: signal.code });

/**
 * Operator-level proof naming no product: a shared IP list, or a signer on an operator's own
 * domain. Used both for a signal with no `agentId` and for one whose `agentId` the catalog
 * doesn't know — the product is unnamed either way, but the operator can still be proven.
 */
function operatorProofOf(signal: Signal, evidence: ProvenEvidence, catalog: RoleCatalog): string | undefined {
  if (evidence === 'ip') return catalog.ipListOperator(signal.code.slice(IP_RANGE.length));
  if (evidence === 'signed' && signal.detail) return catalog.hostOperator(signal.detail);
  return undefined;
}

/** The declared agent, or none for a blank name (nothing to attribute to). */
function declarationCandidate(declaration: RoleDeclaration): Candidate | undefined {
  const { name, authenticated } = declaration;
  if (!name.trim()) return undefined;
  return { id: name, operator: name.split('.')[0], evidence: authenticated ? 'authenticated' : 'declared', llr: 0, source: DECLARATION_SOURCE };
}

/**
 * Resolves the four roles from a session's signals. Pure and independent of signal order: candidates
 * are sorted by (evidence, llr, id, source) before any choice. Only positive evidence counts.
 */
export function resolveRoles(signals: readonly Signal[], input: RoleInput): Roles {
  const agents: Candidate[] = [];
  const controllers: Candidate[] = [];
  const operatorProofs: Candidate[] = [];
  const spoofs: string[] = [];

  for (const signal of signals) {
    if (!(signal.llr > 0)) continue;
    if (signal.code.startsWith('net.unverified_claim:')) {
      spoofs.push(signal.code);
      continue;
    }
    const evidence = evidenceOf(signal);
    const entry = signal.agentId ? input.catalog.entry(signal.agentId) : undefined;
    if (entry) {
      const candidate = candidateOf(entry, signal, evidence);
      if (entry.controller) controllers.push(candidate);
      else agents.push(candidate);
      continue;
    }
    const operator = operatorProofOf(signal, evidence, input.catalog);
    if (operator) operatorProofs.push({ id: operator, operator, evidence, llr: signal.llr, source: signal.code });
  }

  const declared = input.declaration ? declarationCandidate(input.declaration) : undefined;
  if (declared) agents.push(declared);

  // An impersonator's user agent proves nothing: every claim it declared is dropped.
  const survivingAgents = spoofs.length > 0 ? agents.filter((candidate) => candidate.evidence !== 'declared') : agents;
  const trusted = [...survivingAgents].sort(strongest(RANK));
  controllers.sort(strongest(CONTROLLER_RANK));

  const operatorClaimsFromAgents = trusted.map((candidate) => ({ ...candidate, id: candidate.operator }));
  const proofs = [...operatorProofs, ...operatorClaimsFromAgents].sort(strongest(RANK));
  const verifiedOperator = proofs.find((proof) => OPERATOR_PROOF.has(proof.evidence));

  const leading = trusted[0];
  const selfAsserted = leading !== undefined && SELF_ASSERTED.has(leading.evidence);
  const disagrees = leading !== undefined && verifiedOperator !== undefined && verifiedOperator.id !== leading.operator;
  const conflict = selfAsserted && disagrees;
  const agent = conflict ? undefined : leading;
  const operatorId = agent?.operator ?? verifiedOperator?.id;
  const spoofed = spoofs.sort(byText)[0];

  return {
    agent: claimOf(agent) ?? (spoofed ? { id: null, evidence: 'spoofed', source: spoofed } : null),
    operator: claimOf(proofs.find((proof) => proof.id === operatorId)),
    controller: claimOf(controllers[0]),
    client: input.client ?? null,
    conflict,
  };
}
