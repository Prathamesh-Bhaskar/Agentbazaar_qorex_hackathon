// Open an EVM authorisation window for one of the accounts in backend/.env (hybrid-signed, via @qorechain/sdk).
// Usage (from backend/): node scripts/qore/open-window.mjs <LABEL> <maxTxs> <maxValueUqor> [blocks]
//   LABEL is the .env prefix: OPERATOR, DESIGNER, AGENT_SOLIDITY_DEV, ... (QORE_<LABEL>_PRIVATE_KEY / _PQC_RECOVERY_CODE)
// Example: node scripts/qore/open-window.mjs OPERATOR 20 50000000
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StargateClient } from '@cosmjs/stargate';
import * as S from '@qorechain/sdk';

const env = Object.fromEntries(fs.readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8')
  .split('\n').filter((l) => /^[A-Za-z_0-9]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
const [label, txs, valueUqor, blocks = '17280'] = process.argv.slice(2);
if (!label || !txs || !valueUqor) { console.error('usage: open-window.mjs <LABEL> <maxTxs> <maxValueUqor> [blocks]'); process.exit(1); }
const key = env[`QORE_${label}_PRIVATE_KEY`], rec = env[`QORE_${label}_PQC_RECOVERY_CODE`];
if (!key || !rec) { console.error(`QORE_${label}_PRIVATE_KEY / _PQC_RECOVERY_CODE missing in backend/.env`); process.exit(1); }

const acct = S.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ''), 'hex')), { recoveryCode: rec });
const { rest, rpc } = S.createClient().network.endpoints;
const chainId = 'qorechain-diana';
const sc = await StargateClient.connect(rpc);
const acc = (await (await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${acct.cosmos}`)).json()).account;
const signer = new S.EthNativeSigner(acct, { signMode: 'hybrid', rest });
const r = await signer.signAndBroadcast(sc, {
  chainId, accountNumber: BigInt(acc.account_number), sequence: BigInt(acc.sequence), fee: S.calculateFee(600000, '0.2uqor'),
  messages: [S.openEvmWindowMsg({ sender: acct.cosmos, blocks: Number(blocks), maxTxs: Number(txs), maxValue: valueUqor })],
});
const w = await S.fetchEvmWindow({ rest, address: acct.cosmos });
console.log(`${label} (${acct.evm}) open-window code ${r.code} ${r.transactionHash}`);
console.log(`live=${w.live} txs=${w.remainingTxs} value_uqor=${w.remainingValue} blocks=${w.remainingBlocks}`);
