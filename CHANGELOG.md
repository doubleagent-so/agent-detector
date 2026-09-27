# Changelog

Versions follow [semver](https://semver.org). `DEFAULT_SIGNATURES.version` (the model, sent as `sigv`) changes
separately whenever weights or rules change.

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
