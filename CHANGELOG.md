# Changelog

Versions follow [semver](https://semver.org). `DEFAULT_SIGNATURES.version` (the model, sent as `sigv`) changes
separately whenever weights or rules change.

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
