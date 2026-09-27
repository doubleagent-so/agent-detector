import type { AgentFamily } from '../types.ts';
import type { CatalogEntry } from './types.ts';

/**
 * The DOM markers and window globals of catalog entries, and nothing else: this is the only
 * catalog data the browser SDK bundles (via rules.ts). entries.ts merges each one into its full
 * entry by id, so names, sources and docs stay out of the script.
 */
export interface Fingerprint {
  id: string;
  class: CatalogEntry['class'];
  family?: AgentFamily;
  markers?: NonNullable<CatalogEntry['identify']['markers']>;
  globals?: NonNullable<CatalogEntry['identify']['globals']>;
}

export const FINGERPRINTS: readonly Fingerprint[] = [
  {
    id: 'anthropic.claude-in-chrome', class: 'agent', family: 'claude',
    markers: [
      { selector: '#claude-agent-stop-container, #claude-agent-stop-button', code: 'marker.claude_active' },
      { selector: '#claude-agent-glow-border, #claude-phantom-cursor, #claude-static-indicator-container', code: 'marker.claude_active' },
      { selector: '#claude-agent-animation-styles', code: 'marker.claude_residue', llr: 4 },
      { selector: '[id^="claude-agent-"]', code: 'marker.claude' },
    ],
  },
  { id: 'perplexity.comet', class: 'agent', family: 'perplexity', markers: [{ selector: '#pplx-agent-overlay-stop-button, [id^="pplx-agent"]', code: 'marker.comet' }] },
  { id: 'fellou.browser', class: 'agent', markers: [{ selector: '#eko-highlight-container', code: 'marker.eko' }] },
  {
    id: 'browser-use.agent', class: 'agent', family: 'browser_use',
    markers: [{ selector: '#browser-use-debug-highlights, #browser-use-demo-panel, [data-browser-use-highlight], [data-browser-use-interaction-highlight], [data-browser-use-coordinate-highlight]', code: 'marker.browser_use' }],
    globals: [{ pattern: '^__browserUseDemoPanelLoaded$', code: 'global.browser_use' }],
  },
  {
    id: 'browserbase.stagehand', class: 'agent', family: 'browserbase',
    markers: [{ selector: '#__v3_cursor_overlay__, [data-stagehand-mask]', code: 'marker.stagehand' }],
    globals: [{ pattern: '^__stagehand', code: 'global.stagehand' }],
  },
  {
    id: 'skyvern.agent', class: 'agent', family: 'skyvern',
    markers: [
      { selector: '[data-skyvern-otp-box], #boundingBoxContainer', code: 'marker.skyvern' },
      { selector: '[unique_id]', code: 'marker.skyvern_ids', llr: 5 },
    ],
    globals: [{ pattern: '^GlobalSkyvernFrameIndex$|^globalDomDepthMap$|^globalParsedElementCounter$|^__PW_CURSOR_VIS__$|^__pw_trails$', code: 'global.skyvern' }],
  },
  {
    id: 'selenium.webdriver', class: 'bot',
    globals: [
      { pattern: '^\\$?cdc_|^\\$wdc_', code: 'global.chromedriver' },
      { pattern: '^_Selenium_IDE_Recorder$|^__webdriver_|^__selenium_|^__fxdriver_|^__driver_evaluate$|^_selenium$|^callSelenium$', code: 'global.selenium' },
    ],
  },
  { id: 'playwright.automation', class: 'bot', globals: [{ pattern: '^__playwright|^__pwInitScripts$|^playwright__binding', code: 'global.playwright' }] },
  { id: 'puppeteer.headless', class: 'bot', globals: [{ pattern: '^__puppeteer_', code: 'global.puppeteer' }] },
  { id: 'legacy.headless', class: 'bot', globals: [{ pattern: '^__nightmare$|^_phantom$|^callPhantom$|^domAutomation', code: 'global.legacy_automation' }] },
];
