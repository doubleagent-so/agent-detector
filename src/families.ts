import { BEHAVIOR_FAMILIES } from './evidence.ts';

/**
 * Candidate corroboration families for server-side comparison (`FuseInput.families`). Not the default, and not
 * imported by `createEngine`, so the browser bundle never carries it.
 *
 * C2b (2026-10-04): no approach before a click and motionless pauses before each action join `geometry`. They
 * describe the same still or teleporting pointer as dead-centre landings, so they can corroborate a different
 * family (press or key timing, text entry) but never each other.
 */
export const FAMILIES_C2B: Readonly<Record<string, string>> = Object.freeze({
  ...BEHAVIOR_FAMILIES,
  'drive.click_without_approach': 'geometry',
  'rhythm.think_then_act': 'geometry',
});
