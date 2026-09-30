import type { Signal } from '../types.ts';
import type { TraceEvent } from './trace.ts';
import { fieldFeatures } from './fields.ts';
import { curvatureFeatures, perpDeviation, points, segmentMoves, velocityFeatures } from './kinematics.ts';
import { scrollFeatures } from './scroll.ts';
import { cv, mean, median, r3, std } from './stats.ts';

/**
 * Behavioural feature extraction (groups D, R, C). Pure function of the trace → testable with
 * synthetic traces. These are heuristic observations, not calibrated identity proofs.
 *
 * Every signal is emitted with a positive llr (evidence for automation) or negative llr
 * (evidence for a human). Missing data emits nothing: "missing ≠ negative".
 */

export interface BehaviorStats {
  events: number;
  durationMs: number;
  moves: number;
  clicks: number;
  keys: number;
  inputs: number;
  touches: number;
  pointer: 'mouse' | 'touch' | 'none';
  /** 0..1 how much behavioural evidence exists; scales groups R/C. */
  reliability: number;
  /** 0..1 reliability of input-driving evidence (group D): grows per observed click/text entry. */
  driveReliability: number;
}

export interface BehaviorFeatures {
  stats: BehaviorStats;
  signals: Signal[];
  /** Numeric feature vector (for beacon / judge / model fitting). */
  vector: Record<string, number>;
}

const ACTION_KINDS = new Set(['dn', 'kd', 'in', 'wh', 'ts']);
const MICRO_KINDS = new Set(['mv', 'wh', 'sc', 'tm']);

/** Any event matching `match` within `ms` before (and at) `t`. */
const within = (events: readonly TraceEvent[], t: number, ms: number, match: (event: TraceEvent) => boolean) =>
  events.some((event) => match(event) && event.t <= t && event.t >= t - ms);

/** Collapse key bursts: consecutive keydowns < 400ms apart are one "action". */
function collapseBursts(actions: TraceEvent[]): TraceEvent[] {
  const typing = (event: TraceEvent) => event.k === 'kd' || event.k === 'in';
  const acts: TraceEvent[] = [];
  for (const action of actions) {
    const prev = acts[acts.length - 1];
    if (prev && action.t - prev.t < 400 && typing(action) && typing(prev)) continue;
    acts.push(action);
  }
  return acts;
}

/** Each long-enough segment's straightness, jitter and speed variation, and every step's Δt. */
function segmentShapes(segs: TraceEvent[][], straight: number[], jitter: number[], vcv: number[], dts: number[]): void {
  for (const segment of segs) {
    let path = 0;
    const speeds: number[] = [];
    for (let i = 1; i < segment.length; i++) {
      const step = Math.hypot(segment[i].x! - segment[i - 1].x!, segment[i].y! - segment[i - 1].y!);
      const dt = segment[i].t - segment[i - 1].t;
      path += step;
      dts.push(dt);
      if (dt > 0) speeds.push(step / dt);
    }
    const chord = Math.hypot(segment[segment.length - 1].x! - segment[0].x!, segment[segment.length - 1].y! - segment[0].y!);
    if (path > 40) {
      straight.push(chord / path);
      jitter.push(perpDeviation(segment));
      vcv.push(cv(speeds));
    }
  }
}

/**
 * One section per evidence family, in a fixed order (signal and feature order are part of the
 * output). The sections are closures over the split trace: it keeps the browser bundle small.
 */
