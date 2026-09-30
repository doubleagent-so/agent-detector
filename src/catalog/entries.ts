import { FINGERPRINTS } from './fingerprinted.ts';
import type { CatalogEntry } from './types.ts';

/**
 * The Double Agent catalog: every named bot and agent we can identify. Curated by hand from
 * operator documentation (each entry cites it in `source`). Feeds:
 * UA tokens (API + edge), published IP lists (cron), Web Bot Auth hosts, DOM markers and window
 * globals (SDK), portal names and the public directory. Never auto-generated: accuracy is the product.
 *
 * UA patterns are regex sources matched case-insensitively with non-token boundaries on both
 * sides (see `matchUserAgent`). Avoid generic words ("Code", "Operator") that real browsers or apps send.
 */

const OAI = 'https://developers.openai.com/api/docs/bots';
const ANT = 'https://support.claude.com/en/articles/8896518';
const PPLX = 'https://docs.perplexity.ai/guides/bots';
const GOOG_COMMON = 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers';
const GOOG_USER = 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers';
const GOOG_SPECIAL = 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-special-case-crawlers';
const GIP = 'https://developers.google.com/static/crawling/ipranges';
const META = 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers';
const AMZ = 'https://developer.amazon.com/amazonbot';
const MISTRAL = 'https://docs.mistral.ai/robots';
const AIROBOTS = 'https://github.com/ai-robots-txt/ai.robots.txt';
const CUA = 'https://github.com/monperrus/crawler-user-agents';
const RADAR = 'https://radar.cloudflare.com/bots/directory';
const WBA_REGISTRY = 'https://assets.radar.cloudflare.com/bots/signature-agent-registry.txt';

const ANTHROPIC_IPS = [{ vendor: 'anthropic', url: 'https://claude.com/crawling/bots.json' }];
const GOOGLE_RDNS = ['.googlebot.com', '.google.com', '.googleusercontent.com'];
const GOOGLE_COMMON_IPS = [{ vendor: 'google_common', url: `${GIP}/common-crawlers.json` }];
const GOOGLE_FETCHER_IPS = [
  { vendor: 'google_user_fetchers', url: `${GIP}/user-triggered-fetchers.json` },
  { vendor: 'google_user_fetchers_google', url: `${GIP}/user-triggered-fetchers-google.json` },
];

type Entry = CatalogEntry;
/** Declared-only entry from the ai.robots.txt / crawler-user-agents lists. */
const declared = (id: string, name: string, operator: string, ua: string[], overrides: Partial<Entry> = {}): Entry => ({
  id, name, operator, class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct',
  verifiable: 'declared', identify: { ua }, respectsRobots: 'unknown', source: AIROBOTS, ...overrides,
});

// ── Entries with DOM / JS fingerprints (the fingerprints live in fingerprinted.ts) ──────────
const withFp = (entry: Entry): Entry => {
  const fingerprint = FINGERPRINTS.find((x) => x.id === entry.id);
  return { ...entry, identify: { ...entry.identify, ...(fingerprint?.markers ? { markers: fingerprint.markers } : {}), ...(fingerprint?.globals ? { globals: fingerprint.globals } : {}) } };
};
const automation = (id: string, name: string, operator: string, source: string, ua?: string[]): Entry => withFp({
  id, name, operator, class: 'bot', behaviour: 'data_collection', surface: 'automation_tool', operatorType: 'intermediary',
  verifiable: ua ? 'declared' : 'stealth', identify: ua ? { ua } : {}, respectsRobots: 'unknown', source,
});
const fingerprinted: Entry[] = [
  withFp({
    id: 'anthropic.claude-in-chrome', name: 'Claude in Chrome', operator: 'anthropic', class: 'agent', behaviour: 'agent',
    surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', family: 'claude', identify: {},
    docsUrl: 'https://support.claude.com/en/articles/12012173', source: 'Claude in Chrome extension v1.0.94 (fcoeoabgfenejglbffodgkkbkcdhcgfn)',
  }),
  withFp({
    id: 'perplexity.comet', name: 'Comet', operator: 'perplexity', class: 'agent', behaviour: 'agent', surface: 'consumer_agent_browser',
    operatorType: 'intermediary', verifiable: 'stealth', family: 'perplexity', identify: {}, source: 'https://aiagentindex.mit.edu/2025/comet',
  }),
  withFp({
    id: 'fellou.browser', name: 'Fellou', operator: 'fellou', class: 'agent', behaviour: 'agent', surface: 'consumer_agent_browser',
    operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'https://github.com/FellouAI/eko (use in the product unverified)',
  }),
  withFp({
    id: 'browser-use.agent', name: 'Browser Use', operator: 'browser-use', class: 'agent', behaviour: 'agent', surface: 'agent_framework',
    operatorType: 'intermediary', verifiable: 'stealth', family: 'browser_use', identify: { ua: ['browser-use'], signatureAgent: ['browser-use.com'] },
    source: 'https://github.com/browser-use/browser-use',
  }),
  withFp({
    id: 'browserbase.stagehand', name: 'Browserbase / Stagehand', operator: 'browserbase', class: 'agent', behaviour: 'agent', surface: 'agent_framework',
    operatorType: 'intermediary', verifiable: 'signed', family: 'browserbase', identify: { ua: ['Browserbase'], signatureAgent: ['browserbase.com'] },
    docsUrl: 'https://docs.browserbase.com/platform/identity', source: 'https://github.com/browserbase/stagehand',
  }),
  withFp({
    id: 'skyvern.agent', name: 'Skyvern', operator: 'skyvern', class: 'agent', behaviour: 'agent', surface: 'agent_framework',
    operatorType: 'intermediary', verifiable: 'stealth', family: 'skyvern', identify: { ua: ['Skyvern'], signatureAgent: ['skyvern.com'] },
    source: 'https://github.com/Skyvern-AI/skyvern',
  }),
  automation('selenium.webdriver', 'Selenium / WebDriver', 'selenium', 'https://www.selenium.dev'),
  automation('playwright.automation', 'Playwright', 'playwright', 'https://playwright.dev'),
  automation('puppeteer.headless', 'Puppeteer', 'puppeteer', 'https://pptr.dev'),
  automation('legacy.headless', 'PhantomJS / Nightmare', 'legacy', CUA, ['PhantomJS']),
];

