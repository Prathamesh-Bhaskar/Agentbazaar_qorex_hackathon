// Reads TaskEscrow events from the EVM RPC (SPEC-qorechain R5). No database here, so it can be tested against the chain.
import type { Address } from 'viem';
import { taskEscrowEvents } from './abi.js';
import { publicClient } from './client.js';

/** Split [from, to] (inclusive) into consecutive ranges of at most `size` blocks. The RPC limits a getLogs range. */
export function blockRanges(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  if (size < 1n) throw new Error('chunk size must be at least 1');
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) out.push([start, start + size - 1n < to ? start + size - 1n : to]);
  return out;
}

/** Decoded TaskEscrow events of one contract in [fromBlock, toBlock], oldest first. Throws on an RPC error (callers retry later). */
export function fetchTaskLogs(address: Address, fromBlock: bigint, toBlock: bigint) {
  return publicClient.getLogs({ address, events: taskEscrowEvents, fromBlock, toBlock, strict: true });
}
