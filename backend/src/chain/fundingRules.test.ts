import { describe, expect, it } from 'vitest';
import { EscrowState } from './abi.js';
import { keeperAction, type KeeperFacts } from './fundingRules.js';

const open: KeeperFacts = { state: EscrowState.Created, balanceWei: 100n, priceWei: 100n, nowUnix: 1_000, deadlineUnix: 10_000, hasSubmission: false };
const late = { nowUnix: 10_031 };

describe('keeperAction', () => {
  it('confirms a task that holds the price (or more) before the deadline', () => {
    expect(keeperAction(open)).toBe('confirm');
    expect(keeperAction({ ...open, balanceWei: 500n })).toBe('confirm');
  });
  it('waits while the task is unpaid or part-paid', () => {
    expect(keeperAction({ ...open, balanceWei: 0n })).toBe('none');
    expect(keeperAction({ ...open, balanceWei: 99n })).toBe('none');
  });
  it('does nothing right at the deadline, where the chain could disagree with our clock', () => {
    for (const nowUnix of [9_970, 10_000, 10_030]) expect(keeperAction({ ...open, nowUnix })).toBe('none');
  });
  it('returns part-paid or late money after the deadline, but never "refunds" an unpaid task', () => {
    expect(keeperAction({ ...open, ...late, balanceWei: 40n })).toBe('refund');
    expect(keeperAction({ ...open, ...late, balanceWei: 100n })).toBe('refund');
    expect(keeperAction({ ...open, ...late, balanceWei: 0n })).toBe('none');
  });
  it('refunds a funded task past its deadline only when nothing was submitted', () => {
    const funded = { ...open, state: EscrowState.Funded };
    expect(keeperAction(funded)).toBe('none');
    expect(keeperAction({ ...funded, ...late })).toBe('refund');
    expect(keeperAction({ ...funded, ...late, hasSubmission: true })).toBe('none');
  });
  it('leaves submitted and settled tasks alone', () => {
    for (const state of [EscrowState.Submitted, EscrowState.Released, EscrowState.Refunded]) {
      expect(keeperAction({ ...open, ...late, state })).toBe('none');
    }
  });
});
