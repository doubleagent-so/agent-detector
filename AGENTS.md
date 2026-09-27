# Agent instructions

`@doubleagent-so/core`: the client-side human / bot / AI-agent detection engine. Public, MIT. Website overview:
https://doubleagent.so/docs/core/. Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing detection.

## Commands

```sh
npm ci
npm test                # vitest
npm run test:coverage   # ≥ 90% lines and branches on src/
npm run typecheck
npm run docs            # regenerate docs/signals.md and docs/catalog.md after changing signals or the catalog
npm run bench           # paste before/after tables into PRs that change weights or features
npm run size            # createEngine bundle stays ≤ 16 KB gzip
npm run build           # dist/ (publish with `npm publish ./dist`)
```

## Rules

- Test first. Every signal: a test where it fires and a real-browser test where it does not. Keep
  `test/false-positives.test.ts` green.
- No dependencies and no network calls in `src/` (`test/public-api.test.ts` enforces it).
- Erasable TypeScript only, `.ts` extensions on relative imports.
- Never rename a shipped signal code. New codes: say so in the PR (the hosted cloud must allow-list them).
- Export list is pinned in `test/public-api.test.ts`; removing an export is a major release.
- Nothing private: no server weights, internal hosts, customer data. Evasions go to SECURITY.md, not issues.

## Used as a submodule

The Double Agent monorepo checks this repo out at `packages/core` as a git submodule. When working from there, commit
and push here first (a submodule starts on a detached HEAD: `git switch main && git pull` before editing), then bump
the pointer in the monorepo. Its CI fails if the pinned commit is not on this repo's `main`.
