# @doubleagent-so/core

The detection engine behind **Double Agent**. It classifies a browser session as **human**, **bot** or **AI agent**
(Claude in Chrome, ChatGPT Atlas, Comet, Browser Use, Playwright, headless Chrome…) entirely inside the page.
It has no dependencies and makes no network requests. You decide what to do with the verdict.

Use it directly when you want the raw engine. For a drop-in script with analytics and ads integrations, use
[`@doubleagent-so/js`](https://doubleagent.so/docs/script-tag/).

## Install

```sh
npm install @doubleagent-so/core
```

## Quick start

```ts
import { createEngine } from '@doubleagent-so/core';

const engine = createEngine(window, {
  profile: 'ecommerce',                 // optional; detected from the page when omitted
  onVerdict: (v) => console.log(v.class, v.probability),
});

const v = await engine.ready;           // after the async probes (WebGL, workers, client hints)
v.class;           // 'human' | 'bot' | 'agent'
v.probability;     // { human: 0.03, bot: 0.05, agent: 0.92 }
v.agent;           // { family: 'claude', id: 'anthropic.claude-in-chrome', verified: false, method: 'marker.claude_active' }
v.recommendation;  // 'allow' | 'tag' | 'challenge' | 'step_up' | 'rate_limit' | 'deny'
v.reasons;         // [{ code: 'marker.claude_active', weight: 6.2 }, …]

engine.score('checkout');   // re-score for a specific action
engine.stop();              // remove listeners and timers
```

The engine keeps observing input (pointer, keys, scroll, timing) and re-scores every 2 s. `onVerdict` fires only when
the class, recommendation, agent, stage or probability band changes.

Server-side helpers work without a DOM:

```ts
import { matchUserAgent, CATALOG } from '@doubleagent-so/core';

matchUserAgent('Mozilla/5.0 … ChatGPT-User/1.0; +https://openai.com/bot')?.entry.id; // 'openai.chatgpt-user'
```

## How it works

1. **Signals.** Probes in `src/env` (environment, automation artefacts, DOM markers and window globals left by agents)
   and `src/behavior` (input driving, rhythm, biometrics) emit `Signal`s. Each signal has a stable `code`, a `group`
   and a natural-log likelihood ratio (`llr`): positive is evidence for automation, negative is evidence for a human.
   Missing data emits nothing, because missing is not negative.
2. **Fusion** (`src/fusion.ts`). Per-profile priors plus the capped sum of each group's log-odds, then a softmax over
   human, bot and agent. Correlated signals share a group, and the group cap stops them double counting. Behavioural
   groups are scaled by how much interaction was observed. Hard evidence short-circuits to ≥ 0.99.
3. **Policy.** The class probability and the action (`login`, `checkout`, …) map to a recommendation using
   `DEFAULT_SIGNATURES.policies`.
4. **Catalog** (`src/catalog`). Every named bot and agent, with its User-Agent tokens, published IP lists, Web Bot
   Auth hosts and DOM fingerprints. Each entry cites its source.

Weights, priors, caps and marker rules live in one versioned object, `DEFAULT_SIGNATURES` (`src/signatures.ts`). Its
`version` goes out as `sigv` in `engine.payload()`, so a server can tell which model scored a session. Pass your own
`signatures` to `createEngine` to experiment.

`engine.payload()` returns a compact JSON summary (signals, features, stats, a short behaviour timeline). You can
send it to your own backend. Double Agent's cloud uses it to re-score sessions with server-side evidence, and never
trusts the client's verdict.

## Contributing

Improvements to detection are welcome: new agents in the catalog, new probes, better weights and fewer false
positives.

- **Test first.** Every signal needs a test showing when it fires and when it does not. Coverage stays at or above 90%
  for lines and branches.
- **False positives are the worst bug.** `test/false-positives.test.ts` must stay green. Add a case whenever you
  find a real browser that was misread.
- **Catalog entries** need a public source (the operator's own documentation) in `source`.
- **New signal codes** use the existing `group.name` form (`env.webgl_software`). A new code is ignored by Double
  Agent's cloud until it is added to the server's allow-list, so say so in the pull request.
- **Public API.** `test/public-api.test.ts` lists every export. Removing or renaming one is a breaking change.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow (`npm test`, `npm run bench`, `npm run size`). Report
evasion techniques privately ([SECURITY.md](SECURITY.md)) rather than in a public issue.

## License

MIT
