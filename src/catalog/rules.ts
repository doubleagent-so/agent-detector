import type { GlobalRule, MarkerRule } from '../types.ts';
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
