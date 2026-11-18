// Event indexer. Reads each active task contract's logs from the EVM RPC and updates money states from the on-chain events
// (SPEC-qorechain R5). The RPC allows fewer than 10,000 blocks per getLogs call, so each contract is scanned in chunks from a
// stored block cursor. chain_cursor.last_consensus_ts holds the last fully scanned BLOCK NUMBER (the column name is a leftover).
import { and, eq, inArray } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { markDefaultOnChain, publicClient, readTaskTerms } from './client.js';
import { blockRanges, fetchTaskLogs } from './logs.js';
import { legNotFailed, notifyPayoutsDue } from './ops.js';
import { dispatchTask } from '../agents/dispatch.js';

/** Where to start scanning a contract that has no cursor yet: the block of the transaction that created it. */
async function startBlock(agreementId: string): Promise<bigint> {
  const [spec] = await db.select({ deployTx: schema.contractSpecs.deployTx }).from(schema.contractSpecs)
    .where(and(eq(schema.contractSpecs.agreementId, agreementId), eq(schema.contractSpecs.kind, 'root'))).limit(1);
  if (spec?.deployTx) {
    try { return (await publicClient.getTransactionReceipt({ hash: spec.deployTx as Hex })).blockNumber; } catch { /* fall back below */ }
  }
  const head = await publicClient.getBlockNumber();
  return head > 20_000n ? head - 20_000n : 0n; // events older than that would be missed; the deploy tx is normally known
}

type Agreement = typeof schema.agreements.$inferSelect;

async function applyEvent(agreement: Agreement, eventName: string, args: Record<string, unknown>, txHash: string) {
  switch (eventName) {
    case 'Funded': {
      await db.update(schema.agreements).set({ status: 'funded' }).where(and(eq(schema.agreements.id, agreement.id), eq(schema.agreements.status, 'agreed')));
      // Complete a pending funding row if one exists; otherwise (the usual wallet fund() path) insert it.
      const done = await db.update(schema.payments)
        .set({ status: 'confirmed', amountTinybar: String(args.amount), txHash })
        .where(and(eq(schema.payments.agreementId, agreement.id), eq(schema.payments.kind, 'fund'), eq(schema.payments.status, 'pending')))
        .returning({ id: schema.payments.id });
      if (done.length === 0) await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'fund', amountTinybar: String(args.amount), txHash, status: 'confirmed' });
      // The money is locked: tell the agent to start work.
      void dispatchTask(agreement.id).catch((e) => console.error('[indexer] dispatchTask', e));
      break;
    }
    case 'Released':
    case 'Refunded': {
      const released = eventName === 'Released';
      await db.update(schema.agreements).set({ status: released ? 'released' : 'refunded' })
        .where(and(eq(schema.agreements.id, agreement.id), inArray(schema.agreements.status, ['funded', 'submitted', 'verifying'])));
      const kind = released ? 'release' : 'refund';
      const updated = await db.update(schema.payments)
        .set({ status: 'confirmed', amountTinybar: String(args.amount), txHash })
        .where(and(eq(schema.payments.agreementId, agreement.id), eq(schema.payments.kind, kind), eq(schema.payments.status, 'pending')))
        .returning({ id: schema.payments.id });
      if (updated.length === 0) await db.insert(schema.payments).values({ agreementId: agreement.id, kind, amountTinybar: String(args.amount), txHash, status: 'confirmed' });
      // A has been paid by the contract; tell it who it now owes and where to pay.
      if (released) void notifyPayoutsDue(agreement.id);
      break;
    }
    case 'PayoutRecorded':
      await db.update(schema.subLegs).set({ status: 'paid', payoutTx: String(args.payoutRef) })
        .where(and(eq(schema.subLegs.agreementId, agreement.id), eq(schema.subLegs.legId, Number(args.legId))));
      break;
    case 'PayoutDefaulted':
      await db.update(schema.subLegs).set({ status: 'defaulted' })
        .where(and(eq(schema.subLegs.agreementId, agreement.id), eq(schema.subLegs.legId, Number(args.legId))));
      break;
    default:
      break; // Submitted and SubLegAdded are recorded in chain_events; their DB rows are written when the backend sends them.
  }
}

