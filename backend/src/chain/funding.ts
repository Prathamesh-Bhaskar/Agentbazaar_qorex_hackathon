// Funding by native transfer (SPEC-qorechain R12). The client sends QOR from QoreX to the task contract's qor1 address and may
// report the tx hash; the backend verifies it on chain and has the operator call confirmFunding(). A keeper does the same for
// paid tasks nobody reported, refunds expired ones and returns overpayments. Money states still change only from indexed events.
import { and, eq } from 'drizzle-orm';
import { evmToQor } from '@qorechain/sdk';
import { parseEventLogs, type Address } from 'viem';
import { db, schema } from '../db/index.js';
import { EscrowState, taskEscrowAbi } from './abi.js';
import { confirmFundingOnChain, readDeadline, readEscrowState, refundAfterDeadlineOnChain, retryIdempotent, sweepExcessOnChain, taskBalance } from './client.js';
import { DEADLINE_MARGIN, keeperAction } from './fundingRules.js';
import { evaluatePayment, fetchNativeTx, isTxHash, normalizeTxHash, ReceiptUnavailable, weiToUqorCeil } from './payouts.js';
import type { ReportResult } from './payoutReport.js';

/** Gas limit the web page should hint to QoreX for the transfer (measured: about 168k used, 0.045 QOR fee at 0.15 uqor). */
export const FUNDING_GAS_LIMIT = 300_000;

type Agreement = typeof schema.agreements.$inferSelect;
const fail = (code: number, error: string): ReportResult => ({ code, body: { error } });
const now = () => Math.floor(Date.now() / 1000);

/** What the page needs to ask QoreX for: the task's qor1 address and how many uqor are still missing. */
export function fundingInstructions(task: Address, priceWei: bigint, balanceWei: bigint) {
  const missing = priceWei > balanceWei ? priceWei - balanceWei : 0n;
  return {
    payTo: evmToQor(task),
    priceWei: priceWei.toString(),
    amountUqor: weiToUqorCeil(priceWei).toString(),
    shortfallUqor: weiToUqorCeil(missing).toString(),
    gasLimit: FUNDING_GAS_LIMIT,
  };
}

/** Queue a check for money left in a settled task; processPendingSweeps() returns it and records what was returned. */
export async function queueSweep(agreementId: string): Promise<void> {
  const [existing] = await db.select({ id: schema.payments.id }).from(schema.payments)
    .where(and(eq(schema.payments.agreementId, agreementId), eq(schema.payments.kind, 'excess'), eq(schema.payments.status, 'pending'))).limit(1);
  if (!existing) await db.insert(schema.payments).values({ agreementId, kind: 'excess', amountTinybar: '0', status: 'pending' });
}

