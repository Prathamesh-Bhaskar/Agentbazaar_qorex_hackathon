// Agent-to-agent payment on QoreChain (SPEC-qorechain R4). There is no x402 here: the lead agent sends a native QOR transfer from its own
// account, signed with a hybrid secp256k1 + ML-DSA-87 signature, then reports the tx hash to the backend, which verifies it on chain.
import { StargateClient } from '@cosmjs/stargate';
import * as sdk from '@qorechain/sdk';
import { config } from './config.js';
import type { Say } from './log.js';

export class PayError extends Error {}

const BECH32_QOR = /^qor1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/;

/** Pure spend control: a payment must go to a valid qor1 address, be positive, and never exceed the owed amount or the hard cap. */
export function checkPayment(p: { payTo: string; amountUqor: bigint; owedUqor: bigint; capUqor: bigint }): string | null {
  if (!BECH32_QOR.test(p.payTo)) return 'the payee is not a valid qor1 address';
  if (p.amountUqor <= 0n) return 'the amount is not positive';
  if (p.amountUqor > p.owedUqor) return `${p.amountUqor} uqor is more than the ${p.owedUqor} uqor owed`;
  if (p.amountUqor > p.capUqor) return `${p.amountUqor} uqor is above this agent's per-payment cap of ${p.capUqor} uqor`;
  return null;
}

const envName = (slug: string, suffix: string) => `QORE_AGENT_${slug.toUpperCase().replace(/-/g, '_')}_${suffix}`;

/** The agent's own account, from its key and PQC recovery code in .env. */
export function accountFor(slug: string): sdk.UnifiedAccount {
  const key = process.env[envName(slug, 'PRIVATE_KEY')], code = process.env[envName(slug, 'PQC_RECOVERY_CODE')];
  if (!key || !code) throw new PayError(`${envName(slug, 'PRIVATE_KEY')} and ${envName(slug, 'PQC_RECOVERY_CODE')} must be set`);
  return sdk.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ''), 'hex')), { recoveryCode: code });
}

/** Send `amountUqor` to `payTo` with a hybrid-signed native transfer. Returns the tx hash. Sequential use only (one account, one sequence). */
export async function payNative(slug: string, payTo: string, amountUqor: bigint): Promise<string> {
  const acct = accountFor(slug);
  const { restUrl, rpcUrl, cosmosChainId } = config.chain;
  const res = await fetch(`${restUrl}/cosmos/auth/v1beta1/accounts/${acct.cosmos}`, { signal: AbortSignal.timeout(15_000) });
  const a = ((await res.json()) as { account?: { account_number: string; sequence: string } }).account;
  if (!res.ok || !a) throw new PayError(`the paying account ${acct.cosmos} does not exist on chain (is it funded?)`);
  const sc = await StargateClient.connect(rpcUrl);
  try {
    // Measured 18 Nov: a hybrid MsgSend uses about 187k gas; a 300k limit at 0.15 uqor costs 45,000 uqor (the fee is charged in full).
    const r = await new sdk.EthNativeSigner(acct, { signMode: 'hybrid', rest: restUrl }).bankSend(sc, payTo, [{ denom: 'uqor', amount: amountUqor.toString() }], {
      chainId: cosmosChainId, accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence), fee: sdk.calculateFee(300_000, '0.15uqor'),
    });
    if (r.code !== 0) throw new PayError(`the transfer failed on chain (code ${r.code})`);
    return r.transactionHash;
  } finally { sc.disconnect(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tell the backend about the payment. 200 = recorded. 202/503/404 = it is still confirming or the chain is busy: ask again. Other answers are final. */
export async function reportPayment(payUrl: string, txHash: string, say: Say): Promise<boolean> {
  const pauses = [3, 5, 8, 12, 20, 30, 45, 60].map((s) => s * 1000);
  for (let i = 0; i <= pauses.length; i++) {
    try {
      const res = await fetch(payUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash }), signal: AbortSignal.timeout(60_000) });
      const body = (await res.text()).slice(0, 240);
      if (res.status === 200) return true;
      if (![202, 404, 503].includes(res.status)) { say(`the backend refused the payment report (${res.status}): ${body}`); return false; }
      say(`report not final yet (${res.status}); asking again`);
    } catch (e) { say(`could not reach the backend (${(e as Error).message}); asking again`); }
    if (i < pauses.length) await sleep(pauses[i]);
  }
  say('gave up reporting for now; the payment is safe on chain and can be reported again');
  return false;
}
