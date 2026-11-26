// Publishes an account's QoreSeal (ML-KEM-1024) encryption key on chain, so others can encrypt data to it (safe to re-run).
//   1. creates the 32-byte seal seed if backend/.env has none, and appends it; an existing value is never changed
//   2. registers the public key (hybrid-signed MsgRegisterKEMKey) unless the same key is already on chain
//   3. reads the key back, and seals a test message to the on-chain key that only the local seed can open
// Run from backend/: npx tsx scripts/qore/register-seal-key.ts [LABEL]   (default OPERATOR; ENV_FILE=path for another file)
// The account needs a registered post-quantum key (npm run setup:accounts). Back up .env: the seed cannot be re-derived.
import fs from 'node:fs';
import path from 'node:path';
import { StargateClient } from '@cosmjs/stargate';
import * as sdk from '@qorechain/sdk';
import { generateSealKeys, open, seal, sealKeysFromSeed, toHex } from '@qorechain/qoreseal';
import * as dotenv from 'dotenv';

const label = process.argv[2] ?? 'OPERATOR';
const file = path.resolve(process.env.ENV_FILE ?? '.env');
const read = () => dotenv.parse(fs.readFileSync(file));
let values = read();
const key = values[`QORE_${label}_PRIVATE_KEY`], code = values[`QORE_${label}_PQC_RECOVERY_CODE`];
if (!key || !code) throw new Error(`QORE_${label}_PRIVATE_KEY / _PQC_RECOVERY_CODE missing in ${path.basename(file)}`);

const seedName = `QORE_${label}_SEAL_SEED`;
if (!values[seedName]) {
  const current = fs.readFileSync(file, 'utf8');
  const line = `${seedName}=${toHex(generateSealKeys().seed)}`;
  const empty = new RegExp(`^${seedName}=[ \\t]*$`, 'm');
  fs.writeFileSync(file, empty.test(current) ? current.replace(empty, line) : `${current}${current.endsWith('\n') ? '' : '\n'}${line}\n`, { mode: 0o600 });
  console.log(`added ${seedName} to ${path.basename(file)}`);
  values = read();
}
const keys = sealKeysFromSeed(Uint8Array.from(Buffer.from(values[seedName]!, 'hex')));
const account = sdk.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ''), 'hex')), { recoveryCode: code });
const { rest, rpc } = sdk.createClient().network.endpoints;
const published = async () => {
  const found = await sdk.fetchKemKey({ rest: rest!, address: account.cosmos });
  return found.found ? found.key! : undefined;
};
const same = (a: Uint8Array) => Buffer.from(a).equals(Buffer.from(keys.mlkemPublicKey));

let onChain = await published();
if (onChain && same(onChain.publicKey)) console.log('this key is already published; nothing sent');
else {
  const chainId = 'qorechain-diana';
  const client = await StargateClient.connect(rpc!);
  const acc = ((await (await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${account.cosmos}`)).json()) as { account: { account_number: string; sequence: string } }).account;
  const result = await new sdk.EthNativeSigner(account, { signMode: 'hybrid', rest }).signAndBroadcast(client, {
    chainId, accountNumber: BigInt(acc.account_number), sequence: BigInt(acc.sequence), fee: sdk.calculateFee(600_000, '0.2uqor'),
    messages: [sdk.msg.pqc.registerKemKey({ sender: account.cosmos, algorithmId: sdk.KEM_ALGORITHM_ML_KEM_1024, publicKey: keys.mlkemPublicKey })],
  });
  if (result.code !== 0) throw new Error(`registration refused: code ${result.code} ${result.transactionHash}`);
  console.log(`registered, tx ${result.transactionHash}`);
  for (let i = 0; i < 20 && !(onChain && same(onChain.publicKey)); i++) {
    await new Promise((r) => setTimeout(r, 1500));
    onChain = await published();
  }
}
if (!onChain || !same(onChain.publicKey)) throw new Error('the chain does not show this key');

// Round trip: encrypt to the key as read from the chain, decrypt with the local seed.
const text = new TextEncoder().encode('AgentBazaar seal check');
const context = { chainId: 'qorechain-diana', purpose: 'key-check' };
const envelope = seal({ ...context, mode: 'mlkem', recipients: [{ mlkemPublicKey: onChain.publicKey }], plaintext: text });
if (!Buffer.from(open({ ...context, envelope, keys })).equals(Buffer.from(text))) throw new Error('the seed cannot open data sealed to the on-chain key');
console.log(`${label} ${account.cosmos}: ML-KEM-1024 key on chain (${onChain.publicKey.length} bytes), seal and open check passed`);
process.exit(0);