// ── AI agents (browser-driving and cloud) ─────────────────────────────────────────────────────
const agents: Entry[] = [
  {
    id: 'openai.chatgpt-agent', name: 'ChatGPT agent', operator: 'openai', class: 'agent', behaviour: 'agent',
    surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'signed', family: 'openai',
    identify: { ua: ['ChatGPT Agent'], signatureAgent: ['chatgpt.com'], ipLists: [{ vendor: 'openai_agents', url: 'https://openai.com/chatgpt-agents.json' }] },
    docsUrl: 'https://help.openai.com/en/articles/11845367', source: 'https://help.openai.com/en/articles/11845367',
  },
  {
    id: 'openai.atlas', name: 'ChatGPT Atlas', operator: 'openai', class: 'agent', behaviour: 'agent',
    surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', family: 'openai',
    identify: {}, docsUrl: 'https://help.openai.com/en/articles/12628199', source: 'https://help.openai.com/en/articles/12628199',
  },
  {
    id: 'google.gemini-in-chrome', name: 'Gemini in Chrome', operator: 'google', class: 'agent', behaviour: 'agent',
    surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', family: 'google', identify: {}, source: 'press (unverified fingerprints)',
  },
  {
    id: 'microsoft.copilot-actions', name: 'Copilot Actions in Edge', operator: 'microsoft', class: 'agent', behaviour: 'agent',
    surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'https://www.humansecurity.com/ai-agent/copilot-actions',
  },
  { id: 'opera.neon', name: 'Opera Neon', operator: 'opera', class: 'agent', behaviour: 'agent', surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'MIT AI Agent Index' },
  { id: 'browsercompany.dia', name: 'Dia', operator: 'browsercompany', class: 'agent', behaviour: 'agent', surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'press (unverified fingerprints)' },
  { id: 'genspark.browser', name: 'Genspark Browser', operator: 'genspark', class: 'agent', behaviour: 'agent', surface: 'consumer_agent_browser', operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'press (unverified fingerprints)' },
  {
    id: 'manus.agent', name: 'Manus', operator: 'manus', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent',
    operatorType: 'intermediary', verifiable: 'signed', family: 'manus', identify: { ua: ['Manus-User'], signatureAgent: ['manus.im', 'manus.ai'] }, source: WBA_REGISTRY,
  },
  {
    id: 'amazon.nova-act', name: 'Amazon Nova Act', operator: 'amazon', class: 'agent', behaviour: 'agent', surface: 'agent_framework',
    operatorType: 'intermediary', verifiable: 'declared', family: 'amazon', identify: { ua: ['Agent-NovaAct', 'NovaAct'] }, source: 'https://github.com/aws/nova-act',
  },
  {
    id: 'amazon.agentcore-browser', name: 'Bedrock AgentCore Browser', operator: 'amazon', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent',
    operatorType: 'intermediary', verifiable: 'signed', family: 'amazon', identify: {
      signatureAgent: [
        'xhah6q48pbxb4.keydirectory.signer.us-east-1.on.aws', 'ogtj5xdh5udp4.keydirectory.signer.us-east-2.on.aws',
        'bxtrz00tv0lm1.keydirectory.signer.us-west-2.on.aws', 'c3drvlj8gw240.keydirectory.signer.eu-west-1.on.aws',
        'o42g509c7dlj6.keydirectory.signer.eu-central-1.on.aws', 'kzejmtkesloc1.keydirectory.signer.ap-northeast-1.on.aws',
        'wdfzm130yrb91.keydirectory.signer.ap-south-1.on.aws', 'slf696jfe4gp0.keydirectory.signer.ap-southeast-1.on.aws',
        'meh0x7tptr6o1.keydirectory.signer.ap-southeast-2.on.aws',
      ],
    },
    source: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-web-bot-auth.html',
  },
  { id: 'agi.agent', name: 'AGI Agent', operator: 'agi', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'signed', identify: { signatureAgent: ['agi.tech'] }, source: RADAR },
  { id: 'anchor.browser', name: 'Anchor Browser', operator: 'anchor', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'signed', identify: { ua: ['Anchor Browser'], signatureAgent: ['anchorbrowser.io'] }, source: 'https://docs.anchorbrowser.io' },
  { id: 'kernel.browser', name: 'Kernel', operator: 'kernel', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'signed', identify: { signatureAgent: ['kernel.sh'] }, source: 'https://www.kernel.sh/docs' },
  { id: 'hyperbrowser.browser', name: 'Hyperbrowser', operator: 'hyperbrowser', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'https://docs.hyperbrowser.ai' },
  { id: 'steel.browser', name: 'Steel', operator: 'steel', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'stealth', identify: {}, source: 'https://docs.steel.dev' },
  {
    id: 'cloudflare.browser-run', name: 'Cloudflare Browser Run', operator: 'cloudflare', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent',
    operatorType: 'intermediary', verifiable: 'signed', identify: { ua: ['CloudflareBrowserRenderingCrawler'], signatureAgent: ['cloudflare-browser-rendering-085.workers.dev'] },
    source: 'https://developers.cloudflare.com/browser-run/',
  },
  { id: 'block.goose', name: 'Goose', operator: 'block', class: 'agent', behaviour: 'agent', surface: 'agent_framework', operatorType: 'intermediary', verifiable: 'signed', identify: {}, source: 'https://blog.cloudflare.com/signed-agents/' },
  ...[
    ['twin.agent', 'Twin', 'twin', 'twin.so', 'TwinAgent'], ['rye.agent', 'Rye', 'rye', 'rye.xyz'], ['stripe.link-cli', 'Stripe Link', 'stripe', 'api.link.com'],
    ['strivve.agent', 'Strivve', 'strivve', 'cardsavr.io'],
    // In Cloudflare's signed-agent registry; directory hosts not yet confirmed, so no automatic match.
    ['henry.agent', 'Henry', 'henry', ''], ['nekuda.agent', 'Nekuda', 'nekuda', ''], ['firmly.agent', 'Firmly', 'firmly', ''],
  ].map(([id, name, operator, host, ua]): Entry => ({
    id, name, operator, class: 'agent', behaviour: 'transact', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'signed',
    identify: { ...(host ? { signatureAgent: [host] } : {}), ...(ua ? { ua: [ua] } : {}) }, source: WBA_REGISTRY,
  })),
];

