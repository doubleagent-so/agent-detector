import type { GlobalRule, MarkerRule } from '../types.ts';
import type { RoleCatalog } from '../attribution.ts';
import { FINGERPRINTS } from './fingerprinted.ts';

// Only fingerprint data: this module is what the browser SDK bundles.

/** DOM marker rules for `Signatures.markers`, in catalog order. */
export const markerRules = (): MarkerRule[] => FINGERPRINTS.flatMap((fingerprint) => (fingerprint.markers ?? []).map((marker) => ({
  selector: marker.selector, family: fingerprint.family ?? 'unknown', agentId: fingerprint.id, target: marker.target ?? fingerprint.class, code: marker.code, ...(marker.llr !== undefined ? { llr: marker.llr } : {}),
})));

/** Window-global rules for `Signatures.globals`, in catalog order. */
export const globalRules = (): GlobalRule[] => FINGERPRINTS.flatMap((fingerprint) => (fingerprint.globals ?? []).map((rule) => ({
  pattern: rule.pattern, target: rule.target ?? fingerprint.class, code: rule.code, agentId: fingerprint.id, ...(fingerprint.family ? { family: fingerprint.family } : {}),
})));

const fingerprints = new Map(FINGERPRINTS.map((fingerprint) => [fingerprint.id, fingerprint]));

/**
 * Attribution catalog for the browser: fingerprinted entries only, from data the bundle already
 * carries. Ids are `<operator>.<product>`, and every bot-class fingerprint is an automation tool;
 * test/attribution.test.ts pins both against the full catalog.
 */
export const fingerprintRoles: RoleCatalog = {
  entry: (id) => {
    const fingerprint = fingerprints.get(id);
    return fingerprint && { id: fingerprint.id, operator: fingerprint.id.slice(0, fingerprint.id.indexOf('.')), family: fingerprint.family ?? 'unknown', controller: fingerprint.class === 'bot' };
  },
  ipListOperator: () => undefined,
  hostOperator: () => undefined,
};