async function indexTask(agreement: Agreement) {
  const address = agreement.escrowAddress as Address;
  const [cursor] = await db.select().from(schema.chainCursor).where(eq(schema.chainCursor.contract, address)).limit(1);
  const head = await publicClient.getBlockNumber();
  const safeHead = head - BigInt(env.QORE_CONFIRMATIONS);
  const from = cursor ? BigInt(cursor.lastConsensusTs) + 1n : await startBlock(agreement.id);

  // Chunks are processed in order and the cursor moves after each one, so a failure halfway only repeats the last chunk.
  for (const [a, b] of blockRanges(from, safeHead, BigInt(env.QORE_LOGS_CHUNK_BLOCKS))) {
    const logs = await fetchTaskLogs(address, a, b);
    for (const log of logs) {
      const args = log.args as unknown as Record<string, unknown>;
      const inserted = await db.insert(schema.chainEvents).values({
        contract: address, event: log.eventName, txHash: log.transactionHash, logIndex: log.logIndex, consensusTs: String(log.blockNumber),
        args: JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      }).onConflictDoNothing().returning({ id: schema.chainEvents.id });
      if (inserted.length > 0) await applyEvent(agreement, log.eventName, args, log.transactionHash);
    }
    await db.insert(schema.chainCursor).values({ contract: address, lastConsensusTs: String(b) })
      .onConflictDoUpdate({ target: schema.chainCursor.contract, set: { lastConsensusTs: String(b) } });
  }
}

/** A released task whose sub-agents were not paid within the grace period: mark each debt defaulted on-chain. */
async function markOverdueDefaults() {
  const pending = await db.select({ leg: schema.subLegs, agreement: schema.agreements })
    .from(schema.subLegs).innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
    .where(and(eq(schema.subLegs.status, 'pending'), eq(schema.agreements.status, 'released'), legNotFailed)); // a leg whose sub-task failed is not a debt
  const now = Math.floor(Date.now() / 1000);
  for (const { leg, agreement } of pending) {
    try {
      const t = await readTaskTerms(agreement.escrowAddress as Address);
      if (t.releasedAt > 0 && now > t.releasedAt + t.payoutGrace) await markDefaultOnChain(agreement.escrowAddress as Address, leg.legId);
    } catch (e) { console.error(`[indexer] markDefault ${agreement.escrowAddress}/${leg.legId}: ${(e as Error).message}`); }
  }
}

let running = false;
export async function indexOnce() {
  if (running) return;
  running = true;
  try {
    const active = await db.select().from(schema.agreements).where(inArray(schema.agreements.status, ['agreed', 'funded', 'submitted', 'verifying']));
    // Released tasks stay indexed while a sub-agent is still owed: PayoutRecorded / PayoutDefaulted arrive after release.
    const owing = await db.select({ agreement: schema.agreements }).from(schema.subLegs)
      .innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
      .where(and(eq(schema.subLegs.status, 'pending'), eq(schema.agreements.status, 'released'), legNotFailed));
    const seen = new Set<string>();
    for (const agreement of [...active, ...owing.map((o) => o.agreement)]) {
      if (!agreement.escrowAddress || seen.has(agreement.id)) continue;
      seen.add(agreement.id);
      try { await indexTask(agreement); } catch (e) { console.error(`[indexer] ${agreement.escrowAddress}: ${(e as Error).message}`); }
    }
    await markOverdueDefaults();
  } finally {
    running = false;
  }
}

export function startIndexer(intervalMs = 5000) {
  if (env.INDEXER_ENABLED !== 'true') return () => {};
  const t = setInterval(() => { void indexOnce().catch((e) => console.error('[indexer]', e)); }, intervalMs);
  return () => clearInterval(t);
}
