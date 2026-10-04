import type { Group, Signal } from './types.ts';

/** Compatibility corrections for older browser bundles; shared with server rescoring.
 * A modified environment can belong to a human (extensions, UA overrides, Electron).
 * These observations are supporting evidence, never deterministic automation proof.
 */
export const SOFT_SIGNAL_REVISIONS: Readonly<
  Record<string, { group: Group; llr: number; previousGroup: Group; previousLlr: number; previousHard?: boolean }>
> = {
  'auto.webdriver_patched': { group: 'E', llr: 1.5, previousGroup: 'A', previousLlr: 7, previousHard: true },
  'auto.node_process': { group: 'E', llr: 1, previousGroup: 'A', previousLlr: 8, previousHard: true },
  'env.worker_mismatch': { group: 'E', llr: 2, previousGroup: 'A', previousLlr: 6, previousHard: true },
  'drive.no_coalesced_samples': { group: 'D', llr: 0, previousGroup: 'D', previousLlr: 1.2 },
};
export function normalizeSoftSignal(signal: Signal): Signal {
  const rule = SOFT_SIGNAL_REVISIONS[signal.code];
  return rule ? { ...signal, group: rule.group, llr: Math.min(rule.llr, Math.max(0, signal.llr)), hard: false } : signal;
}

/** Corroboration families, not counts of correlated reason codes. A missing input is
 * not enough: real users paste, dictate, pause, use accessibility tools and scroll by script.
 * Kinematics/hold/typing rules within one family cannot corroborate one another.
 * `fuse()` uses this map unless `FuseInput.families` names another (servers comparing a candidate rule).
 */
export const BEHAVIOR_FAMILIES: Readonly<Record<string, string>> = {
  'drive.click_dead_centre': 'geometry',
  'bio.linear_mouse_paths': 'geometry',
  'bio.smooth_synthetic_curve': 'geometry',
  'bio.no_deceleration': 'geometry',
  'drive.zero_press_duration': 'timing',
  'drive.constant_press_duration': 'timing',
  'bio.superhuman_typing': 'timing',
  'bio.uniform_typing': 'timing',
  'bio.constant_key_hold': 'timing',
  'bio.burst_dispatched_moves': 'timing',
  'drive.insert_text_without_keys': 'text',
  'drive.instant_field_fill': 'text',
  'drive.synthetic_field_fill': 'text',
  'drive.cdp_screen_coords': 'coordinates',
  'drive.scroll_jump': 'scroll',
  'drive.uniform_scroll_bursts': 'scroll',
};
export function hasAutomationEvidence(
  signals: readonly Signal[],
  reliability: Record<Group, number>,
  familyOfCode: Readonly<Record<string, string>> = BEHAVIOR_FAMILIES,
): boolean {
  const families = new Set<string>();
  for (const signal of signals) {
    if (signal.llr <= 0 || reliability[signal.group] <= 0) continue;
    if (signal.hard || (signal.group === 'A' && signal.llr >= 3) || ((signal.group === 'H' || signal.group === 'J') && signal.llr >= 3)) return true;
    const family = familyOfCode[signal.code];
    if (family && signal.llr * reliability[signal.group] >= 1) families.add(family);
  }
  return families.size >= 2;
}
