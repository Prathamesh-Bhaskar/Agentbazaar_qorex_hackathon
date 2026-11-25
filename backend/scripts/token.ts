// Prints a login token for Postman or scripts. It signs the sign-in text the way QoreX does (hybrid secp256k1 + ML-DSA-87), with one
// of the test accounts in backend/.env (it needs a registered PQC key).
// Usage:  npm run token                                  (account QORE_AGENT_TEST_WRITER_*)
//         ACCOUNT=OPERATOR npm run token                 (any QORE_<ACCOUNT>_PRIVATE_KEY / _PQC_RECOVERY_CODE pair)
// Then paste the token into the Postman collection variable `token`.
import 'dotenv/config';
import { unifiedAccountFromSeed } from '@qorechain/sdk';
import { classicalKeyFromPrivate, signMessage } from '@qorechain/qoresign';

const API = process.env.API_URL ?? 'http://localhost:4000';
const label = process.env.ACCOUNT ?? 'AGENT_TEST_WRITER';
const key = process.env[`QORE_${label}_PRIVATE_KEY`], code = process.env[`QORE_${label}_PQC_RECOVERY_CODE`];
if (!key || !code) throw new Error(`QORE_${label}_PRIVATE_KEY and QORE_${label}_PQC_RECOVERY_CODE must be set in backend/.env`);
const secret = Uint8Array.from(Buffer.from(key.replace(/^0x/, ''), 'hex'));
const account = unifiedAccountFromSeed(secret, { recoveryCode: code });
if (!account.pqc) throw new Error('no post-quantum key for this account');

const post = async (path: string, body: unknown) => {
  const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
};

const { nonce, message } = await post('/auth/nonce', { address: account.cosmos });
const signature = signMessage({ chainId: process.env.QORE_COSMOS_CHAIN_ID ?? 'qorechain-diana', signer: account.cosmos, data: message, classicalKey: classicalKeyFromPrivate(secret, 'eth_secp256k1'), pqKey: account.pqc });
const { token, expiresAt } = await post('/auth/verify', { address: account.cosmos, nonce, signature });
console.log(`account: ${account.cosmos}\nexpires: ${expiresAt}\ntoken:   ${token}`);
