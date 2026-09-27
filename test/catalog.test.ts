// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  CATALOG, catalogEntry, entryForSignatureAgent, familyOf, globalRules, ipListSources, markerRules, matchUserAgent, operatorForHost,
} from '../src/catalog/index.ts';
import { DEFAULT_SIGNATURES } from '../src/signatures.ts';

const UAS: [string, string][] = [
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot', 'openai.gptbot'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'openai.chatgpt-user'],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot', 'openai.oai-searchbot'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'anthropic.claudebot'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)', 'anthropic.claude-searchbot'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)', 'anthropic.claude-user'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)', 'perplexity.perplexity-user'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent) Chrome/140.0.0.0 Safari/537.36', 'google.google-agent'],
  ['Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'google.googlebot'],
  ['Googlebot-Image/1.0', 'google.googlebot'],
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36', 'microsoft.bingbot'],
  ['Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)', 'bytedance.bytespider'],
  ['meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/web-crawlers)', 'meta.externalagent'],
  ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'commoncrawl.ccbot'],
  ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'ahrefs.ahrefsbot'],
  ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'meta.facebookexternalhit'],
  ['WhatsApp/2.23.20.0 A', 'meta.whatsapp'],
  ['python-requests/2.32.3', 'python.requests'],
  ['curl/8.7.1', 'curl.curl'],
  ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36', 'chrome.headless'],
  ['Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Agent-NovaAct/0.9', 'amazon.nova-act'],
];

const HUMAN_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.0]',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0',
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 LinkedInApp/9.30',
];

describe('catalog', () => {
  it('has unique ids of the form operator.product, and every entry cites a source', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CATALOG) {
      expect(e.id, e.id).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
      expect(e.id.startsWith(`${e.operator}.`), e.id).toBe(true);
      expect(e.source.length, e.id).toBeGreaterThan(3);
      for (const src of e.identify.ua ?? []) expect(() => new RegExp(src), `${e.id}: ${src}`).not.toThrow();
    }
    expect(CATALOG.length).toBeGreaterThan(120);
  });

  it('matches known User-Agents to the right entry, longest token first', () => {
    for (const [ua, id] of UAS) expect(matchUserAgent(ua)?.entry.id, ua).toBe(id);
  });

  it('never matches ordinary browsers or in-app browsers', () => {
    for (const ua of HUMAN_UAS) expect(matchUserAgent(ua), ua).toBeUndefined();
    expect(matchUserAgent('')).toBeUndefined();
    expect(matchUserAgent(undefined)).toBeUndefined();
    // Tokens need boundaries: "libcurl/8" and "NotGPTBot" are not the named clients.
    expect(matchUserAgent('libcurl/8.1')).toBeUndefined();
    expect(matchUserAgent('NotGPTBot/1.0')).toBeUndefined();
  });

  it('resolves Web Bot Auth origins, preferring the entry whose UA also matches', () => {
    expect(entryForSignatureAgent('https://chatgpt.com')?.id).toBe('openai.chatgpt-agent');
    expect(entryForSignatureAgent('https://agent.bot.goog')?.id).toBe('google.google-agent');
    expect(entryForSignatureAgent('https://xhah6q48pbxb4.keydirectory.signer.us-east-1.on.aws')?.id).toBe('amazon.agentcore-browser');
    expect(entryForSignatureAgent('https://evil.lambda-url.us-east-1.on.aws')).toBeUndefined();
    expect(entryForSignatureAgent('https://www.meta.com', 'meta-externalfetcher/1.1')?.id).toBe('meta.externalfetcher');
    expect(entryForSignatureAgent('https://www.meta.com', 'meta-externalagent/1.1')?.id).toBe('meta.externalagent');
    expect(entryForSignatureAgent('not a url')).toBeUndefined();
    expect(operatorForHost('operator.chatgpt.com')).toBe('openai');
    expect(operatorForHost('example.com')).toBeUndefined();
  });

  it('keeps the IP-list vendor keys already stored in KV, and one URL per vendor', () => {
    const src = ipListSources();
    const vendors = src.map((s) => s.vendor);
    expect(new Set(vendors).size).toBe(vendors.length);
    expect(vendors).toEqual(expect.arrayContaining(['openai_chatgpt_user', 'openai_searchbot', 'openai_gptbot', 'anthropic', 'perplexity_user', 'perplexity_bot', 'google_user_triggered']));
    for (const s of src) expect(s.url, s.vendor).toMatch(/^https:\/\//);
    expect(src.find((s) => s.vendor === 'anthropic')!.entries.map((e) => e.id)).toEqual(expect.arrayContaining(['anthropic.claudebot', 'anthropic.claude-user']));
  });

  it('derives the signature bundle markers and globals, each tagged with its entry', () => {
    expect(DEFAULT_SIGNATURES.markers).toEqual(markerRules());
    expect(DEFAULT_SIGNATURES.globals).toEqual(globalRules());
    const codes = DEFAULT_SIGNATURES.markers.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['marker.claude_active', 'marker.claude_residue', 'marker.comet', 'marker.browser_use', 'marker.skyvern', 'marker.skyvern_ids']));
    for (const m of DEFAULT_SIGNATURES.markers) {
      expect(catalogEntry(m.agentId), m.code).toBeDefined();
      expect(() => document.querySelector(m.selector), m.selector).not.toThrow();
    }
    for (const g of DEFAULT_SIGNATURES.globals) expect(() => new RegExp(g.pattern), g.code).not.toThrow();
    expect(DEFAULT_SIGNATURES.markers.find((m) => m.code === 'marker.claude_residue')).toMatchObject({ llr: 4, family: 'claude', agentId: 'anthropic.claude-in-chrome' });
  });

  it('maps entries to legacy families', () => {
    expect(familyOf(catalogEntry('anthropic.claudebot'))).toBe('claude');
    expect(familyOf(catalogEntry('browser-use.agent'))).toBe('browser_use');
    expect(familyOf(catalogEntry('microsoft.bingbot'))).toBe('unknown');
    expect(familyOf(undefined)).toBe('unknown');
  });
});
