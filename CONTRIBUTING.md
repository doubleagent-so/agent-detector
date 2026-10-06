# Contributing

Thanks for helping Double Agent tell humans, bots and AI agents apart. The most useful contributions are:

- **A misread session.** A real browser labelled bot or agent, or an agent labelled human. Open a
  "Misclassification" issue with the browser, the agent or tool, and the verdict's `reasons`.
- **A new agent or bot** for the catalog (`src/catalog/entries.ts`), with the operator's own documentation as `source`.
- **A new probe or signal**, or better weights for existing ones.

## Workflow

```sh
npm ci
npm test               # vitest
npm run test:coverage  # ≥ 90% lines and branches on src/
npm run typecheck
npm run bench          # confusion matrix on labelled synthetic sessions
npm run size           # createEngine bundle stays under its gzip budget
npm run docs           # regenerate docs/signals.md and docs/catalog.md (a test fails if they are stale)
npm run example        # live verdict page at http://127.0.0.1:8123
```

## Project layout

| Path | |
|---|---|
| `src/engine.ts` | `createEngine`: wires probes, collectors and fusion together |
| `src/env/` | Environment probes, device facts, DOM markers |
| `src/behavior/` | Input collection (`collector.ts`), features (`features.ts`), the event ring (`trace.ts`) |
| `src/fusion.ts` | Log-odds fusion, confidence, recommendation |
| `src/signatures.ts` | `DEFAULT_SIGNATURES`: priors, caps, policies, the model version |
| `src/catalog/` | Named bots and agents, and their in-page fingerprints |
| `src/conduct.ts` | Friendly / neutral / rogue conduct and agent policies (server side) |
| `test/` | Vitest suites; `traces.ts` builds synthetic sessions |
| `bench/`, `examples/`, `scripts/` | Benchmark, runnable examples, build/size/docs scripts |

## Labels

`misclassification` · `false-positive` · `catalog` · `new-signal` · `weights` · `bug` · `docs` ·
`good first issue` · `help wanted` · `breaking`. Maintainers apply them; say in your issue which one you think fits.

## Rules

1. **Test first.** Write the failing test, then the change. Every signal needs a test for when it fires and when it
   must not.
2. **False positives are the worst bug.** `test/false-positives.test.ts` must stay green. When you fix a misread
   browser, add its case there.
3. **Weights need evidence.** A change to an `llr`, a group cap or a prior needs a reason: a published measurement, a
   reproducible trace, or `npm run bench` output before and after. Paste the tables into the pull request.
4. **Missing is not negative.** A probe that cannot run emits nothing; it never emits evidence for a human.
5. **Signal codes are stable.** Use the `group.name` form (`env.webgl_software`) and never rename a shipped code.
   Double Agent's cloud ignores codes it does not know yet, so new codes reach it only after a server update. Say
   in the pull request that the code is new.
6. **No network, no dependencies.** Core runs inside every page. `test/public-api.test.ts` fails if source calls
   `fetch`, `sendBeacon` or similar.
7. **Public API.** `test/public-api.test.ts` lists every export. Adding one is a minor release; removing or renaming
   one is a major release.
8. **Erasable TypeScript only** (no enums, namespaces or parameter properties), with `.ts` extensions on relative
   imports. `npm run typecheck` enforces both.

## Releases

Maintainers bump `version` in `package.json`, update `DEFAULT_SIGNATURES.version` when weights or rules change, and
push a `v<version>` tag. The release workflow checks the tag matches `package.json`, tests, builds and publishes
`dist/` to npm with provenance, then creates the GitHub Release with that version's `CHANGELOG.md` section as its notes.

Evasion techniques go to [Security](SECURITY.md), not public issues.
