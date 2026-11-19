import { describe, expect, it } from 'vitest';
import { costUqor, windowAdmits, windowValueUqor, WEI_PER_UQOR } from './window.js';

const live = { live: true, remainingTxs: 5n, remainingValue: 1_000_000n, remainingBlocks: 5_000n };

describe('costUqor', () => {
  it('matches the SDK example: 21,000 gas at 112.5 gwei plus 1,000 uqor of value is 3,363 uqor', () => {
    expect(costUqor(21_000n, 112_500_000_000n, 1_000n * WEI_PER_UQOR)).toBe(3_363n);
  });
  it('rounds up and never returns zero for a paid transaction', () => {
    expect(costUqor(1n, 1n)).toBe(1n);
    expect(costUqor(21_000n, 120_000_000_000n)).toBe(2_520n); // 2.52e15 wei = 2,520 uqor exactly
  });
  it('counts value sent in wei', () => {
    expect(costUqor(0n, 0n, 10n ** 18n)).toBe(1_000_000n); // 1 QOR
  });
});

describe('windowAdmits', () => {
  it('admits when live with room in txs, value and blocks', () => {
    expect(windowAdmits(live, 3_000n, 120n)).toBe(true);
  });
  it('rejects when there is no live window', () => {
    expect(windowAdmits({ ...live, live: false }, 1n, 0n)).toBe(false);
  });
  it('rejects when blocks are about to run out (renew early)', () => {
    expect(windowAdmits({ ...live, remainingBlocks: 100n }, 1n, 120n)).toBe(false);
    expect(windowAdmits({ ...live, remainingBlocks: 120n }, 1n, 120n)).toBe(true);
  });
  it('rejects when no transactions are left', () => {
    expect(windowAdmits({ ...live, remainingTxs: 0n }, 1n, 0n)).toBe(false);
  });
  it('rejects when the value left cannot cover the transaction', () => {
    expect(windowAdmits({ ...live, remainingValue: 999n }, 1_000n, 0n)).toBe(false);
    expect(windowAdmits({ ...live, remainingValue: 1_000n }, 1_000n, 0n)).toBe(true);
  });
});

describe('windowValueUqor', () => {
  it('uses the configured value for ordinary transactions', () => {
    expect(windowValueUqor(7_000n, 5_000_000n)).toBe(5_000_000n);
  });
  it('grows to four times the triggering transaction when that is larger', () => {
    expect(windowValueUqor(2_000_000n, 5_000_000n)).toBe(8_000_000n);
  });
});
