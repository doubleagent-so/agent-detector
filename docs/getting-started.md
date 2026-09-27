# Getting started

## Install

```sh
npm install @doubleagent-so/core
```

ES modules with TypeScript types. No dependencies. Works with any bundler, and in Node for the server-side helpers.

## In the page

```ts
import { createEngine } from '@doubleagent-so/core';

const engine = createEngine(window, { onVerdict: (v) => console.log(v.class) });
const verdict = await engine.ready;
```

`createEngine` starts collecting at once: synchronous probes run immediately, async probes (WebGL, workers, client
hints) resolve `engine.ready`, and input events keep refining the verdict. Create it as early as you can, once per
page.

| Option | Default | |
|---|---|---|
| `profile` | detected from the page | Site vertical: `saas`, `ecommerce`, `content`, `social`, `payments`, `fintech`, `ticketing`, `leadgen`, `gov`, `generic`. Changes priors and policies. |
| `onVerdict` | | Called when the class, recommendation, agent, stage or probability band changes. |
| `interval` | `2000` | Re-score interval in ms. |
| `sessionId` | random | Keep one id across pages (store it in `sessionStorage`). |
| `signatures` | `DEFAULT_SIGNATURES` | Your own weights and rules. See [Extending](extending.md#tune-the-weights). |
| `sitePrior` | profile prior | `{ bot, agent }` base rates learned for your site. |
| `attackMode` | `false` | Triples the prior odds while you are under attack. |
| `pciLite` | on for payment pages | Leaves the behaviour timeline out of the payload. |

## Read the verdict

```ts
verdict.class           // 'human' | 'bot' | 'agent'
verdict.probability     // { human, bot, agent }, sums to 1
verdict.confidence      // 0..1: how much evidence the verdict rests on
verdict.agent           // { family, id?, verified, method } for agents
verdict.recommendation  // 'allow' | 'tag' | 'challenge' | 'step_up' | 'rate_limit' | 'deny'
verdict.reasons         // top evidence: [{ code, weight, detail? }]
verdict.stage           // 'provisional' in the browser; 'final' once a judge signal (group J) is added
```

`probability` and `confidence` answer different questions. A two-second visit with no input is `human` with low
confidence: nothing was observed, so nothing was accused. Act on `recommendation`, which combines both with the
action's policy.

For a specific action, score it when it happens:

```ts
form.addEventListener('submit', () => {
  const v = engine.score('signup');
  if (v.recommendation === 'deny') showChallenge();
});
```

## Send it to your backend

The engine never makes a request. `engine.payload()` is a compact (~1–2 KB) JSON summary you can send anywhere:

```ts
addEventListener('pagehide', () => {
  navigator.sendBeacon('/collect', JSON.stringify(engine.payload()));
});
```

It holds the verdict, every signal (`c` code, `g` group, `l` llr), behaviour features and stats, a short timeline,
the environment, and `sigv` (the signatures version that scored it). **Do not trust the client's verdict for
security decisions**: anyone can edit it. Re-score on the server with evidence the client cannot forge (headers,
IP, signatures) using `fuse` and `engine.addSignals` (see [Extending](extending.md#add-server-evidence)).

## On the server

The catalog helpers need no DOM:

```ts
import { matchUserAgent, entryForSignatureAgent, ipListSources } from '@doubleagent-so/core';

matchUserAgent(req.headers['user-agent'])?.entry;   // longest matching token wins
entryForSignatureAgent('https://chatgpt.com');       // Web Bot Auth Signature-Agent origin
ipListSources();                                     // published IP lists to fetch and match
```

A declared User-Agent is a claim, not proof. Treat it as verified only when the IP list, reverse DNS or Web Bot
Auth signature confirms it.

## The drop-in script

If you want this without writing code, `@doubleagent-so/js` wraps the engine with session persistence, consent,
analytics and ads integrations, and a plugin system, served from `https://cdn.doubleagent.so/v1/doubleagent.js`. Add
`data-cloud="off"` to keep everything in the page. See [doubleagent.so/docs](https://doubleagent.so/docs/).
