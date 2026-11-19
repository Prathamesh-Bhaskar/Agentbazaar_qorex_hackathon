// Verifies, on chain, that agent A really paid a sub-agent (SPEC-qorechain R4). QoreChain has no x402 scheme: A sends a native
// QOR transfer signed with a hybrid secp256k1 + ML-DSA-87 signature, then reports the tx hash. We read the receipt from the chain
// and accept it only if it matches the leg exactly; nothing a caller says is trusted.
import { env } from '../env.js';
import { WEI_PER_UQOR } from './window.js';

export const MSG_SEND = '/cosmos.bank.v1beta1.MsgSend';
export const PQC_HYBRID_EXTENSION = '/qorechain.pqc.v1.PQCHybridSignature';
const ALGO_DILITHIUM5 = 1; // ML-DSA-87

/** A leg price is in wei (18 decimals); the native lane counts uqor (6 decimals). Round up so a sub-agent is never underpaid. */
export const weiToUqorCeil = (wei: bigint): bigint => (wei + WEI_PER_UQOR - 1n) / WEI_PER_UQOR;

/** The payout reference stored on the contract: the native tx hash as the explorer shows it (upper-case hex, no 0x). */
export const normalizeTxHash = (h: string): string => h.trim().replace(/^0x/i, '').toUpperCase();
export const isTxHash = (h: string): boolean => /^(0x)?[0-9a-fA-F]{64}$/.test(h.trim());

type Msg = { '@type'?: string; from_address?: string; to_address?: string; amount?: { denom: string; amount: string }[] };
type Ext = { '@type'?: string; algorithm_id?: number | string };
export type NativeTx = {
  tx: { body: { messages: Msg[]; extension_options?: Ext[]; non_critical_extension_options?: Ext[] } };
  tx_response: { code: number; height: string; timestamp: string; txhash: string; raw_log?: string };
};

export type PaymentExpectation = { from: string; to: string; minUqor: bigint; notBeforeUnix: number };
export type PaymentCheck = { ok: true; paidUqor: bigint; height: bigint; timeUnix: number } | { ok: false; reason: string };

/** Pure: decide whether a native tx is the payment a leg is owed. */
export function evaluatePayment(tx: NativeTx, want: PaymentExpectation): PaymentCheck {
  const res = tx.tx_response;
  if (res.code !== 0) return { ok: false, reason: `the transaction failed on chain (code ${res.code})` };

  let paid = 0n;
  for (const m of tx.tx.body.messages) {
    if (m['@type'] !== MSG_SEND || m.from_address !== want.from || m.to_address !== want.to) continue;
    for (const c of m.amount ?? []) if (c.denom === 'uqor' && /^\d+$/.test(c.amount)) paid += BigInt(c.amount);
  }
  if (paid === 0n) return { ok: false, reason: 'no QOR transfer from the lead agent to this sub-agent in that transaction' };
  if (paid < want.minUqor) return { ok: false, reason: `paid ${paid} uqor but ${want.minUqor} uqor is owed` };

  // Every native tx on QoreChain must be hybrid-signed; we still check, because this is the post-quantum claim of the product.
  const exts = [...(tx.tx.body.extension_options ?? []), ...(tx.tx.body.non_critical_extension_options ?? [])];
  const hybrid = exts.some((e) => e['@type'] === PQC_HYBRID_EXTENSION && Number(e.algorithm_id) === ALGO_DILITHIUM5);
  if (!hybrid) return { ok: false, reason: 'the payment is not signed with ML-DSA-87 (no hybrid signature extension)' };

  const timeUnix = Math.floor(Date.parse(res.timestamp) / 1000);
  if (!Number.isFinite(timeUnix)) return { ok: false, reason: 'the receipt has no usable timestamp' };
  if (timeUnix < want.notBeforeUnix) return { ok: false, reason: 'that payment was made before the task was released' };

  return { ok: true, paidUqor: paid, height: BigInt(res.height), timeUnix };
}

/** The chain could not be asked (network, rate limit, 5xx). An infrastructure problem: the caller retries, nobody is blamed. */
export class ReceiptUnavailable extends Error {}

/** Read a native tx by hash from the REST API. Returns null when the chain says it does not exist (yet). */
export async function fetchNativeTx(hash: string): Promise<NativeTx | null> {
  let res: Response;
  try {
    res = await fetch(`${env.QORE_REST_URL}/cosmos/tx/v1beta1/txs/${normalizeTxHash(hash)}`, { signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new ReceiptUnavailable(`could not reach the QoreChain REST API: ${(e as Error).message}`);
  }
  if (res.status === 404 || res.status === 400) return null; // Cosmos answers "tx not found" with 404 or 400 depending on the node
  if (!res.ok) throw new ReceiptUnavailable(`QoreChain REST API answered ${res.status}`);
  const body = (await res.json()) as Partial<NativeTx>;
  if (!body.tx || !body.tx_response) throw new ReceiptUnavailable('unexpected receipt shape from the REST API');
  return body as NativeTx;
}
