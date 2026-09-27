// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clientHints, deviceFacts } from '../src/env/device.ts';

const win = (nav: Record<string, unknown>, screen: Record<string, unknown> = { colorDepth: 24, availWidth: 1440, availHeight: 875 }) =>
  ({ navigator: nav, screen, document: { createElement: () => ({ getContext: () => null }) } }) as unknown as Window & typeof globalThis;

describe('device facts', () => {
  it('reads what the browser says about itself, bounded, dropping what it does not say', () => {
    const w = win({ languages: ['en-GB', 'en', 'de', 'fr', 'es', 'it'], deviceMemory: 8, maxTouchPoints: 0, connection: { effectiveType: '4g', saveData: false }, platform: 'MacIntel' });
    expect(deviceFacts(w)).toEqual({ langs: ['en-GB', 'en', 'de', 'fr', 'es'], cd: 24, mem: 8, touch: 0, net: '4g', save: false, avail: '1440x875', plat: 'MacIntel' });
    expect(deviceFacts(win({}, null as never))).toEqual({ langs: [] });
    expect(deviceFacts(null as never)).toEqual({});
  });

  it('reads high-entropy client hints when offered', async () => {
    const w = win({ userAgentData: { getHighEntropyValues: async () => ({ platform: 'macOS', platformVersion: '15.5.0', model: '', architecture: 'arm', bitness: '64', fullVersionList: [{ brand: 'Chromium', version: '140.0.7339.81' }, { brand: 'Google Chrome', version: '140.0.7339.81' }] }) } });
    expect(await clientHints(w)).toEqual({ platform: 'macOS', platformVersion: '15.5.0', architecture: 'arm', bitness: '64', brands: 'Chromium 140.0.7339.81, Google Chrome 140.0.7339.81' });
    expect(await clientHints(win({}))).toBeUndefined();
    expect(await clientHints(win({ userAgentData: { getHighEntropyValues: async () => { throw new Error('no'); } } }))).toBeUndefined();
  });
});
