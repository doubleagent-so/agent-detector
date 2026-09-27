import type { AgentFamily, Target } from '../types.ts';

/**
 * What a client is doing on the site. Mirrors Cloudflare BotBase behaviours (2026-07-01) so the
 * public report is comparable with Radar.
 */
export type Behaviour =
  | 'training' | 'search' | 'agent' | 'transact' | 'data_collection' | 'security_testing'
  | 'seo' | 'ads_verification' | 'link_preview' | 'feed_fetching' | 'monitoring';

/** How the client reaches the site. */
export type Surface =
  | 'crawler' | 'user_fetch' | 'cloud_browser_agent' | 'consumer_agent_browser'
  | 'agent_framework' | 'scraper_api' | 'automation_tool' | 'http_library';

/** Strongest identity proof the operator offers. `stealth` = none; only fingerprints or behaviour. */
export type Verifiable = 'signed' | 'ip' | 'rdns' | 'declared' | 'stealth';

/** Published IP list, refreshed into KV by the daily cron. `vendor` is the stable KV key. */
export interface IpList { vendor: string; url: string }

export interface CatalogMarker {
  /** CSS selector matched against the live DOM. */
  selector: string;
  code: string;
  llr?: number;
  target?: Target;
}

export interface CatalogGlobal {
  /** Regex source tested against own property names of window/document. */
  pattern: string;
  code: string;
  target?: Target;
}

export interface CatalogEntry {
  /** Stable id `<operator>.<product>`, e.g. `openai.gptbot`. */
  id: string;
  name: string;
  /** Operator slug, e.g. `openai`. */
  operator: string;
  class: 'bot' | 'agent';
  behaviour: Behaviour;
  surface: Surface;
  /** Intermediary: many end users drive it (Browserbase, Apify); Direct: one operator's own use. */
  operatorType: 'direct' | 'intermediary';
  verifiable: Verifiable;
  identify: {
    /** Regex sources matched case-insensitively against the User-Agent. */
    ua?: string[];
    ipLists?: IpList[];
    /** Forward-confirmed reverse DNS suffixes, e.g. `.googlebot.com`. */
    rdns?: string[];
    /** Web Bot Auth `Signature-Agent` hosts (suffix match). */
    signatureAgent?: string[];
    markers?: CatalogMarker[];
    globals?: CatalogGlobal[];
  };
  robotsToken?: string;
  respectsRobots?: boolean | 'unknown';
  docsUrl?: string;
  /** Citation for the entry. */
  source: string;
  /** Legacy coarse family (compat for one release). Derived from operator when omitted. */
  family?: AgentFamily;
}
