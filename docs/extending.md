# Extending

Ways to make the engine better, from easiest to hardest. Each one starts with a failing test
([CONTRIBUTING](../CONTRIBUTING.md)).

## Add an agent or bot to the catalog

Entries live in [src/catalog/entries.ts](../src/catalog/entries.ts). A crawler that only declares a User-Agent is one
line:

```ts
declared('example.examplebot', 'ExampleBot', 'example', ['ExampleBot']),
```

Richer entries set the full `CatalogEntry`: `class` (`bot` or `agent`), `behaviour`, `surface`, `verifiable`, and
`identify` with any of `ua`, `ipLists`, `rdns` and `signatureAgent`. `source` must be the operator's own
documentation.

Then add the User-Agent to the table in [test/catalog.test.ts](../test/catalog.test.ts) and run `npm run docs` to
refresh [the catalog page](catalog.md).

Keep UA patterns specific: they are matched on token boundaries, but a generic word ("Code", "Operator") will still
catch real apps.

## Add an in-page fingerprint

Agents that drive a real browser often leave DOM overlays or window globals. Add them to
[src/catalog/fingerprinted.ts](../src/catalog/fingerprinted.ts):

```ts
{
  id: 'example.agent', class: 'agent',
  markers: [{ selector: '#example-agent-overlay', code: 'marker.example' }],   // llr 9, hard, by default
  globals: [{ pattern: '^__exampleAgent$', code: 'global.example' }],
},
```

and a matching entry in `entries.ts` wrapped in `withFp(...)`. Markers are checked by a `MutationObserver`, globals
by periodic rescans. Only these fingerprints ship in the browser bundle, so keep them small.

- A marker that stays after the agent stops (a leftover `<style>`) is residue: give it a lower `llr` (for example
  `4`) so it is evidence, not proof.
- A selector must never match a page's own markup. Prefer ids and attributes the agent namespaces.

## Add a probe

Environment probes live in [src/env/probes.ts](../src/env/probes.ts); behaviour features in
[src/behavior/features.ts](../src/behavior/features.ts). A probe pushes a `Signal`:

```ts
if (looksAutomated) {
  out.push({ code: 'env.example_tell', group: 'E', target: 'bot', llr: 1.5, detail: 'what was seen' });
}
```

- Choose the group by what the evidence is correlated with ([groups](how-it-works.md#groups)). Correlated tells
  share a cap, so a new WebGL tell in `E` cannot outweigh everything else.
- Start the `llr` low. `ln(3) ≈ 1.1` means "three times likelier from automation". Higher needs evidence.
- Use a negative `llr` only for things automation cannot easily fake (coalesced pointer samples, real approach
  paths).
- If the probe cannot run, emit nothing. Never emit a human signal because something was missing.

Test both sides, the way [test/probes.test.ts](../test/probes.test.ts) does with its `fakeWin()` helper: one case where
it fires, and a real-browser case (Chrome, Safari, Firefox, a privacy browser) where it does not. Add the real-browser
case to [test/false-positives.test.ts](../test/false-positives.test.ts) too.

A new code is ignored by Double Agent's hosted cloud until its server allow-list learns it, so mention new codes in
the pull request.

## Add server evidence

A server sees what the browser cannot: request headers, TLS, IP reputation, Web Bot Auth signatures. Turn it into
group `H` signals and re-score with `fuse`. [examples/server.ts](../examples/server.ts) is a complete, typechecked
version:

```ts
const server: Signal[] = [];
const declared = matchUserAgent(request.headers.get('user-agent'));
if (declared) server.push({ code: 'hdr.declared_ua', group: 'H', target: declared.entry.class, llr: 3, agentId: declared.entry.id });

const verdict = fuse({ signals: [...client, ...server], profile, action, sig: DEFAULT_SIGNATURES, /* reliabilities, sessionId */ });
```

Never accept `H`, `J` or `verified.*` signals from the client: anyone can send them. Cap client `llr`s to the
weights you expect for each code, and drop codes you do not know.

## Tune the weights

Everything numeric is in one object. Pass a modified copy to experiment without forking:

```ts
import { createEngine, DEFAULT_SIGNATURES } from '@doubleagent-so/agent-detector';

createEngine(window, {
  signatures: { ...DEFAULT_SIGNATURES, version: 'my-2026.10', groupCaps: { ...DEFAULT_SIGNATURES.groupCaps, E: 3 } },
  sitePrior: { bot: 0.3, agent: 0.05 },   // your site's measured base rates
});
```

To change the defaults for everyone, open a pull request with `npm run bench` before and after, and bump
`DEFAULT_SIGNATURES.version`.

## Use it from the drop-in script

`@doubleagent-so/js` runs this engine and adds plugins: small objects that receive each verdict and the session
payload. That is the place to send verdicts to a new analytics tool or your own backend. See
[doubleagent.so/docs/plugins](https://doubleagent.so/docs/plugins/).
