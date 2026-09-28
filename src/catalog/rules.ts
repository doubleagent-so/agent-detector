import type { GlobalRule, MarkerRule } from '../types.ts';
import type { RoleCatalog } from '../attribution.ts';
import { FINGERPRINTS } from './fingerprinted.ts';

// Only fingerprint data: this module is what the browser SDK bundles.

/** DOM marker rules for `Signatures.markers`, in catalog order. */
export const markerRules = (): MarkerRule[] => FINGERPRINTS.flatMap((f) => (f.markers ?? []).map((m) => ({
  selector: m.selector, family: f.family ?? 'unknown', agentId: f.id, target: m.target ?? f.class, code: m.code, ...(m.llr !== undefined ? { llr: m.llr } : {}),
})));

/** Window-global rules for `Signatures.globals`, in catalog order. */
export const globalRules = (): GlobalRule[] => FINGERPRINTS.flatMap((f) => (f.globals ?? []).map((g) => ({
  pattern: g.pattern, target: g.target ?? f.class, code: g.code, agentId: f.id, ...(f.family ? { family: f.family } : {}),
})));

const fingerprints = new Map(FINGERPRINTS.map((f) => [f.id, f]));

/**
 * Attribution catalog for the browser: fingerprinted entries only, from data the bundle already
 * carries. Ids are `<operator>.<product>`, and every bot-class fingerprint is an automation tool;
 * test/attribution.test.ts pins both against the full catalog.
 */
export const fingerprintRoles: RoleCatalog = {
  entry: (id) => {
    const f = fingerprints.get(id);
    return f && { id: f.id, operator: f.id.slice(0, f.id.indexOf('.')), family: f.family ?? 'unknown', controller: f.class === 'bot' };
  },
  ipListOperator: () => undefined,
  hostOperator: () => undefined,
};