// ── AI assistants fetching for a user, and AI search indexes ─────────────────────────────────
const aiFetch: Entry[] = [
  { id: 'openai.chatgpt-user', name: 'ChatGPT-User', operator: 'openai', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', family: 'openai', identify: { ua: ['ChatGPT-User'], ipLists: [{ vendor: 'openai_chatgpt_user', url: 'https://openai.com/chatgpt-user.json' }] }, robotsToken: 'ChatGPT-User', respectsRobots: false, docsUrl: OAI, source: OAI },
  { id: 'openai.connectors', name: 'ChatGPT connectors', operator: 'openai', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', family: 'openai', identify: { ipLists: [{ vendor: 'openai_connectors', url: 'https://openai.com/chatgpt-connectors.json' }] }, source: 'https://developers.openai.com/api/docs/ip-addresses' },
  { id: 'openai.oai-searchbot', name: 'OAI-SearchBot', operator: 'openai', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'openai', identify: { ua: ['OAI-SearchBot'], ipLists: [{ vendor: 'openai_searchbot', url: 'https://openai.com/searchbot.json' }] }, robotsToken: 'OAI-SearchBot', respectsRobots: true, docsUrl: OAI, source: OAI },
  { id: 'openai.adsbot', name: 'OAI-AdsBot', operator: 'openai', class: 'bot', behaviour: 'ads_verification', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'openai', identify: { ua: ['OAI-AdsBot'], ipLists: [{ vendor: 'openai_adsbot', url: 'https://openai.com/adsbot.json' }] }, docsUrl: OAI, source: OAI },
  { id: 'anthropic.claude-user', name: 'Claude-User', operator: 'anthropic', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', family: 'claude', identify: { ua: ['Claude-User'], ipLists: ANTHROPIC_IPS }, robotsToken: 'Claude-User', respectsRobots: true, docsUrl: ANT, source: ANT },
  { id: 'anthropic.claude-searchbot', name: 'Claude-SearchBot', operator: 'anthropic', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'claude', identify: { ua: ['Claude-SearchBot'], ipLists: ANTHROPIC_IPS }, robotsToken: 'Claude-SearchBot', respectsRobots: true, docsUrl: ANT, source: ANT },
  { id: 'perplexity.perplexity-user', name: 'Perplexity-User', operator: 'perplexity', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', family: 'perplexity', identify: { ua: ['Perplexity-User'], ipLists: [{ vendor: 'perplexity_user', url: 'https://www.perplexity.com/perplexity-user.json' }] }, robotsToken: 'Perplexity-User', respectsRobots: false, docsUrl: PPLX, source: PPLX },
  { id: 'perplexity.perplexitybot', name: 'PerplexityBot', operator: 'perplexity', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'perplexity', identify: { ua: ['PerplexityBot'], ipLists: [{ vendor: 'perplexity_bot', url: 'https://www.perplexity.com/perplexitybot.json' }] }, robotsToken: 'PerplexityBot', respectsRobots: true, docsUrl: PPLX, source: PPLX },
  { id: 'google.google-agent', name: 'Google-Agent', operator: 'google', class: 'agent', behaviour: 'agent', surface: 'cloud_browser_agent', operatorType: 'intermediary', verifiable: 'signed', family: 'google', identify: { ua: ['Google-Agent'], signatureAgent: ['agent.bot.goog'], ipLists: [{ vendor: 'google_user_triggered', url: `${GIP}/user-triggered-agents.json` }], rdns: GOOGLE_RDNS }, respectsRobots: false, docsUrl: GOOG_USER, source: GOOG_USER },
  { id: 'google.gemini-notebook', name: 'Google-GeminiNotebook', operator: 'google', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', family: 'google', identify: { ua: ['Google-GeminiNotebook', 'Google-NotebookLM', 'NotebookLM'], ipLists: GOOGLE_FETCHER_IPS, rdns: GOOGLE_RDNS }, respectsRobots: false, docsUrl: GOOG_USER, source: GOOG_USER },
  { id: 'google.gemini-deep-research', name: 'Gemini Deep Research', operator: 'google', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', family: 'google', identify: { ua: ['Gemini-Deep-Research', 'GoogleAgent-URLContext', 'GoogleAgent-Mariner', 'Google-Firebase'] }, source: AIROBOTS },
  { id: 'google.user-fetchers', name: 'Google user-triggered fetchers', operator: 'google', class: 'bot', behaviour: 'feed_fetching', surface: 'user_fetch', operatorType: 'direct', verifiable: 'ip', family: 'google', identify: { ua: ['Google-Read-Aloud', 'Google Read Aloud', 'Google-Pinpoint', 'FeedFetcher-Google', 'GoogleProducer', 'Google-Site-Verification', 'Google-CWS', 'GoogleMessages'], ipLists: GOOGLE_FETCHER_IPS, rdns: GOOGLE_RDNS }, respectsRobots: false, docsUrl: GOOG_USER, source: GOOG_USER },
  { id: 'meta.externalfetcher', name: 'Meta-ExternalFetcher', operator: 'meta', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'signed', identify: { ua: ['meta-externalfetcher'], signatureAgent: ['www.meta.com'] }, respectsRobots: false, docsUrl: META, source: META },
  { id: 'meta.webindexer', name: 'Meta-WebIndexer', operator: 'meta', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'declared', identify: { ua: ['meta-webindexer'] }, respectsRobots: true, docsUrl: META, source: META },
  { id: 'mistral.user', name: 'MistralAI-User', operator: 'mistral', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', identify: { ua: ['MistralAI-User'], ipLists: [{ vendor: 'mistral_user', url: 'https://mistral.ai/mistralai-user-ips.json' }] }, respectsRobots: true, docsUrl: MISTRAL, source: MISTRAL },
  { id: 'mistral.index', name: 'MistralAI-Index', operator: 'mistral', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', identify: { ua: ['MistralAI-Index'], ipLists: [{ vendor: 'mistral_index', url: 'https://mistral.ai/mistralai-index-ips.json' }] }, respectsRobots: true, docsUrl: MISTRAL, source: MISTRAL },
  { id: 'duckduckgo.duckassistbot', name: 'DuckAssistBot', operator: 'duckduckgo', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'signed', identify: { ua: ['DuckAssistBot'], signatureAgent: ['assistbot.duckduckgo.com'], ipLists: [{ vendor: 'duckassistbot', url: 'https://duckduckgo.com/duckassistbot.json' }] }, respectsRobots: true, source: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot' },
  { id: 'amazon.amzn-user', name: 'Amzn-User', operator: 'amazon', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', family: 'amazon', identify: { ua: ['Amzn-User', 'AmazonBuyForMe'] }, respectsRobots: false, docsUrl: AMZ, source: AMZ },
  { id: 'amazon.amzn-searchbot', name: 'Amzn-SearchBot', operator: 'amazon', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'declared', family: 'amazon', identify: { ua: ['Amzn-SearchBot'] }, respectsRobots: true, docsUrl: AMZ, source: AMZ },
  { id: 'you.youbot', name: 'YouBot', operator: 'you', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'signed', identify: { ua: ['YouBot'], signatureAgent: ['you.com'] }, respectsRobots: true, source: RADAR },
  { id: 'exa.searchbot', name: 'ExaSearchBot', operator: 'exa', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'intermediary', verifiable: 'signed', identify: { ua: ['ExaSearchBot', 'ExaBot'], signatureAgent: ['crawler.exa.ai'] }, respectsRobots: true, source: 'https://crawler.exa.ai' },
  { id: 'parallel.shapbot', name: 'ShapBot', operator: 'parallel', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'intermediary', verifiable: 'ip', identify: { ua: ['ShapBot', 'Shap-User'], ipLists: [{ vendor: 'parallel_shapbot', url: 'https://docs.parallel.ai/resources/shapbot.json' }] }, respectsRobots: true, source: 'https://docs.parallel.ai' },
  { id: 'linkup.linkupbot', name: 'LinkupBot', operator: 'linkup', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'intermediary', verifiable: 'ip', identify: { ua: ['LinkupBot'], ipLists: [{ vendor: 'linkup', url: 'https://linkup.so/linkupbot-ips.txt' }] }, respectsRobots: true, source: 'https://linkup.so/bot' },
  { id: 'phind.phindbot', name: 'PhindBot', operator: 'phind', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', identify: { ua: ['PhindBot'] }, source: CUA },
  { id: 'moonshot.kimi-user', name: 'Kimi-User', operator: 'moonshot', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', identify: { ua: ['Kimi-User', 'Kimi-SearchBot'] }, source: AIROBOTS },
  { id: 'kagi.fetcher', name: 'Kagi fetcher', operator: 'kagi', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', identify: { ua: ['kagi-fetcher'] }, source: AIROBOTS },
  { id: 'cursor.agent', name: 'Cursor', operator: 'cursor', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'signed', identify: { signatureAgent: ['cursorusercontent.com'] }, source: WBA_REGISTRY },
  { id: 'anthropic.claude-code', name: 'Claude Code', operator: 'anthropic', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'ip', family: 'claude', identify: { ua: ['claude-code', 'Claude-Code'], ipLists: ANTHROPIC_IPS }, source: CUA },
  { id: 'google.gemini-cli', name: 'Gemini CLI', operator: 'google', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', family: 'google', identify: { ua: ['Google-Gemini-CLI', 'GeminiCLI'] }, source: AIROBOTS },
  { id: 'cognition.devin', name: 'Devin', operator: 'cognition', class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary', verifiable: 'declared', identify: { ua: ['Devin'] }, source: AIROBOTS },
  { id: 'klaviyo.aibot', name: 'KlaviyoAIBot', operator: 'klaviyo', class: 'bot', behaviour: 'data_collection', surface: 'crawler', operatorType: 'direct', verifiable: 'signed', identify: { ua: ['KlaviyoAIBot'] }, source: WBA_REGISTRY },
  ...([
    ['addsearch.addsearchbot', 'AddSearchBot', 'addsearch', ['AddSearchBot']], ['lyrenth.aiwebindex', 'AIWebIndex', 'lyrenth', ['AIWebIndex']],
    ['andi.andibot', 'Andibot', 'andi', ['Andibot']], ['direqt.anomura', 'Anomura', 'direqt', ['Anomura']], ['aranet.searchbot', 'Aranet-SearchBot', 'aranet', ['Aranet-SearchBot']],
    ['microsoft.azureai-searchbot', 'AzureAI-SearchBot', 'microsoft', ['AzureAI-SearchBot']], ['channel3.bot', 'Channel3Bot', 'channel3', ['Channel3Bot']],
    ['iask.bot', 'iAsk', 'iask', ['iAskBot', 'iaskspider']], ['querit.bot', 'Querit', 'querit', ['Querit-SearchBot', 'QueritBot']], ['zanista.bot', 'ZanistaBot', 'zanista', ['ZanistaBot']],
  ] as const).map(([id, name, op, ua]) => declared(id, name, op, [...ua], { behaviour: 'search' })),
  ...([
    ['liner.linerbot', 'LinerBot', 'liner', ['LinerBot']], ['mozilla.tabstack', 'Mozilla Tabstack', 'mozilla', ['Mozilla-Tabstack']],
    ['sst.opencode', 'opencode', 'sst', ['opencode']], ['geisthaus.pagefetcher', 'GeistHaus PageFetcher', 'geisthaus', ['GeistHaus-PageFetcher']],
    ['poggio.citations', 'Poggio-Citations', 'poggio', ['Poggio-Citations']], ['qualified.bot', 'QualifiedBot', 'qualified', ['QualifiedBot']],
    ['useai.agent', 'UseAI', 'useai', ['UseAI']], ['buddybot.agent', 'BuddyBot', 'buddybot', ['BuddyBot']], ['wrtn.bot', 'WRTNBot', 'wrtn', ['WRTNBot']],
    ['quantumcloud.wpbot', 'wpbot', 'quantumcloud', ['wpbot']],
  ] as const).map(([id, name, op, ua]) => declared(id, name, op, [...ua], { class: 'agent', behaviour: 'agent', surface: 'user_fetch', operatorType: 'intermediary' })),
  declared('amazon.ai-services', 'Amazon AI services (Kendra, Q Business, Bedrock)', 'amazon', ['amazon-kendra', 'amazon-QBusiness', 'bedrockbot'], { behaviour: 'data_collection', operatorType: 'intermediary', family: 'amazon' }),
  { id: 'cloudflare.ai-search', name: 'Cloudflare AI Search', operator: 'cloudflare', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'intermediary', verifiable: 'signed', identify: { ua: ['Cloudflare-AI-Search', 'Cloudflare-AutoRAG'] }, source: RADAR },
];

// ── AI training and data crawlers ────────────────────────────────────────────────────────────
const aiCrawlers: Entry[] = [
  { id: 'openai.gptbot', name: 'GPTBot', operator: 'openai', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'openai', identify: { ua: ['GPTBot'], ipLists: [{ vendor: 'openai_gptbot', url: 'https://openai.com/gptbot.json' }] }, robotsToken: 'GPTBot', respectsRobots: true, docsUrl: OAI, source: OAI },
  { id: 'anthropic.claudebot', name: 'ClaudeBot', operator: 'anthropic', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'claude', identify: { ua: ['ClaudeBot', 'Claude-Web', 'anthropic-ai'], ipLists: ANTHROPIC_IPS }, robotsToken: 'ClaudeBot', respectsRobots: true, docsUrl: ANT, source: ANT },
  { id: 'google.googleother', name: 'GoogleOther', operator: 'google', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'google', identify: { ua: ['GoogleOther(?:-Image|-Video)?', 'Google-CloudVertexBot', 'CloudVertexBot', 'Google-Extended'], ipLists: GOOGLE_COMMON_IPS, rdns: GOOGLE_RDNS }, robotsToken: 'Google-Extended', respectsRobots: true, docsUrl: GOOG_COMMON, source: GOOG_COMMON },
  { id: 'meta.externalagent', name: 'Meta-ExternalAgent', operator: 'meta', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'signed', identify: { ua: ['meta-externalagent', 'FacebookBot'], signatureAgent: ['www.meta.com'] }, robotsToken: 'meta-externalagent', respectsRobots: true, docsUrl: META, source: META },
  { id: 'bytedance.bytespider', name: 'Bytespider', operator: 'bytedance', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'declared', identify: { ua: ['Bytespider', 'TikTokSpider', 'DoubaoBot'] }, robotsToken: 'Bytespider', respectsRobots: false, source: AIROBOTS },
  { id: 'amazon.amazonbot', name: 'Amazonbot', operator: 'amazon', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'declared', family: 'amazon', identify: { ua: ['Amazonbot'] }, robotsToken: 'Amazonbot', respectsRobots: true, docsUrl: AMZ, source: AMZ },
  { id: 'commoncrawl.ccbot', name: 'CCBot', operator: 'commoncrawl', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', identify: { ua: ['CCBot'], ipLists: [{ vendor: 'ccbot', url: 'https://index.commoncrawl.org/ccbot.json' }], rdns: ['.crawl.commoncrawl.org'] }, robotsToken: 'CCBot', respectsRobots: true, source: 'https://commoncrawl.org/ccbot' },
  { id: 'brightdata.brightbot', name: 'Brightbot', operator: 'brightdata', class: 'bot', behaviour: 'data_collection', surface: 'crawler', operatorType: 'direct', verifiable: 'declared', identify: { ua: ['Brightbot'] }, source: 'https://brightdata.com/brightbot' },
  { id: 'mistral.training', name: 'MistralAI-Training', operator: 'mistral', class: 'bot', behaviour: 'training', surface: 'crawler', operatorType: 'direct', verifiable: 'declared', identify: { ua: ['MistralAI-Training'] }, respectsRobots: true, docsUrl: MISTRAL, source: MISTRAL },
  declared('cohere.crawler', 'Cohere', 'cohere', ['cohere-training-data-crawler', 'cohere-ai']),
  declared('diffbot.diffbot', 'Diffbot', 'diffbot', ['Diffbot', 'Diffbot-User'], { behaviour: 'data_collection', operatorType: 'intermediary' }),
  declared('allenai.ai2bot', 'AI2Bot', 'allenai', ['AI2Bot', 'Ai2Bot-Dolma', 'AI2Bot-DeepResearchEval'], { respectsRobots: true }),
  declared('timpi.timpibot', 'Timpibot', 'timpi', ['Timpibot']),
  declared('webz.omgili', 'Webz.io (omgili)', 'webz', ['omgili', 'omgilibot', 'webzio-extended'], { behaviour: 'data_collection', respectsRobots: true }),
  declared('hive.imagesiftbot', 'ImagesiftBot', 'hive', ['ImagesiftBot'], { behaviour: 'data_collection', respectsRobots: true }),
  declared('huawei.petalbot', 'PetalBot', 'huawei', ['PetalBot', 'PanguBot'], { behaviour: 'search', respectsRobots: true, source: RADAR }),
  declared('deepseek.deepseekbot', 'DeepSeekBot', 'deepseek', ['DeepSeekBot'], { respectsRobots: false }),
  declared('xai.grok', 'Grok', 'xai', ['GrokBot', 'xAI-Grok', 'Grok-DeepSearch', 'GrokAgent'], { source: RADAR }),
  declared('moonshot.kimibot', 'KimiBot', 'moonshot', ['KimiBot']),
  declared('alibaba.qwen', 'Qwen', 'alibaba', ['QwenBot', 'TongyiBot']),
  declared('baidu.ernie', 'ERNIE', 'baidu', ['ERNIEBot', 'YiyanBot']),
  declared('zhipu.chatglm', 'ChatGLM-Spider', 'zhipu', ['ChatGLM-Spider']),
  declared('yandex.additional', 'YandexAdditional', 'yandex', ['YandexAdditional(?:Bot)?'], { verifiable: 'rdns', identify: { ua: ['YandexAdditional(?:Bot)?'], rdns: ['.yandex.ru', '.yandex.net', '.yandex.com'] }, respectsRobots: true }),
  declared('kangaroo.bot', 'Kangaroo Bot', 'kangaroo', ['Kangaroo Bot'], { source: CUA }),
  declared('rois.cotoyogi', 'Cotoyogi', 'rois', ['Cotoyogi'], { respectsRobots: true, source: RADAR }),
  declared('nict.icc-crawler', 'ICC-Crawler', 'nict', ['ICC-Crawler'], { respectsRobots: true, source: RADAR }),
  declared('softbank.sbintuitions', 'SBIntuitionsBot', 'softbank', ['SBIntuitionsBot'], { respectsRobots: true }),
  declared('laion.img2dataset', 'img2dataset', 'laion', ['img2dataset', 'LAIONDownloader', 'laion-huggingface-processor'], { behaviour: 'data_collection', source: 'https://github.com/rom1504/img2dataset' }),
  ...([
    ['panscient', 'Panscient', ['panscient']], ['velen', 'Velen', ['VelenPublicWebCrawler']], ['aihit', 'aiHitBot', ['aiHitBot']],
    ['factset', 'FactSet', ['Factset_spyderbot']], ['iss', 'ISS Cyber Risk', ['ISSCyberRiskCrawler']], ['sidetrade', 'Sidetrade', ['Sidetrade indexer bot']],
    ['netestate', 'netEstate', ['netEstate Imprint Crawler']], ['awario', 'Awario', ['Awario(?:Bot|SmartBot|RssBot)?']], ['brandwatch', 'Brandwatch', ['magpie-crawler']],
    ['echobox', 'Echobox', ['EchoboxBot', 'Echobot Bot']], ['meltwater', 'Meltwater', ['YaK']], ['quillbot', 'QuillBot', ['QuillBot']], ['linguee', 'Linguee', ['Linguee Bot']],
    ['atlassian', 'Atlassian', ['atlassian-bot']], ['bigsur', 'bigsur.ai', ['bigsur\\.ai']], ['poseidon', 'Poseidon', ['Poseidon Research Crawler']],
    ['crawlspace', 'Crawlspace', ['Crawlspace']], ['wardbot', 'WARDBot', ['WARDBot']], ['friendlycrawler', 'FriendlyCrawler', ['FriendlyCrawler']],
    ['cragsoftware', 'CragCrawler', ['CragCrawler']], ['datenbank', 'Datenbank Crawler', ['Datenbank Crawler']], ['henkbot', 'HenkBot', ['HenkBot']],
    ['imagespider', 'imageSpider', ['imageSpider']], ['kunato', 'KunatoCrawler', ['KunatoCrawler']], ['mycentralai', 'MyCentralAIScraperBot', ['MyCentralAIScraperBot']],
    ['naget', 'NagetBot', ['NagetBot']], ['newsai', 'newsai', ['newsai']], ['reflection', 'Reflectionbot', ['Reflectionbot']],
    ['ceramic', 'TerraCotta (Ceramic)', ['TerraCotta', 'Terra Cotta']], ['thinkbot', 'Thinkbot', ['Thinkbot']], ['agenttimes', 'AgentTimes', ['AgentTimes']],
  ] as const).map(([op, name, ua]) => declared(`${op}.crawler`, name, op, [...ua], { behaviour: 'data_collection' })),
];

// ── Search engines ───────────────────────────────────────────────────────────────────────────
const search: Entry[] = [
  { id: 'google.googlebot', name: 'Googlebot', operator: 'google', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'google', identify: { ua: ['Googlebot(?:-Image|-Video|-News)?', 'Storebot-Google', 'Google-InspectionTool'], ipLists: GOOGLE_COMMON_IPS, rdns: GOOGLE_RDNS }, robotsToken: 'Googlebot', respectsRobots: true, docsUrl: GOOG_COMMON, source: GOOG_COMMON },
  { id: 'google.adsbot', name: 'AdsBot-Google', operator: 'google', class: 'bot', behaviour: 'ads_verification', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', family: 'google', identify: { ua: ['AdsBot-Google(?:-Mobile)?', 'Mediapartners-Google', 'APIs-Google', 'Google-Safety'], ipLists: [{ vendor: 'google_special', url: `${GIP}/special-crawlers.json` }], rdns: GOOGLE_RDNS }, respectsRobots: true, docsUrl: GOOG_SPECIAL, source: GOOG_SPECIAL },
  { id: 'microsoft.bingbot', name: 'Bingbot', operator: 'microsoft', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', identify: { ua: ['bingbot', 'adidxbot', 'BingPreview', 'MicrosoftPreview'], ipLists: [{ vendor: 'bingbot', url: 'https://www.bing.com/toolbox/bingbot.json' }], rdns: ['.search.msn.com'] }, robotsToken: 'bingbot', respectsRobots: true, source: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0' },
  { id: 'apple.applebot', name: 'Applebot', operator: 'apple', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', identify: { ua: ['Applebot'], ipLists: [{ vendor: 'applebot', url: 'https://search.developer.apple.com/applebot.json' }], rdns: ['.applebot.apple.com'] }, robotsToken: 'Applebot-Extended', respectsRobots: true, source: 'https://support.apple.com/en-us/119829' },
  { id: 'duckduckgo.duckduckbot', name: 'DuckDuckBot', operator: 'duckduckgo', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', identify: { ua: ['DuckDuckBot'], ipLists: [{ vendor: 'duckduckbot', url: 'https://duckduckgo.com/duckduckbot.json' }] }, respectsRobots: true, source: 'https://duckduckgo.com/duckduckgo-help-pages/results/duckduckbot' },
  { id: 'yandex.yandexbot', name: 'YandexBot', operator: 'yandex', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'rdns', identify: { ua: ['YandexBot', 'YandexImages', 'YandexMobileBot'], rdns: ['.yandex.ru', '.yandex.net', '.yandex.com'] }, respectsRobots: true, source: 'https://yandex.com/support/webmaster/en/robot-workings/check-yandex-robots' },
  { id: 'baidu.baiduspider', name: 'Baiduspider', operator: 'baidu', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'rdns', identify: { ua: ['Baiduspider(?:-image|-video|-news|-favo|-cpro|-ads)?'], rdns: ['.baidu.com', '.baidu.jp'] }, respectsRobots: true, source: 'https://help.baidu.com/question?prod_id=99&class=476&id=2996' },
  { id: 'seznam.seznambot', name: 'SeznamBot', operator: 'seznam', class: 'bot', behaviour: 'search', surface: 'crawler', operatorType: 'direct', verifiable: 'rdns', identify: { ua: ['SeznamBot'], rdns: ['.seznam.cz'] }, respectsRobots: true, source: 'https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/' },
  declared('yahoo.slurp', 'Yahoo Slurp', 'yahoo', ['Yahoo! Slurp'], { behaviour: 'search', respectsRobots: true, source: RADAR }),
  declared('sogou.spider', 'Sogou spider', 'sogou', ['Sogou (?:web|pic|news) spider'], { behaviour: 'search', respectsRobots: true, source: CUA }),
  declared('naver.yeti', 'Yeti (Naver)', 'naver', ['Yeti'], { behaviour: 'search', respectsRobots: true, source: RADAR }),
  declared('qwant.qwantbot', 'Qwantbot', 'qwant', ['Qwantbot', 'Qwantify'], { behaviour: 'search', respectsRobots: true, source: CUA }),
  declared('mojeek.mojeekbot', 'MojeekBot', 'mojeek', ['MojeekBot'], { behaviour: 'search', respectsRobots: true, source: CUA }),
  declared('coccoc.coccocbot', 'coccocbot', 'coccoc', ['coccocbot(?:-web|-image)?'], { behaviour: 'search', respectsRobots: true, source: CUA }),
  declared('brave.bravebot', 'Bravebot', 'brave', ['Bravebot'], { behaviour: 'search', respectsRobots: true, source: RADAR }),
  declared('seekport.seekportbot', 'SeekportBot', 'seekport', ['SeekportBot'], { behaviour: 'search', source: CUA }),
  declared('qihoo.360spider', '360Spider', 'qihoo', ['360Spider'], { behaviour: 'search', source: CUA }),
];

// ── SEO and marketing crawlers ───────────────────────────────────────────────────────────────
const seo: Entry[] = [
  { id: 'ahrefs.ahrefsbot', name: 'AhrefsBot', operator: 'ahrefs', class: 'bot', behaviour: 'seo', surface: 'crawler', operatorType: 'direct', verifiable: 'ip', identify: { ua: ['AhrefsBot', 'AhrefsSiteAudit'], ipLists: [{ vendor: 'ahrefs', url: 'https://api.ahrefs.com/v3/public/crawler-ip-ranges' }], rdns: ['.ahrefs.com', '.ahrefs.net'] }, respectsRobots: true, source: 'https://ahrefs.com/robot' },
  declared('semrush.semrushbot', 'SemrushBot', 'semrush', ['SemrushBot(?:-[A-Za-z]+)?', 'SiteAuditBot'], { behaviour: 'seo', respectsRobots: true, source: 'https://www.semrush.com/bot/' }),
  declared('majestic.mj12bot', 'MJ12bot', 'majestic', ['MJ12bot'], { behaviour: 'seo', respectsRobots: true, source: RADAR }),
  declared('moz.dotbot', 'DotBot / rogerbot', 'moz', ['DotBot', 'rogerbot'], { behaviour: 'seo', respectsRobots: true, source: RADAR }),
  declared('dataforseo.bot', 'DataForSeoBot', 'dataforseo', ['DataForSeoBot'], { behaviour: 'seo', respectsRobots: true, source: RADAR }),
  declared('webmeup.blexbot', 'BLEXBot', 'webmeup', ['BLEXBot'], { behaviour: 'seo', respectsRobots: true, source: RADAR }),
  declared('babbar.barkrowler', 'Barkrowler', 'babbar', ['Barkrowler'], { behaviour: 'seo', respectsRobots: true, source: RADAR }),
  declared('seokicks.bot', 'SEOkicks', 'seokicks', ['SEOkicks'], { behaviour: 'seo', respectsRobots: true, source: CUA }),
  declared('screamingfrog.spider', 'Screaming Frog', 'screamingfrog', ['Screaming Frog SEO Spider'], { behaviour: 'seo', operatorType: 'intermediary', source: CUA }),
  declared('sitebulb.crawler', 'Sitebulb', 'sitebulb', ['Sitebulb'], { behaviour: 'seo', operatorType: 'intermediary', source: CUA }),
  declared('serpstat.bot', 'serpstatbot', 'serpstat', ['serpstatbot'], { behaviour: 'seo', source: CUA }),
  declared('seranking.bot', 'SE Ranking', 'seranking', ['SERankingBacklinksBot'], { behaviour: 'seo', source: CUA }),
  declared('brightedge.crawler', 'BrightEdge', 'brightedge', ['BrightEdge Crawler'], { behaviour: 'seo', source: CUA }),
  declared('siteimprove.crawler', 'Siteimprove', 'siteimprove', ['Siteimprove'], { behaviour: 'seo', source: CUA }),
];

// ── Link previews and monitoring ─────────────────────────────────────────────────────────────
const preview = (id: string, name: string, operator: string, ua: string[], source = RADAR): Entry =>
  declared(id, name, operator, ua, { behaviour: 'link_preview', surface: 'user_fetch', source });
const monitor = (id: string, name: string, operator: string, ua: string[], ipUrl?: string): Entry => ({
  ...declared(id, name, operator, ua, { behaviour: 'monitoring', operatorType: 'intermediary', source: RADAR }),
  ...(ipUrl ? { verifiable: 'ip' as const, identify: { ua, ipLists: [{ vendor: operator, url: ipUrl }] } } : {}),
});
const social: Entry[] = [
  preview('meta.facebookexternalhit', 'facebookexternalhit', 'meta', ['facebookexternalhit', 'meta-externalads'], META),
  preview('x.twitterbot', 'Twitterbot', 'x', ['Twitterbot']),
  preview('linkedin.linkedinbot', 'LinkedInBot', 'linkedin', ['LinkedInBot']),
  preview('slack.slackbot', 'Slackbot', 'slack', ['Slackbot(?:-LinkExpanding)?', 'Slack-ImgProxy']),
  preview('discord.discordbot', 'Discordbot', 'discord', ['Discordbot']),
  preview('telegram.telegrambot', 'TelegramBot', 'telegram', ['TelegramBot']),
  preview('meta.whatsapp', 'WhatsApp', 'meta', ['^WhatsApp/[0-9.]+'], CUA),
  { ...preview('pinterest.pinterestbot', 'Pinterestbot', 'pinterest', ['Pinterestbot'], 'https://help.pinterest.com/en/business/article/pinterest-crawler'), verifiable: 'rdns', identify: { ua: ['Pinterestbot'], rdns: ['.pinterest.com', '.pinterestcrawler.com'] } },
  preview('reddit.redditbot', 'redditbot', 'reddit', ['redditbot'], CUA),
  preview('snap.urlpreview', 'Snap URL Preview', 'snap', ['Snap URL Preview Service'], CUA),
  preview('iframely.bot', 'Iframely', 'iframely', ['Iframely'], CUA),
  preview('embedly.bot', 'Embedly', 'embedly', ['Embedly'], CUA),
  monitor('uptimerobot.monitor', 'UptimeRobot', 'uptimerobot', ['UptimeRobot'], 'https://uptimerobot.com/inc/files/ips/IPv4.txt'),
  monitor('pingdom.monitor', 'Pingdom', 'pingdom', ['Pingdom\\.com_bot', 'PingdomPageSpeed'], 'https://my.pingdom.com/probes/ipv4'),
  monitor('datadog.synthetics', 'Datadog Synthetics', 'datadog', ['DatadogSynthetics'], 'https://ip-ranges.datadoghq.com/'),
  monitor('checkly.monitor', 'Checkly', 'checkly', ['Checkly'], 'https://api.checklyhq.com/v1/static-ips'),
  monitor('statuscake.monitor', 'StatusCake', 'statuscake', ['StatusCake']),
  monitor('site24x7.monitor', 'Site24x7', 'site24x7', ['Site24x7']),
  monitor('betteruptime.monitor', 'Better Stack', 'betteruptime', ['BetterUptimeBot', 'Better Uptime Bot']),
  monitor('newrelic.synthetics', 'New Relic Synthetics', 'newrelic', ['NewRelicSynthetics']),
  monitor('google.lighthouse', 'Lighthouse', 'google', ['Chrome-Lighthouse']),
  monitor('webpagetest.ptst', 'WebPageTest', 'webpagetest', ['PTST']),
  monitor('gtmetrix.monitor', 'GTmetrix', 'gtmetrix', ['GTmetrix']),
];

// ── Scraper APIs, automation tools and HTTP libraries ────────────────────────────────────────
const tool = (id: string, name: string, operator: string, surface: Entry['surface'], identify: Entry['identify'], source: string, overrides: Partial<Entry> = {}): Entry => ({
  id, name, operator, class: 'bot', behaviour: 'data_collection', surface, operatorType: 'intermediary',
  verifiable: identify.ua?.length ? 'declared' : 'stealth', identify, respectsRobots: 'unknown', source, ...overrides,
});
const scrapers: Entry[] = [
  tool('brightdata.unlocker', 'Bright Data', 'brightdata', 'scraper_api', {}, 'https://brightdata.com'),
  tool('oxylabs.api', 'Oxylabs', 'oxylabs', 'scraper_api', {}, 'https://oxylabs.io'),
  tool('scraperapi.api', 'ScraperAPI', 'scraperapi', 'scraper_api', {}, 'https://www.scraperapi.com'),
  tool('scrapingbee.api', 'ScrapingBee', 'scrapingbee', 'scraper_api', {}, 'https://www.scrapingbee.com'),
  tool('zenrows.api', 'ZenRows', 'zenrows', 'scraper_api', {}, 'https://www.zenrows.com'),
  tool('scrapfly.api', 'Scrapfly', 'scrapfly', 'scraper_api', {}, 'https://scrapfly.io'),
  tool('zyte.scrapy', 'Scrapy / Zyte', 'zyte', 'scraper_api', { ua: ['Scrapy'] }, 'https://github.com/scrapy/scrapy/blob/master/scrapy/settings/default_settings.py'),
  tool('apify.crawlee', 'Apify / Crawlee', 'apify', 'scraper_api', { ua: ['ApifyBot', 'ApifyWebsiteContentCrawler'], signatureAgent: ['api.apify.com'] }, 'https://docs.apify.com', { verifiable: 'signed' }),
  tool('firecrawl.api', 'Firecrawl', 'firecrawl', 'scraper_api', { ua: ['FirecrawlAgent'] }, 'https://github.com/mendableai/firecrawl', { robotsToken: 'FirecrawlAgent', respectsRobots: true }),
  tool('jina.reader', 'Jina Reader', 'jina', 'scraper_api', {}, 'https://github.com/jina-ai/reader'),
  tool('tavily.api', 'Tavily', 'tavily', 'scraper_api', { ua: ['TavilyBot'] }, 'https://docs.tavily.com/documentation/search-crawler'),
  tool('serpapi.api', 'SerpApi', 'serpapi', 'scraper_api', {}, 'https://serpapi.com'),
  tool('crawl4ai.crawler', 'Crawl4AI', 'crawl4ai', 'scraper_api', { ua: ['Crawl4AI'] }, 'https://github.com/unclecode/crawl4ai'),
  tool('lightpanda.browser', 'Lightpanda', 'lightpanda', 'automation_tool', { ua: ['Lightpanda'] }, 'https://github.com/lightpanda-io/browser'),
  tool('chrome.headless', 'Headless Chrome', 'chrome', 'automation_tool', { ua: ['HeadlessChrome'] }, 'https://developer.chrome.com/docs/chromium/headless'),
  ...([
    ['python.requests', 'python-requests', 'python', ['python-requests']], ['python.httpx', 'python-httpx', 'python', ['python-httpx']],
    ['python.urllib', 'Python-urllib', 'python', ['Python-urllib']], ['python.aiohttp', 'aiohttp', 'python', ['aiohttp']],
    ['go.http-client', 'Go-http-client', 'go', ['Go-http-client']], ['square.okhttp', 'okhttp', 'square', ['okhttp']],
    ['curl.curl', 'curl', 'curl', ['curl/[0-9]']], ['gnu.wget', 'Wget', 'gnu', ['Wget']], ['axios.axios', 'axios', 'axios', ['axios/[0-9]']],
    ['node.fetch', 'node-fetch', 'node', ['node-fetch', 'undici']], ['apache.httpclient', 'Apache-HttpClient', 'apache', ['Apache-HttpClient']],
  ] as const).map(([id, name, op, ua]) => tool(id, name, op, 'http_library', { ua: [...ua] }, CUA)),
];

export const CATALOG: readonly CatalogEntry[] = [...fingerprinted, ...agents, ...aiFetch, ...aiCrawlers, ...search, ...seo, ...social, ...scrapers];
