import { globalRules, markerRules } from './catalog/rules.ts';
import type { Signatures, Profile, ActionPolicy } from './types.ts';

/**
 * Default rules and weights. The CDN serves an immutable, versioned copy of this object
 * (`/v1/signatures/<version>.json`) so marker lists can be updated without a script release.
 * Priors are expert estimates from vendor reports (Imperva 2025/2026, Cloudflare Radar,
 * DataDome Q2 2026); a server can replace them with per-site Beta-Binomial posteriors (`sitePrior`).
 */

const base: Record<string, ActionPolicy> = {
  pageview: { tagOnly: true },
  search: { challengeAt: 0.85 },
  login: { challengeAt: 0.6, denyAt: 0.9, stepUp: true },
  signup: { challengeAt: 0.5, denyAt: 0.85 },
  password_reset: { challengeAt: 0.6, denyAt: 0.9 },
  add_to_cart: { challengeAt: 0.9 },
  checkout: { challengeAt: 0.8 },
  payment: { challengeAt: 0.8 },
  gift_card: { challengeAt: 0.5, denyAt: 0.85 },
  promo: { challengeAt: 0.6, denyAt: 0.9 },
  post: { challengeAt: 0.7, denyAt: 0.95 },
  message: { challengeAt: 0.7, denyAt: 0.95 },
  lead_form: { challengeAt: 0.7 },
  api_key: { challengeAt: 0.6, denyAt: 0.9 },
};

const withOverrides = (o: Record<string, ActionPolicy>) => ({ ...base, ...o });

const policies: Record<Profile, Record<string, ActionPolicy>> = {
  generic: base,
  saas: withOverrides({ login: { challengeAt: 0.7, denyAt: 0.95, stepUp: true } }),
  ecommerce: withOverrides({ checkout: { challengeAt: 0.85 }, add_to_cart: { challengeAt: 0.9 } }),
  content: withOverrides({ pageview: { tagOnly: true }, search: { tagOnly: true } }),
  social: withOverrides({ signup: { challengeAt: 0.45, denyAt: 0.85 } }),
  payments: withOverrides({ payment: { challengeAt: 0.75 } }),
  fintech: withOverrides({ login: { challengeAt: 0.5, denyAt: 0.85, stepUp: true } }),
  ticketing: withOverrides({ add_to_cart: { challengeAt: 0.6, denyAt: 0.9 }, checkout: { challengeAt: 0.6, denyAt: 0.9 } }),
  leadgen: withOverrides({ lead_form: { challengeAt: 0.75 } }),
  // Public-service sites: never auto-deny (accessibility + legal access).
  gov: Object.fromEntries(Object.keys(base).map((k) => [k, { tagOnly: true }])),
};

export const DEFAULT_SIGNATURES: Signatures = {
  version: '2026.09.4',
  priors: {
    generic: { bot: 0.2, agent: 0.03 },
    saas: { bot: 0.15, agent: 0.04 },
    ecommerce: { bot: 0.2, agent: 0.03 },
    content: { bot: 0.35, agent: 0.03 },
    social: { bot: 0.25, agent: 0.04 },
    payments: { bot: 0.1, agent: 0.02 },
    fintech: { bot: 0.25, agent: 0.02 },
    ticketing: { bot: 0.4, agent: 0.02 },
    leadgen: { bot: 0.15, agent: 0.02 },
    gov: { bot: 0.2, agent: 0.02 },
  },
  actionPriorBoost: { signup: 1.6, login: 1.4, gift_card: 2, promo: 1.4, add_to_cart: 1.2, lead_form: 1.3 },
  groupCaps: { A: 12, E: 4, D: 6, R: 3, C: 3, H: 6, J: 3 },
  markers: markerRules(),
  globals: globalRules(),
  policies,
  judgeBand: [0.25, 0.75],
};
