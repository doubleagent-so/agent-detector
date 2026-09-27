// Re-score a browser payload on your server with evidence the client cannot forge.
// Works in any runtime with the Fetch API (Node, Deno, Bun, Workers). See docs/extending.md#add-server-evidence.
import { DEFAULT_SIGNATURES, fuse, matchUserAgent, type BeaconPayload, type Signal, type Verdict } from '../src/index.ts';

export async function rescore(request: Request): Promise<Verdict> {
  const payload = (await request.json()) as BeaconPayload;
  // Client evidence is a claim: drop the groups only a server may add.
  const client = payload.signals
    .filter((s) => s.g !== 'H' && s.g !== 'J' && !s.c.startsWith('verified.'))
    .map((s): Signal => ({ code: s.c, group: s.g as Signal['group'], target: s.t as Signal['target'], llr: s.l, hard: s.h === 1 }));

  const server: Signal[] = [];
  const declared = matchUserAgent(request.headers.get('user-agent'));
  if (declared) server.push({ code: 'hdr.declared_ua', group: 'H', target: declared.entry.class, llr: 3, agentId: declared.entry.id });

  return fuse({
    signals: [...client, ...server],
    profile: payload.page.profile, action: payload.page.action, sig: DEFAULT_SIGNATURES,
    behaviorReliability: payload.stats.reliability, driveReliability: payload.stats.driveReliability,
    sessionId: payload.sid, stage: 'provisional',
  });
}