export async function reportFunding(agreementId: string, txHashInput: string): Promise<ReportResult> {
  if (!isTxHash(txHashInput)) return fail(400, 'txHash must be a 64-character hex transaction hash');
  const hash = normalizeTxHash(txHashInput);
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return fail(404, 'Agreement not found');
  if (!agreement.escrowAddress) return fail(409, 'Task contract not deployed yet');
  const task = agreement.escrowAddress as Address;
  const [client] = await db.select().from(schema.users).where(eq(schema.users.id, agreement.clientUserId)).limit(1);
  if (!client) return fail(409, 'The client of this job no longer exists');

  if (agreement.status !== 'agreed') {
    // A second or late payment. The contract returns anything above the price: at once if the job is settled, else at release.
    if (agreement.status === 'released' || agreement.status === 'refunded') {
      await queueSweep(agreement.id);
      return { code: 200, body: { funded: false, status: agreement.status, note: 'This job is already settled; any money still in the contract will be returned to you' } };
    }
    return { code: 200, body: { funded: true, status: agreement.status, note: 'The job is already funded; anything extra is returned to you when it settles' } };
  }

  let tx;
  try { tx = await fetchNativeTx(hash); }
  catch (e) { return fail(503, e instanceof ReceiptUnavailable ? `${e.message}; try again` : (e as Error).message); }
  if (!tx) return fail(404, 'That transaction was not found on QoreChain (it may still be confirming; try again shortly)');
  const from = evmToQor(client.address);
  const check = evaluatePayment(tx, {
    from, to: evmToQor(task), minUqor: 1n, // any part payment counts; the contract decides when the price is covered
    notBeforeUnix: Math.floor(agreement.createdAt.getTime() / 1000) - 60,
    parties: { payer: 'your account', payee: "this job's contract", before: 'this job was agreed' },
  });
  if (!check.ok) return fail(422, `Payment not accepted: ${check.reason}`);

  // Remember the client's own tx hash; the indexer completes this row when it sees the Funded event.
  const [row] = await db.select({ id: schema.payments.id }).from(schema.payments)
    .where(and(eq(schema.payments.agreementId, agreement.id), eq(schema.payments.kind, 'fund'), eq(schema.payments.status, 'pending'))).limit(1);
  if (row) await db.update(schema.payments).set({ nativeTx: hash, payerAccountId: from }).where(eq(schema.payments.id, row.id));
  else await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'fund', amountTinybar: String(agreement.priceTinybar), nativeTx: hash, payerAccountId: from, status: 'pending' });

  let balance: bigint, deadline: number;
  try { [balance, deadline] = [await taskBalance(task), await readDeadline(task)]; }
  catch (e) { return fail(503, `Could not read the task contract; try again: ${(e as Error).message}`); }
  const instructions = fundingInstructions(task, BigInt(agreement.priceTinybar), balance);
  if (balance < BigInt(agreement.priceTinybar)) {
    return { code: 200, body: { verified: true, funded: false, ...instructions, note: 'Payment received, but the price is not covered yet' } };
  }
  if (now() >= deadline - DEADLINE_MARGIN) return fail(409, "The job's deadline has passed; your payment will be returned to you");
  try {
    await retryIdempotent(() => confirmFundingOnChain(task), async () => (await readEscrowState(task)) !== EscrowState.Created, 3);
  } catch (e) {
    return { code: 202, body: { verified: true, funded: false, error: `Payment verified; confirming it on the contract failed and will be retried: ${(e as Error).message}` } };
  }
  return { code: 200, body: { verified: true, funded: true } };
}

/** Keeper step for one open task: confirm it if it is paid, or refund it if its deadline passed. */
export async function keepTask(agreement: Agreement): Promise<void> {
  const task = agreement.escrowAddress as Address;
  const state = await readEscrowState(task);
  if (state !== EscrowState.Created && state !== EscrowState.Funded) return;
  const [submission] = await db.select({ id: schema.submissions.id }).from(schema.submissions).where(eq(schema.submissions.agreementId, agreement.id)).limit(1);
  const action = keeperAction({
    state, balanceWei: await taskBalance(task), priceWei: BigInt(agreement.priceTinybar), nowUnix: now(),
    deadlineUnix: await readDeadline(task), hasSubmission: Boolean(submission),
  });
  if (action === 'confirm') await confirmFundingOnChain(task);
  if (action === 'refund') await refundAfterDeadlineOnChain(task);
}

/** Return leftovers of settled tasks. The row is completed from the on-chain ExcessReturned event, or dropped if nothing was left. */
export async function processPendingSweeps(): Promise<void> {
  const rows = await db.select({ payment: schema.payments, agreement: schema.agreements }).from(schema.payments)
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.payments.agreementId))
    .where(and(eq(schema.payments.kind, 'excess'), eq(schema.payments.status, 'pending')));
  for (const { payment, agreement } of rows) {
    try {
      const sent = await sweepExcessOnChain(agreement.escrowAddress as Address);
      if (!sent) { await db.delete(schema.payments).where(eq(schema.payments.id, payment.id)); continue; } // nothing left
      const ev = parseEventLogs({ abi: taskEscrowAbi, logs: sent.receipt.logs, eventName: 'ExcessReturned' })[0];
      if (ev) await db.update(schema.payments).set({ status: 'confirmed', amountTinybar: ev.args.amount.toString(), txHash: sent.hash }).where(eq(schema.payments.id, payment.id));
    } catch (e) { console.error(`[keeper] sweep ${agreement.escrowAddress}: ${(e as Error).message}`); } // stays pending, retried next round
  }
}
