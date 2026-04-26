import { describe, it, expect } from 'vitest';
import { truncateSummary } from '../list.js';

describe('truncateSummary', () => {
  it('returns full summary when null max', () => {
    expect(truncateSummary('hello world', null)).toBe('hello world');
  });

  it('returns full summary when length <= max', () => {
    expect(truncateSummary('hi', 5)).toBe('hi');
    expect(truncateSummary('hello', 5)).toBe('hello');
  });

  it('appends ellipsis when max >= 4', () => {
    expect(truncateSummary('hello world', 8)).toBe('hello...');
    expect(truncateSummary('hello world', 8).length).toBe(8);
  });

  it('hard-slices without ellipsis when max < 4', () => {
    // The bug: previously slice(0, max-3) + '...' for max=1 produced
    // 'hello worl...' (13 chars) when caller asked for 1.
    expect(truncateSummary('hello world', 1)).toBe('h');
    expect(truncateSummary('hello world', 2)).toBe('he');
    expect(truncateSummary('hello world', 3)).toBe('hel');
  });

  it('never exceeds max chars', () => {
    for (let n = 1; n <= 20; n++) {
      const result = truncateSummary('the quick brown fox jumps over', n);
      expect(result.length).toBeLessThanOrEqual(n);
    }
  });
});
