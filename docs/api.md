# API reference

Everything is exported from `@doubleagent-so/agent-detector`. Types come with the package. The export list is pinned by
[test/public-api.test.ts](../test/public-api.test.ts): removing or renaming anything is a major release.

## Engine (browser)

### `createEngine(window, options?): Engine`

Starts probes and input collection. Options are listed in [Getting started](getting-started.md#in-the-page).

| `Engine` member | |
|---|---|
| `ready: Promise<Verdict>` | Resolves after the async probes. |
| `verdict(): Verdict` | Current verdict. |
| `score(action?): Verdict` | Re-score now; with an action, score for that action without changing the page's. |
| `addSignals(signals): Verdict` | Add server or judge evidence (groups H, J) and re-score. |
| `payload(ids?): BeaconPayload` | JSON summary for a backend. `ids` joins your own identifiers. |
| `page: PageContext` | Detected `{ profile, action, payment, hints }`. |
| `sessionId: string` | |
| `stop(): void` | Remove listeners, observers and timers. |

### `detectPage(window, profile?): PageContext`

Guesses the site vertical (Shopify, product markup, articles, lead forms…) and the page action (password fields,
payment scripts, URL paths) from the DOM. An explicit profile wins.

### `scanMarkers(document, signatures): Signal[]`

One pass over the DOM for agent markers. The engine does this continuously with a `MutationObserver`.

## Scoring (anywhere)

### `fuse(input: FuseInput): Verdict`

The fusion step on its own, for re-scoring on a server:

```ts
fuse({
  signals,                       // client signals you accept, plus your own
  profile: 'ecommerce', action: 'checkout',
  sig: DEFAULT_SIGNATURES,
  behaviorReliability: 0.8,      // from payload.stats.reliability
  driveReliability: 0.8,         // from payload.stats.driveReliability
  sessionId,
  sitePrior, attackMode, stage, judge, // optional
});
```

### `recommend(signatures, profile, action, class, pNonHuman, verified): Recommendation`

The policy step on its own.

### `extractBehavior(trace, nowMs, completeSince?): BehaviorFeatures`

Pure function from input events (`TraceEvent[]`) to behaviour signals, a numeric feature vector and stats
(`events`, `durationMs`, `pointer`, `reliability`, `driveReliability`). Easy to test with synthetic traces.

### `timeline(trace, maxLines?): string[]`

Compact, human-readable account of a session (`t+4.1s (idle 2.3s, 14 moves) pointer-down mouse …`) for a judge
model or logs.

### `DEFAULT_SIGNATURES: Signatures`

The model: `version`, per-profile `priors`, `actionPriorBoost`, `groupCaps`, DOM `markers`, window `globals`,
per-action `policies` and `judgeBand`.

### `SOFT_SIGNAL_REVISIONS`

Corrections applied to signals from older bundles, shared so a server re-scores them the same way.

### `validAction(name): boolean`

Action names are `[A-Za-z0-9/_]`, 1 to 64 characters.

## Catalog (anywhere)

| Export | |
|---|---|
| `CATALOG: CatalogEntry[]` | Every named bot and agent. [Browse it](catalog.md). |
| `catalogEntry(id)` | Entry by id, e.g. `'openai.chatgpt-user'`. |
| `matchUserAgent(ua)` | `{ entry, token }` for the longest matching User-Agent token. |
| `entryForSignatureAgent(origin, ua?, strict?)` | Entry for a Web Bot Auth `Signature-Agent` origin. |
| `ipListSources()` | Published IP lists, one per vendor, with the entries that share each. |
| `operatorForHost(host)` | Operator slug that owns a host, e.g. `'chatgpt.com'` → `'openai'`. |
| `familyOf(entry)`, `familyOfOperator(operator)` | Coarse family (`claude`, `openai`, …). |
| `targetOf(entry)` | `bot` or `agent`. |
| `FINGERPRINTS` | DOM markers and window globals per entry, before they become rules. |
| `markerRules()`, `globalRules()` | Fingerprints as `Signatures` rules. |

## Conduct (server)

What an actor *does*, separate from what it *is*. An allowed shopping agent and a credential-stuffing bot can both be
automation.

| Export | |
|---|---|
| `applyConduct(verdict, input)` | Returns the verdict with `behavior` (`friendly` / `neutral` / `rogue`) and `authorization`. |
| `assessConduct(input)` | The same assessment on its own. |
| `parseAgentPolicy(json)` | Validates a site's agent policy: allow or deny agents per action, and rate limits. |
| `DEFAULT_AGENT_POLICY` | Monitor mode, no rules. |
| `neutralBehavior()` | The assessment before anything is known. |

## Types

`Verdict`, `VerdictClass`, `Signal`, `Group`, `Target`, `Reason`, `Recommendation`, `Profile`, `Action`,
`AgentFamily`, `Signatures`, `MarkerRule`, `GlobalRule`, `ActionPolicy`, `Engine`, `EngineOptions`,
`BeaconPayload`, `FuseInput`, `PageContext`, `TraceEvent`, `CatalogEntry`, `Surface`, `Verifiable`, `Behaviour`,
`AgentPolicy`, `ConductInput`, `BehaviorAssessment`, `AuthorizationAssessment`, `IntegrityAssessment`. See
[src/types.ts](../src/types.ts) and [src/catalog/types.ts](../src/catalog/types.ts).
