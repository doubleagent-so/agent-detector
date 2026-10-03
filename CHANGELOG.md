# Changelog

Versions follow [semver](https://semver.org). `DEFAULT_SIGNATURES.version` (the model, sent as `sigv`) changes
separately whenever weights or rules change.

## Unreleased

Fewer false positives from three shadowed behaviour codes. Signatures `2026.10.1`.

- `bio.smooth_synthetic_curve` also counts runs with one turn reversal, so S-shaped (one-inflection) Bézier paths
  are caught.
- Mouse kinematics (curvature, speed curve, path shape) use only moves with no button held. Drags on sliders and in
  games follow the control, so they no longer trip `bio.no_deceleration`.
- `drive.scroll_jump` needs three unexplained jumps, not two (pages can scroll themselves twice after load), and a
  held mouse button explains scrolling (holding on the scrollbar track).

Frustration cues and content vocabularies. Features only: no new signal codes, no weight changes.

- New `features` keys, present once a visit has a click or a script error: `rage_clicks` (bursts of 3+ clicks
  within 1 s inside 30 px), `dead_clicks` (clicks on non-interactive content with no navigation, input or scroll in
  the next second), `error_clicks` (clicks within 1 s after a script error) and `js_errors`.
- The collector marks `dn` and `ck` events on interactive targets (or their children up to 5 levels deep) with
  `ia: 1`, and records script errors and unhandled rejections as a new trace kind `er`: a timestamp only, never the
  message, file or stack. At most one per 500 ms and 100 per page, so an error loop cannot evict input.
- New exports `PAGE_TYPES` and `ROLES` (with types `PageType` and `Role`): shared vocabularies for labelling a page
  and its regions.
- The `createEngine` bundle budget rises to 17.6 KB gzip.

## 0.3.0 (2026-09-28)

Agent attribution: agent, operator, controller and client resolved separately. Signatures `2026.09.6`.

- New `resolveRoles(signals, { catalog, declaration?, client? })`: the agent (who acts), its operator, the
  controller (the automation tool or HTTP library driving the visit) and the client, each with its own evidence
  (`signed`, `authenticated`, `ip`, `rdns`, `declared`, `marker`, `detected`, `spoofed`), independent of signal
  order. Before, the first signal naming any catalog entry won, so a Playwright global could be reported as the
  agent of a ClaudeBot request from Anthropic's published IPs.
- New `catalogRoles` (the full catalog, for servers) and `fingerprintRoles` (the fingerprints the browser bundle
  already carries). `FuseInput.catalog` and `ConductInput.catalog` select one; `fuse` defaults to
  `fingerprintRoles`, `assessConduct` to `catalogRoles`.
- `Verdict.agent.id` is the resolved agent, never an automation tool or HTTP library. New optional
  `Verdict.agent.operator` and `Verdict.agent.controller`.
- For an unverified agent, `Verdict.agent.method` is now the resolved agent's source, such as
  `ua.declared_agent:ClaudeBot` or a marker code. Before, it was the first hard signal with a family, or
  `behavioral`.
- Hard evidence from an automation tool alone (`auto.webdriver`, `global.playwright`, …) is unchanged: `bot` at
  0.99, or `agent` at 0.99 only with strong driving (driving score > 0.85 and rhythm > 1). Recommendations and
  verified identities are unchanged.
- The strongest verified signal is chosen and equal-weight reasons are ordered by code.
- `assessConduct` authorizes only an agent proven by a signature or a published IP list.
- Size budget raised from 16 KB to 17 KB gzip (15.62 KB before, 16.69 KB now).
- No new signal codes.

## 0.2.0 (2026-09-27)

FP-Agent and BeCAPTCHA behavioural signals (shadowed: reported, weighted 0 until promoted). Signatures `2026.09.5`.

- Five new signal codes (all shadowed): `drive.synthetic_field_fill`, `drive.scroll_jump`, `drive.uniform_scroll_bursts`,
  `bio.smooth_synthetic_curve`, `bio.no_deceleration`. These are reported in beacons but carry `llr: 0` and `hard: false`.
- New `features` keys: `field_orphan_fields`, `field_synthetic_events`, `scroll_bursts`, `scroll_dist_cv`,
  `scroll_dist_median`, `scroll_dur_median`, `scroll_jump_ratio`, `curv_angle_mean`, `curv_angle_range`,
  `curv_dist_mean`, `move_dir_entropy`, `vel_end_ratio`, `vel_peak_pos`, `vel_peaks`, `vel_segments`.
- New `Signatures.shadow` field: array of codes reported but weighted at 0 in fusion; allows early measurement
  without affecting verdicts.
- New trace kinds: `iv` (input event with no matching beforeinput / script-set or autofill), `ch` (change),
  `se` (document scroll settled, 150 ms trailing).
- New trace fields: `fs` (field slot: hash of tag/id/name to tell fields apart), `sy` (document scrollY in px
  on scroll/settled events).
- New bench flags: `--signals` (show signal codes firing per scenario), `--unshadow` (run with all shadow codes
  weighted as normal for comparison).
- Size budget raised from 15 KB to 16 KB gzip (13.4 KB before detectors, 15.5 KB after).
- Cloud: allow-list the new codes before relying on them.

## 0.1.0 (2026-09-27)

First public release. Signatures `2026.09.4`.

- Engine: environment probes, DOM markers and window globals, behaviour features (driving, rhythm, biometrics),
  capped log-odds fusion, per-profile policies.
- Catalog of 226 named bots and agents with User-Agent tokens, IP lists, reverse DNS, Web Bot Auth hosts and
  in-page fingerprints.
- Conduct assessment (friendly / neutral / rogue) and agent policies for servers.
