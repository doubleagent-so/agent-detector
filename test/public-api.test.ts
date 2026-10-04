import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';

// The published surface of @doubleagent-so/agent-detector. Adding a name is a minor release; removing or
// renaming one is a breaking change (bump the major version and note it in the changelog).
const EXPORTS = [
  'BEHAVIOR_FAMILIES', 'CATALOG', 'DEFAULT_AGENT_POLICY', 'DEFAULT_SIGNATURES', 'FAMILIES_C2B', 'FINGERPRINTS','PAGE_TYPES', 'ROLES', 'SITE_KINDS', 'SOFT_SIGNAL_REVISIONS',
  'applyConduct', 'assessConduct', 'catalogEntry', 'catalogRoles', 'createEngine', 'detectPage', 'entryForSignatureAgent',
  'extractBehavior', 'familyOf', 'familyOfOperator', 'fingerprintRoles', 'fuse', 'globalRules', 'ipListSources', 'markerRules',
  'matchUserAgent', 'neutralBehavior', 'operatorForHost', 'parseAgentPolicy', 'recommend', 'resolveRoles', 'scanMarkers',
  'targetOf', 'timeline', 'validAction',
];

const sources = (dir: URL): URL[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return sources(new URL(`${e.name}/`, dir));
    return e.name.endsWith('.ts') ? [new URL(e.name, dir)] : [];
  });

describe('public API', () => {
  it('exports exactly the published names', () => {
    expect(Object.keys(core).sort()).toEqual(EXPORTS);
  });

  it('never touches the network: detection runs entirely in the page', () => {
    const offenders = sources(new URL('../src/', import.meta.url)).filter((u) =>
      /\b(fetch|sendBeacon|XMLHttpRequest|WebSocket|EventSource)\s*\(|new\s+(XMLHttpRequest|WebSocket|EventSource)\b/.test(readFileSync(u, 'utf8')));
    expect(offenders.map((u) => u.pathname.replace(/^.*\/src\//, ''))).toEqual([]);
  });
});
