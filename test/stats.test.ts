import { describe, expect, it } from 'vitest';
import { cv, mean, median, r3, std } from '../src/behavior/stats.ts';

describe('stats', () => {
  it('handles empty and short arrays', () => {
    expect(mean([])).toBe(0);
    expect(std([5])).toBe(0);
    expect(cv([0, 0])).toBe(0);
    expect(median([])).toBe(0);
  });
  it('computes sample statistics', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(cv([10, 10, 10])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(r3(1.23456)).toBe(1.235);
  });
});
