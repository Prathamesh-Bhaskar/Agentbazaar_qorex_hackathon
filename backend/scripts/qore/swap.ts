// Swaps a small amount of test QOR in a QoreChain AMM pool (hybrid-signed MsgSwapExactIn). Not part of the job flow.
// Run from backend/: npx tsx scripts/qore/swap.ts <poolId> <amountUqor> [LABEL]   (default OPERATOR; ENV_FILE for another file)
// Example: npx tsx scripts/qore/swap.ts 2 100000
// Refuses to send if the pool does not hold QOR; asks the chain for at least 98% of the constant-product quote.
import fs from 'node:fs';
import path from 'node:path';
import { StargateClient } from '@cosmjs/stargate';
import * as sdk from '@qorechain/sdk';
import * as dotenv from 'dotenv';

const [poolId, amountText, label = 'OPERATOR'] = process.argv.slice(2);
if (!poolId || !/^[1-9]\d*$/.test(amountText ?? '')) { console.error('usage: swap.ts <poolId> <amountUqor> [LABEL]'); process.exit(1); }
const amount = BigInt(amountText!);
const values = dotenv.parse(fs.readFileSync(path.resolve(process.env.ENV_FILE ?? '.env')));
const key = values[`QORE_${label}_PRIVATE_KEY`], code = values[`QORE_${label}_PQC_RECOVERY_CODE`];
if (!key || !code) throw new Error(`QORE_${label}_PRIVATE_KEY / _PQC_RECOVERY_CODE missing`);

const account = sdk.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ''), 'hex')), { recoveryCode: code });
const { rest, rpc } = sdk.createClient().network.endpoints;
const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(rest + url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
};
const { pool } = await get<{ pool: { pool_type: string; status: string; token_a: string; token_b: string; reserve_a: string; reserve_b: string } }>(`/qorechain/amm/v1/pools/${poolId}`);
const { params } = await get<{ params: { swap_fee_bps: number } }>('/qorechain/amm/v1/params');
if (pool.pool_type !== 'constant_product' || pool.status !== 'active') throw new Error(`pool ${poolId} is ${pool.pool_type}, ${pool.status}`);
if (pool.token_a !== 'uqor' && pool.token_b !== 'uqor') throw new Error(`pool ${poolId} does not hold QOR`);
const qorIsA = pool.token_a === 'uqor';
const denomOut = qorIsA ? pool.token_b : pool.token_a;
const reserveIn = BigInt(qorIsA ? pool.reserve_a : pool.reserve_b), reserveOut = BigInt(qorIsA ? pool.reserve_b : pool.reserve_a);
const afterFee = amount * (10_000n - BigInt(params.swap_fee_bps));
const quote = (reserveOut * afterFee) / (reserveIn * 10_000n + afterFee);
const minOut = (quote * 98n) / 100n;
if (minOut <= 0n) throw new Error('amount too small to receive anything');

const balance = async (denom: string) => {
  const { balances } = await get<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${account.cosmos}`);
  return BigInt(balances.find((b) => b.denom === denom)?.amount ?? '0');
};
const before = await balance(denomOut);
console.log(`pool ${poolId}: ${amount} uqor -> about ${quote} of ${denomOut} (at least ${minOut})`);
const client = await StargateClient.connect(rpc!);
const { account: acc } = await get<{ account: { account_number: string; sequence: string } }>(`/cosmos/auth/v1beta1/accounts/${account.cosmos}`);
const result = await new sdk.EthNativeSigner(account, { signMode: 'hybrid', rest }).signAndBroadcast(client, {
  chainId: 'qorechain-diana', accountNumber: BigInt(acc.account_number), sequence: BigInt(acc.sequence), fee: sdk.calculateFee(600_000, '0.2uqor'),
  messages: [sdk.msg.amm.swapExactIn({ sender: account.cosmos, poolId: poolId!, tokenIn: { denom: 'uqor', amount: amount.toString() }, denomOut, minOut: minOut.toString() })],
});
if (result.code !== 0) throw new Error(`swap refused: code ${result.code} ${result.transactionHash}`);
let received = 0n;
for (let i = 0; i < 20 && received === 0n; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  received = (await balance(denomOut)) - before;
}
if (received < minOut) throw new Error(`tx ${result.transactionHash} succeeded but the balance shows ${received}`);
console.log(`swapped, tx ${result.transactionHash}: received ${received} of ${denomOut}`);
process.exit(0);
