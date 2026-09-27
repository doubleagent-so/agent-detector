import type { AgentFamily } from '../types.ts';
import type { CatalogEntry } from './types.ts';

const FAMILY_BY_OPERATOR: Record<string, AgentFamily> = {
  anthropic: 'claude', openai: 'openai', perplexity: 'perplexity', google: 'google', amazon: 'amazon',
  'browser-use': 'browser_use', browserbase: 'browserbase', skyvern: 'skyvern', manus: 'manus',
};

/** Domains each operator owns, for attributing a Signature-Agent origin that no catalog entry names yet. */
const OPERATOR_DOMAINS: [string, string[]][] = [
  ['openai', ['openai.com', 'chatgpt.com', 'oaiusercontent.com']],
  ['anthropic', ['anthropic.com', 'claude.ai', 'claude.com']],
  ['perplexity', ['perplexity.ai', 'perplexity.com']],
  ['google', ['google.com', 'googleusercontent.com', 'gstatic.com', 'bot.goog']],
  ['amazon', ['amazon.com', 'amazonbot.amazon']],
  ['browserbase', ['browserbase.com']], ['browser-use', ['browser-use.com']], ['skyvern', ['skyvern.com']], ['manus', ['manus.im', 'manus.ai']],
];

/** Operator slug owning a host, if known. */
export function operatorForHost(host: string): string | undefined {
  const h = host.toLowerCase();
  return OPERATOR_DOMAINS.find(([, ds]) => ds.some((d) => h === d || h.endsWith(`.${d}`)))?.[0];
}

/** Legacy family for an operator slug. */
export const familyOfOperator = (operator: string | undefined): AgentFamily => (operator ? FAMILY_BY_OPERATOR[operator] ?? 'unknown' : 'unknown');

/** Legacy coarse family of an entry (kept for one release alongside `agentId`). */
export const familyOf = (e: CatalogEntry | undefined): AgentFamily =>
  e ? e.family ?? FAMILY_BY_OPERATOR[e.operator] ?? 'unknown' : 'unknown';

