import type { Target } from '../types.ts';
import type { RoleCatalog } from '../attribution.ts';
import { CATALOG } from './entries.ts';
import { familyOf, operatorForHost } from './family.ts';
import type { CatalogEntry, IpList, Surface } from './types.ts';

export * from './types.ts';
export { CATALOG };
export { familyOf, familyOfOperator, operatorForHost } from './family.ts';
export { fingerprintRoles, globalRules, markerRules } from './rules.ts';
export { FINGERPRINTS, type Fingerprint } from './fingerprinted.ts';

const byId = new Map(CATALOG.map((e) => [e.id, e]));

export const catalogEntry = (id: string | undefined): CatalogEntry | undefined => (id ? byId.get(id) : undefined);

/** Signal target for an entry: user-triggered and browser agents are `agent`, everything else `bot`. */
export const targetOf = (e: CatalogEntry): Target => e.class;

// Token boundaries: a UA token must not be glued to letters, digits or '-' on either side.
const compiled = CATALOG.flatMap((entry) =>
  (entry.identify.ua ?? []).map((src) => ({ entry, re: new RegExp(`(?:^|[^A-Za-z0-9-])(${src})(?=$|[^A-Za-z0-9-])`, 'i') })),
);

export interface UaMatch { entry: CatalogEntry; token: string }

/** Best catalog match for a User-Agent: the longest matching token wins ("Claude-SearchBot" over "ClaudeBot"). */
export function matchUserAgent(ua: string | null | undefined): UaMatch | undefined {
  if (!ua) return undefined;
  let best: UaMatch | undefined;
  for (const { entry, re } of compiled) {
    const m = re.exec(ua);
    if (m && (!best || m[1].length > best.token.length)) best = { entry, token: m[1] };
  }
  return best;
}

const hostMatches = (host: string, suffix: string): boolean => host === suffix || host.endsWith(`.${suffix}`);

/**
 * Catalog entry for a Web Bot Auth `Signature-Agent` origin. When several entries share a
 * directory host (Meta's crawler and fetcher), the one whose UA also matches wins.
 */
export function entryForSignatureAgent(origin: string, ua?: string | null, strict = false): CatalogEntry | undefined {
  let host: string;
  try { host = new URL(origin).hostname.toLowerCase(); } catch { return undefined; }
  const hits = CATALOG.filter((e) => e.identify.signatureAgent?.some((s) => hostMatches(host, s)));
  if (hits.length <= 1) return hits[0];
  const byUa = matchUserAgent(ua)?.entry;
  return hits.find((e) => e === byUa) ?? (strict ? undefined : hits[0]);
}

export interface IpListSource extends IpList { entries: CatalogEntry[] }

/** Published IP lists, one per vendor key, with every entry that shares the list. */
export function ipListSources(): IpListSource[] {
  const out = new Map<string, IpListSource>();
  for (const entry of CATALOG) {
    for (const l of entry.identify.ipLists ?? []) {
      const cur = out.get(l.vendor);
      if (cur) cur.entries.push(entry);
      else out.set(l.vendor, { ...l, entries: [entry] });
    }
  }
  return [...out.values()];
}

const CONTROLLER_SURFACES: ReadonlySet<Surface> = new Set<Surface>(['automation_tool', 'http_library']);
/** The operator of each published IP list; a list shared across operators would name none. */
const listOperators = new Map(ipListSources().flatMap((list) => {
  const operators = new Set(list.entries.map((e) => e.operator));
  return operators.size === 1 ? [[list.vendor, list.entries[0].operator] as const] : [];
}));

/** Attribution catalog for servers: every entry, every published IP list, every known signer domain. */
export const catalogRoles: RoleCatalog = {
  entry: (id) => {
    const e = byId.get(id);
    return e && { id: e.id, operator: e.operator, family: familyOf(e), controller: CONTROLLER_SURFACES.has(e.surface) };
  },
  ipListOperator: (vendor) => listOperators.get(vendor),
  hostOperator: operatorForHost,
};

