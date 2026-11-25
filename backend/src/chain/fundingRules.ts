// Pure rules for the funding keeper (SPEC-qorechain R12). QoreX users cannot send EVM transactions, so the backend triggers
// the contract's permissionless steps. The contract enforces the same conditions; checking first avoids paying for a revert.
import { EscrowState } from './abi.js';

/** Seconds of margin around the deadline: the chain's block time, not our clock, decides, so stay clear of the edge. */
export const DEADLINE_MARGIN = 30;

export type KeeperFacts = { state: number; balanceWei: bigint; priceWei: bigint; nowUnix: number; deadlineUnix: number; hasSubmission: boolean };
export type KeeperAction = 'confirm' | 'refund' | 'none';

export function keeperAction(f: KeeperFacts): KeeperAction {
  const expired = f.nowUnix > f.deadlineUnix + DEADLINE_MARGIN;
  if (f.state === EscrowState.Created) {
    if (!expired && f.nowUnix < f.deadlineUnix - DEADLINE_MARGIN && f.balanceWei >= f.priceWei) return 'confirm';
    return expired && f.balanceWei > 0n ? 'refund' : 'none'; // part-paid (or paid too late): give it back
  }
  // Funded and past the deadline with nothing delivered. A submission we hold (even if not yet on chain) is never refunded away.
  if (f.state === EscrowState.Funded) return expired && !f.hasSubmission ? 'refund' : 'none';
  return 'none';
}
