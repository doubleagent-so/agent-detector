import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectSignals, DOCS } from '../scripts/docs.ts';

describe('generated docs', () => {
  it.each(Object.entries(DOCS))('%s is up to date (npm run docs)', (path, render) => {
    expect(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).toBe(render());
  });

  it('lists every signal code in the source', () => {
    const listed = new Set(collectSignals().map((r) => r.code));
    expect(listed.size).toBeGreaterThan(60);
    for (const code of ['auto.webdriver', 'env.webgl_software', 'drive.cdp_screen_coords', 'marker.claude_active', 'global.playwright']) {
      expect(listed.has(code), code).toBe(true);
    }
  });
});
