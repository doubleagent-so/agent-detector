// @vitest-environment happy-dom
// The async environment probes catch their own errors, but anything unexpected that escapes them
// (a throwing worker probe, a future probe without a guard) must not keep `engine.ready` from resolving.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env/probes.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/env/probes.ts')>();
  return { ...original, asyncEnvProbes: () => Promise.reject(new Error('probe crashed')) };
});

const { createEngine } = await import('../src/engine.ts');

type W = Window & typeof globalThis;
const win = window as unknown as W;

afterEach(() => { vi.restoreAllMocks(); });

describe('createEngine when the async environment probes reject', () => {
  it('still resolves ready with a verdict', async () => {
    Object.defineProperty(win, 'Worker', { value: undefined, configurable: true });
    const engine = createEngine(win);
    try {
      const verdict = await engine.ready;
      expect(verdict.class).toMatch(/^(human|bot|agent)$/);
      expect(verdict.reasons.some((reason) => reason.code.startsWith('env.worker'))).toBe(false);
    } finally {
      engine.stop();
    }
  });
});
