import { describe, expect, it } from 'vitest';
import { blockRanges } from './logs.js';

describe('blockRanges', () => {
  it('splits into consecutive inclusive ranges', () => {
    expect(blockRanges(1n, 12n, 5n)).toEqual([[1n, 5n], [6n, 10n], [11n, 12n]]);
  });
  it('returns one range when it fits', () => {
    expect(blockRanges(100n, 100n, 5000n)).toEqual([[100n, 100n]]);
    expect(blockRanges(100n, 4000n, 5000n)).toEqual([[100n, 4000n]]);
  });
  it('returns nothing when from is after to (already caught up)', () => {
    expect(blockRanges(11n, 10n, 5n)).toEqual([]);
  });
  it('never exceeds the chunk size and leaves no gaps', () => {
    const r = blockRanges(7n, 20_000n, 4_999n);
    expect(r[0][0]).toBe(7n);
    expect(r.at(-1)![1]).toBe(20_000n);
    for (let i = 0; i < r.length; i++) {
      expect(r[i][1] - r[i][0] + 1n).toBeLessThanOrEqual(4_999n);
      if (i > 0) expect(r[i][0]).toBe(r[i - 1][1] + 1n);
    }
  });
  it('rejects a chunk size below 1', () => {
    expect(() => blockRanges(1n, 2n, 0n)).toThrow();
  });
});
