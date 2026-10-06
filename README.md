<p align="center">
  <img src="https://raw.githubusercontent.com/doubleagent-so/agent-detector/main/assets/doubleagent.svg" width="80" height="80" alt="Double Agent">
</p>

<h1 align="center">Agent Detector</h1>

<p align="center"><code>@doubleagent-so/agent-detector</code></p>

<p align="center">Classify a browser session as human, bot or AI agent, entirely inside the page.</p>

<p align="center">
  <strong><a href="https://doubleagent.so">Website</a></strong> ·
  <a href="https://doubleagent.so/docs/agent-detector/">Docs</a> ·
  <a href="https://www.npmjs.com/package/@doubleagent-so/agent-detector">npm</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/issues">Report an issue</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/LICENSE">MIT license</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@doubleagent-so/agent-detector"><img src="https://img.shields.io/npm/v/@doubleagent-so/agent-detector.svg" alt="npm"></a>
  <a href="https://github.com/doubleagent-so/agent-detector/actions/workflows/ci.yml"><img src="https://github.com/doubleagent-so/agent-detector/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/src/types.ts"><img src="https://img.shields.io/badge/types-included-3178c6.svg" alt="Types"></a>
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/package.json"><img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="Dependencies"></a>
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/scripts/size.mjs"><img src="https://img.shields.io/badge/engine-%E2%89%A416%20KB%20gzip-brightgreen.svg" alt="Size"></a>
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/docs/catalog.md"><img src="https://img.shields.io/badge/catalog-226%20bots%20%26%20agents-8a2be2.svg" alt="Catalog"></a>
</p>

The detection engine behind **[Double Agent](https://doubleagent.so)**. It classifies a browser session as **human**,
**bot** or **AI agent** (Claude in Chrome, ChatGPT Atlas, Comet, Browser Use, Playwright, headless Chrome…) entirely
inside the page. No dependencies, no network requests: you decide what to do with the verdict.

**[Docs](docs/README.md)** · **[Getting started](docs/getting-started.md)** · **[How it works](docs/how-it-works.md)** ·
**[API](docs/api.md)** · **[Extending](docs/extending.md)** · **[Signals](docs/signals.md)** · **[Catalog](docs/catalog.md)** ·
**[Contributing](CONTRIBUTING.md)**

Use it directly when you want the raw engine. For a drop-in script with analytics and ads integrations and plugins,
use [`@doubleagent-so/js`](https://doubleagent.so/docs/script-tag/).

## Install

```sh
npm install @doubleagent-so/agent-detector
```

## Quick start

```ts
import { createEngine } from '@doubleagent-so/agent-detector';

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
import { matchUserAgent, CATALOG } from '@doubleagent-so/agent-detector';

matchUserAgent('Mozilla/5.0 … ChatGPT-User/1.0; +https://openai.com/bot')?.entry.id; // 'openai.chatgpt-user'
```

## How it works

Probes and input events become **signals**, each a log-likelihood ratio in a capped **group**. **Fusion** adds them to
per-profile priors and softmaxes over human, bot and agent. A **policy** maps the result and the action to a
recommendation. Every weight lives in one versioned object, `DEFAULT_SIGNATURES`. Details:
[How it works](docs/how-it-works.md).

`engine.payload()` is a compact JSON summary you can send to your own backend. Re-score it there with evidence the
client cannot forge: [examples/server.ts](examples/server.ts).

## Try it

```sh
git clone https://github.com/doubleagent-so/agent-detector && cd agent-detector && npm ci
npm run example     # live verdict at http://127.0.0.1:8123 — try a real browser, a headless one and an agent
npm run bench       # confusion matrix on labelled synthetic sessions
```

## Contributing

Detection gets better with more eyes. Good places to start:

- **Report a misread session**: a real browser labelled automated, or an agent that passed as human.
  [Open a misclassification](https://github.com/doubleagent-so/agent-detector/issues/new?template=misclassification.yml).
- **Add an agent or bot** with its operator's documentation.
  [Request one](https://github.com/doubleagent-so/agent-detector/issues/new?template=new-agent.yml) or [add it yourself](docs/extending.md#add-an-agent-or-bot-to-the-catalog).
- **Harder test sessions.** The synthetic traces in `test/traces.ts` are easy today; realistic ones make `npm run bench` meaningful.
- Issues labelled [good first issue](https://github.com/doubleagent-so/agent-detector/labels/good%20first%20issue) and
  [help wanted](https://github.com/doubleagent-so/agent-detector/labels/help%20wanted).

Read [CONTRIBUTING.md](CONTRIBUTING.md) first: tests first, false positives are the worst bug, weights need evidence.
Report evasions privately ([SECURITY.md](SECURITY.md)), not in a public issue.

---

## Support

- Questions and bugs: [open an issue](https://github.com/doubleagent-so/agent-detector/issues/new/choose).
- Private account or billing questions: [support@doubleagent.so](mailto:support@doubleagent.so). Never post secret keys or session tokens in a public issue.
- Security problems: report them privately as described in [SECURITY.md](https://github.com/doubleagent-so/agent-detector/blob/main/SECURITY.md).

<p align="center">
  Maintained by <a href="https://doubleagent.so">Double Agent</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/CODE_OF_CONDUCT.md">Code of conduct</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/SECURITY.md">Security</a> ·
  <a href="https://github.com/doubleagent-so/agent-detector/blob/main/LICENSE">MIT license</a>
</p>
