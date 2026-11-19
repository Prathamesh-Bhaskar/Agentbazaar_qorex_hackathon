// Agent A reports "I paid sub-agent B" (SPEC-qorechain R4). The backend never takes that on trust: it reads the native tx from the
// chain, checks it against the leg, and only then records the receipt on the contract. The DB leg status flips to 'paid' later,
// from the indexed PayoutRecorded event (rule 2); this function writes no money state itself.
import { and, eq } from 'drizzle-orm';
import { evmToQor } from '@qorechain/sdk';
import type { Address } from 'viem';
import { db, schema } from '../db/index.js';
import { LegStatus } from './abi.js';
import { readLegStatus, readTaskTerms, recordPayoutOnChain, retryIdempotent } from './client.js';
import { evaluatePayment, fetchNativeTx, isTxHash, normalizeTxHash, ReceiptUnavailable, weiToUqorCeil } from './payouts.js';

export type ReportResult = { code: number; body: Record<string, unknown> };
const fail = (code: number, error: string): ReportResult => ({ code, body: { error } });

/** What agent A needs to pay one sub-agent: who, how much (native uqor), and where to report the tx hash. */
export const legInstructions = (leg: { legId: number; priceTinybar: string | bigint; payeeAccountId: string }) => ({
  legId: leg.legId,
  priceWei: String(leg.priceTinybar),
  amountUqor: weiToUqorCeil(BigInt(leg.priceTinybar)).toString(),
  payTo: leg.payeeAccountId,
});

export async function reportPayout(agreementId: string, legId: number, txHashInput: string): Promise<ReportResult> {
  if (!isTxHash(txHashInput)) return fail(400, 'txHash must be a 64-character hex transaction hash');
  const hash = normalizeTxHash(txHashInput);

  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return fail(404, 'Agreement not found');
  if (agreement.status !== 'released') return fail(409, `Agreement is ${agreement.status}; sub-agents are paid only after the task is released`);
  if (!agreement.escrowAddress) return fail(409, 'Agreement has no task contract');

  const [leg] = await db.select().from(schema.subLegs).where(and(eq(schema.subLegs.agreementId, agreementId), eq(schema.subLegs.legId, legId))).limit(1);
  if (!leg) return fail(404, 'Leg not found');
  if (leg.status !== 'pending') return fail(409, `Leg is already ${leg.status}`);
  if (leg.a2aCallId) {
    const [call] = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.id, leg.a2aCallId)).limit(1);
    if (call?.status === 'failed') return fail(409, 'The sub-task for this leg was not delivered; nothing is owed');
  }
  const [payer] = await db.select().from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
  if (!payer) return fail(409, 'The lead agent no longer exists');

  // A payment that was already accepted for another leg can never be reused (also enforced by a unique index).
  const [used] = await db.select().from(schema.payments).where(and(eq(schema.payments.kind, 'a2a'), eq(schema.payments.txHash, hash))).limit(1);
  if (used && (used.agreementId !== agreementId || used.legId !== legId)) return fail(409, 'That payment was already used for another leg');

  const task = agreement.escrowAddress as Address;
  let releasedAt: number;
  try { releasedAt = (await readTaskTerms(task)).releasedAt; }
  catch (e) { return fail(503, `Could not read the task contract; try again: ${(e as Error).message}`); }

  let tx;
  try { tx = await fetchNativeTx(hash); }
  catch (e) { return fail(503, e instanceof ReceiptUnavailable ? `${e.message}; try again` : (e as Error).message); }
  if (!tx) return fail(404, 'That transaction was not found on QoreChain (it may still be confirming; try again shortly)');

  const check = evaluatePayment(tx, {
    from: evmToQor(payer.payoutAddress), to: leg.payeeAccountId, minUqor: weiToUqorCeil(BigInt(leg.priceTinybar)), notBeforeUnix: releasedAt,
  });
  if (!check.ok) return fail(422, `Payment not accepted: ${check.reason}`);

  if (!used) {
    try {
      await db.insert(schema.payments).values({
        agreementId, kind: 'a2a', amountTinybar: String(leg.priceTinybar), txHash: hash, legId, payerAccountId: evmToQor(payer.payoutAddress), status: 'confirmed',
      });
    } catch { return fail(409, 'That payment was already used for another leg'); }
  }

  // Record the receipt on the contract. If the chain call fails the payment stays verified and the caller may simply repeat this request.
  try {
    await retryIdempotent(() => recordPayoutOnChain(task, legId, hash), async () => (await readLegStatus(task, legId)) !== LegStatus.Pending, 4);
  } catch (e) {
    return { code: 202, body: { verified: true, recorded: false, paidUqor: check.paidUqor.toString(), error: `Payment verified, but recording it on the contract failed: ${(e as Error).message}. Repeat this request.` } };
  }
  return { code: 200, body: { verified: true, recorded: true, payoutRef: hash, paidUqor: check.paidUqor.toString() } };
}