export function extractBehavior(trace: readonly TraceEvent[], nowMs: number, completeSince = 0): BehaviorFeatures {
  const signals: Signal[] = [];
  const vector: Record<string, number> = {};
  // Page scripts and extensions can dispatch events during a human visit. Keep a
  // diagnostic count, but do not infer the visitor's physical input from those events.
  const untrusted = trace.filter((event) => event.u && (event.k === 'dn' || event.k === 'kd' || event.k === 'mv')).length;
  const ev = trace.filter((event) => !event.u);
  const moves = ev.filter((event) => event.k === 'mv');
  const downs = ev.filter((event) => event.k === 'dn');
  const keys = ev.filter((event) => event.k === 'kd' && !event.composing);
  const inputs = ev.filter((event) => event.k === 'in');
  const touches = ev.filter((event) => event.k === 'ts');
  const mouseDowns = downs.filter((down) => down.pt === 'm');
  const pointerSeen = moves.length || mouseDowns.length ? 'mouse' : 'none';
  const pointer: BehaviorStats['pointer'] = touches.length > mouseDowns.length ? 'touch' : pointerSeen;

  const nActions = ev.filter((event) => ACTION_KINDS.has(event.k)).length;
  const reliability = Math.min(1, nActions / 12) * Math.min(1, nowMs / 8000);
  const stats: BehaviorStats = {
    events: ev.length, durationMs: nowMs, moves: moves.length, clicks: downs.length, keys: keys.length,
    inputs: inputs.length, touches: touches.length, pointer, reliability,
    // CDP artefacts are per-action evidence: a few clicks/fills are already informative.
    driveReliability: Math.min(1, 0.4 + 0.15 * (downs.length + inputs.filter((i) => i.it !== 'r').length)),
  };
  const add = (signal: Signal) => signals.push(signal);
  const collect = (result: { signals: Signal[]; vector: Record<string, number> }) => { signals.push(...result.signals); Object.assign(vector, result.vector); };
  const touchInput = touches.length > 0 || downs.some((down) => down.pt === 't');
  const composition = (i: TraceEvent) => within(inputs, i.t, 1000, (event) => event.it === 'c');
  const clipboard = (i: TraceEvent) => within(ev, i.t, 1000, (event) => event.k === 'ps');

  // ---------- D: synthetic / CDP input artefacts ----------
  const artefacts = (): void => {
    if (untrusted > 0) add({ code: 'drive.untrusted_events', group: 'D', target: 'bot', llr: Math.min(4, 1.5 + untrusted * 0.3), detail: `${untrusted} isTrusted=false` });
    const sxm = ev.filter((event) => event.sxm).length;
    if (sxm >= 2) add({ code: 'drive.cdp_screen_coords', group: 'D', target: 'both', llr: 3.5, detail: `${sxm} events screenXY==clientXY` });
    // Coalescing depends on browser, hardware and scheduling. Its absence proves nothing.
    const mouseMoves = moves.filter((move) => move.pt === 'm' && move.co !== undefined && move.co >= 0);
    if (mouseMoves.length < 20) return;
    const multi = mouseMoves.filter((move) => (move.co ?? 0) > 1).length / mouseMoves.length;
    vector.coalesced_multi = r3(multi);
    if (multi > 0.2) add({ code: 'human.coalesced_samples', group: 'D', target: 'both', llr: -1.2 });
  };

  // ---------- D: clicks: the approach in the 1s before each press, where it landed, how long it was held ----------
  const clicks = (): void => {
    let noApproach = 0, observedApproaches = 0, centred = 0, sized = 0;
    const offsets: number[] = [];
    const holds: number[] = [];
    const approach = (down: TraceEvent): void => {
      if (down.t - 1000 < completeSince) return;
      observedApproaches++;
      if (moves.filter((move) => move.t < down.t && move.t >= down.t - 1000).length <= 1) noApproach++;
    };
    const place = (down: TraceEvent): void => {
      if (down.ox === undefined || down.oy === undefined || (down.w ?? 0) < 16 || (down.h ?? 0) < 12) return;
      sized++;
      offsets.push(Math.hypot(down.ox, down.oy));
      if (Math.abs(down.ox) < 0.02 && Math.abs(down.oy) < 0.04) centred++;
    };
    const hold = (down: TraceEvent): void => {
      const up = ev.find((event) => event.k === 'up' && event.t >= down.t);
      // CDP may stamp down/up identically even though their handlers ran apart.
      // Use the slower clock: queued human events retain their native duration;
      // rounded native timestamps retain a human-length dispatch duration.
      // If neither clock resolved an interval, the press remains unknown.
      const ms = up ? Math.max(up.t - down.t, up.holdMs ?? 0) : 0;
      if (ms > 0) holds.push(ms);
    };
    for (const down of mouseDowns) {
      approach(down);
      place(down);
      hold(down);
    }
    const na = observedApproaches ? noApproach / observedApproaches : 0;
    vector.click_no_approach = r3(na);
    if (observedApproaches >= 2 && na >= 0.75) add({ code: 'drive.click_without_approach', group: 'D', target: 'agent', llr: 2.5, detail: `${noApproach}/${observedApproaches} clicks without observed approach` });
    else if (observedApproaches >= 2 && na <= 0.25 && moves.length > 30) add({ code: 'human.click_approach', group: 'D', target: 'both', llr: -1 });
    placement(centred, sized, offsets);
    pressDuration(holds);
  };
  const placement = (centred: number, sized: number, offsets: number[]): void => {
    if (sized < 2) return;
    const cr = centred / sized;
    vector.click_centred = r3(cr);
    vector.click_offset_mean = r3(mean(offsets));
    if (cr >= 0.75) add({ code: 'drive.click_dead_centre', group: 'D', target: 'agent', llr: 2, detail: `${centred}/${sized} clicks at element centre` });
    else if (std(offsets) > 0.08) add({ code: 'human.click_scatter', group: 'C', target: 'both', llr: -0.6 });
  };
  const pressDuration = (holds: number[]): void => {
    if (holds.length < 2) return;
    vector.hold_mean = r3(mean(holds));
    vector.hold_std = r3(std(holds));
    if (mean(holds) < 8) add({ code: 'drive.zero_press_duration', group: 'D', target: 'both', llr: 2, detail: `mean down→up ${mean(holds).toFixed(1)}ms` });
    else if (std(holds) < 1 && holds.length >= 3) add({ code: 'drive.constant_press_duration', group: 'D', target: 'both', llr: 1.8 });
  };

  // ---------- D: text entry ----------
  /** Text inserted with no keystroke, touch, composition or clipboard: several characters count 1, one counts ½. */
  const insertWithoutKeys = (i: TraceEvent): number => {
    if (i.it !== 't' || within(keys, i.t, 60, () => true) || touchInput || composition(i) || clipboard(i) || i.t - 60 <= completeSince) return 0;
    if ((i.n ?? 0) > 1) return 1;
    return (i.n ?? 0) === 1 ? 0.5 : 0;
  };
  /** A paste with no Ctrl/Cmd+V, context menu, clipboard event or touch before it. */
  const pasteWithoutShortcut = (i: TraceEvent): boolean =>
    i.it === 'p' && !within(keys, i.t, 800, (k) => k.sp === 'v') && !within(ev, i.t, 10000, (event) => event.k === 'cm')
      && !clipboard(i) && !touchInput && i.t - 10000 > completeSince;
  const textEntry = (): void => {
    let insertNoKeys = 0, pasteNoShortcut = 0;
    for (const i of inputs) {
      insertNoKeys += insertWithoutKeys(i);
      if (pasteWithoutShortcut(i)) pasteNoShortcut++;
    }
    vector.insert_no_keys = insertNoKeys;
    vector.paste_no_shortcut = pasteNoShortcut;
    if (insertNoKeys >= 1) add({ code: 'drive.insert_text_without_keys', group: 'D', target: 'agent', llr: Math.min(3.5, 2 + insertNoKeys * 0.5), detail: `${Math.ceil(insertNoKeys)} text insertions with no keystrokes` });
    if (pasteNoShortcut >= 1) add({ code: 'drive.paste_without_shortcut', group: 'D', target: 'agent', llr: 1.8, detail: `${pasteNoShortcut} pastes without observed trigger` });
  };

  // Focus→input < 50ms with no click/Tab first (agents focus and fill immediately).
  const instantFill = (): void => {
    let filled = 0;
    for (const focus of ev.filter((event) => event.k === 'fo')) {
      const firstIn = inputs.find((i) => i.t >= focus.t && i.t - focus.t < 50 && (i.it === 't' || i.it === 'p') && !composition(i) && !clipboard(i));
      const via = within(ev, focus.t, 300, (event) => event.k === 'dn' || (event.k === 'kd' && event.sp === 't'));
      if (firstIn && !via && !touchInput && focus.t - 300 > completeSince) filled++;
    }
    if (filled >= 2) add({ code: 'drive.instant_field_fill', group: 'D', target: 'agent', llr: 1.5, detail: `${filled} fields filled instantly on focus` });
  };

  // ---------- C: keystroke dynamics ----------
  const keystrokes = (): void => {
    if (keys.length < 10) return;
    const kdTimes = keys.filter((k) => !k.mod && !k.sp).map((k) => k.t);
    const flights = kdTimes.slice(1).map((t, i) => t - kdTimes[i]).filter((flight) => flight > 0 && flight < 2000);
    const holdsK: number[] = [];
    for (const k of keys) {
      const release = ev.find((event) => event.k === 'ku' && event.ks === k.ks && event.t >= k.t);
      if (release && release.t > k.t) holdsK.push(release.t - k.t);
    }
    const backspaces = keys.filter((k) => k.sp === 'b').length;
    vector.key_flight_mean = r3(mean(flights));
    vector.key_flight_cv = r3(cv(flights));
    vector.key_hold_mean = r3(mean(holdsK));
    vector.key_hold_cv = r3(cv(holdsK));
    vector.backspace_rate = r3(backspaces / keys.length);
    typingRhythm(flights, holdsK);
    if (holdsK.length >= 8 && std(holdsK) < 2) add({ code: 'bio.constant_key_hold', group: 'C', target: 'both', llr: 1.5 });
    if (backspaces > 0 && keys.length >= 20) add({ code: 'human.corrections', group: 'C', target: 'both', llr: -0.5 });
  };
  const typingRhythm = (flights: number[], holdsK: number[]): void => {
    if (flights.length < 8) return;
    if (mean(flights) < 30) add({ code: 'bio.superhuman_typing', group: 'C', target: 'both', llr: 2.5, detail: `${mean(flights).toFixed(0)}ms between keys` });
    else if (cv(flights) < 0.15) add({ code: 'bio.uniform_typing', group: 'C', target: 'both', llr: 2, detail: `flight CV ${cv(flights).toFixed(2)}` });
    else if (cv(flights) > 0.35 && mean(holdsK) > 40) add({ code: 'human.typing_rhythm', group: 'C', target: 'both', llr: -1.2 });
  };

  // ---------- C: mouse kinematics ----------
  const mousePaths = (segs: TraceEvent[][]): void => {
    const straight: number[] = [], jitter: number[] = [], vcv: number[] = [], dts: number[] = [];
    if (segs.length >= 3) segmentShapes(segs, straight, jitter, vcv, dts);
    if (straight.length < 3) return;
    vector.move_straightness = r3(mean(straight));
    vector.move_jitter = r3(mean(jitter));
    vector.move_speed_cv = r3(mean(vcv));
    vector.move_dt_median = r3(median(dts));
    const perfectlyStraight = straight.filter((x) => x > 0.995).length / straight.length;
    if (perfectlyStraight > 0.8 && mean(jitter) < 0.5) add({ code: 'bio.linear_mouse_paths', group: 'C', target: 'both', llr: 2, detail: 'interpolated straight-line movement' });
    else if (mean(straight) < 0.97 && mean(jitter) > 1 && mean(vcv) > 0.4) add({ code: 'human.mouse_kinematics', group: 'C', target: 'both', llr: -1.5 });
    if (median(dts) < 3 && dts.length > 20) add({ code: 'bio.burst_dispatched_moves', group: 'D', target: 'both', llr: 2, detail: `median Δt ${median(dts).toFixed(1)}ms` });
  };

  // ---------- C: touch ----------
  const touch = (): void => {
    if (touches.length < 4) return;
    const forces = touches.map((t) => t.f ?? 0);
    const radii = touches.map((t) => t.r ?? 0);
    const drift = touches.map((t) => {
      const end = ev.find((event) => event.k === 'te' && event.t >= t.t);
      return end && end.x !== undefined && t.x !== undefined ? Math.hypot(end.x - t.x, (end.y ?? 0) - (t.y ?? 0)) : -1;
    }).filter((gap) => gap >= 0);
    const identical = std(radii) === 0 && std(forces) === 0 && radii[0] <= 1;
    if (identical && drift.length >= 3 && drift.every((distance) => distance === 0)) {
      add({ code: 'bio.synthetic_touch', group: 'C', target: 'both', llr: 1.5, detail: 'identical force/radius, zero drift' });
    } else if (drift.filter((distance) => distance > 0).length >= 2) add({ code: 'human.touch_drift', group: 'C', target: 'both', llr: -0.8 });
  };

  // ---------- D: scrolling ----------
  const scrolling = (): void => {
    const scrolls = ev.filter((event) => event.k === 'sc');
    if (scrolls.length >= 4) {
      const scrollInput = (event: TraceEvent) => event.k === 'wh' || event.k === 'tm' || event.k === 'dn' || (event.k === 'kd' && (event.sp === 'n' || event.sp === 't'));
      const driven = scrolls.filter((scroll) => !within(ev, scroll.t, 400, scrollInput)).length;
      vector.programmatic_scroll = r3(driven / scrolls.length);
      if (driven / scrolls.length > 0.8) add({ code: 'drive.programmatic_scroll', group: 'D', target: 'agent', llr: 1.2, detail: `${driven}/${scrolls.length} scrolls without input` });
    }
    const wheels = ev.filter((event) => event.k === 'wh');
    if (wheels.length < 4) return;
    const big = wheels.filter((w) => Math.abs(w.dy ?? 0) >= 300).length / wheels.length;
    const fractional = wheels.some((w) => (w.dy ?? 0) % 1 !== 0);
    if (big > 0.8 && !fractional) add({ code: 'drive.page_sized_wheel', group: 'D', target: 'agent', llr: 1.5, detail: 'viewport-sized wheel jumps' });
    if (fractional) add({ code: 'human.trackpad_inertia', group: 'C', target: 'both', llr: -0.8 });
  };

  // ---------- R: rhythm / LLM think-time ----------
  const rhythm = (): void => {
    const actions = ev.filter((event) => ACTION_KINDS.has(event.k));
    const firstAction = actions[0];
    if (firstAction) {
      vector.first_action_ms = Math.round(firstAction.t);
      if (firstAction.t < 250) add({ code: 'rhythm.instant_first_action', group: 'R', target: 'bot', llr: 1.5, detail: `${Math.round(firstAction.t)}ms` });
    }
    const acts = collapseBursts(actions);
    if (acts.length >= 4 && pointer === 'mouse') idleGaps(acts);
  };
  /** Gaps over 2s between actions while visible, and how many had no motion at all. */
  const idleGaps = (acts: TraceEvent[]): void => {
    let longGaps = 0, silent = 0;
    const gaps: number[] = [];
    for (let i = 1; i < acts.length; i++) {
      const previous = acts[i - 1], current = acts[i];
      const gap = current.t - previous.t;
      gaps.push(gap);
      if (gap < 2000 || previous.t + 150 <= completeSince) continue;
      if (ev.some((event) => event.k === 'vh' && event.t > previous.t && event.t < current.t)) continue;
      longGaps++;
      if (!ev.some((event) => MICRO_KINDS.has(event.k) && event.t > previous.t + 150 && event.t < current.t - 50)) silent++;
    }
    vector.gap_cv = r3(cv(gaps));
    vector.silent_gap_ratio = longGaps ? r3(silent / longGaps) : 0;
    if (longGaps >= 2 && silent / longGaps >= 0.8) add({ code: 'rhythm.think_then_act', group: 'R', target: 'agent', llr: 2.2, detail: `${silent}/${longGaps} idle gaps with zero motion, then precise action` });
    else if (longGaps >= 2 && silent / longGaps <= 0.2) add({ code: 'human.continuous_micro_activity', group: 'R', target: 'both', llr: -1 });
  };

  artefacts();
  if (mouseDowns.length) clicks();
  textEntry();
  instantFill();
  collect(fieldFeatures(trace, completeSince));
  keystrokes();
  const mouse = moves.filter((move) => move.pt === 'm');
  const runs = segmentMoves(mouse, 250, 3).map(points);
  collect(curvatureFeatures(runs));
  if (runs.length) collect(velocityFeatures(runs));
  mousePaths(segmentMoves(mouse));
  touch();
  scrolling();
  collect(scrollFeatures(ev, completeSince));
  rhythm();
  return { stats, signals, vector };
}
