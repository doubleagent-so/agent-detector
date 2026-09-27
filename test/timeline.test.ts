import { describe, expect, it } from 'vitest';
import { timeline } from '../src/timeline.ts';

describe('timeline', () => {
  it('renders scroll positions and autofill without resetting idle tracking', () => {
    const lines = timeline([
      { k: 'se', t: 1000, sy: 1600, h: 800 },
      { k: 'iv', t: 1500, fs: 3 },
      { k: 'se', t: 1600 },
      { k: 'dn', t: 5000, pt: 'm', ox: 0, oy: 0 },
    ]);
    expect(lines).toEqual([
      't+1.0s scrolled to 2.0 viewports',
      't+1.5s field changed without typing',
      't+5.0s (idle 5.0s, 0 moves) pointer-down mouse offset(0.00,0.00) approach=0 moves',
    ]);
  });
});
