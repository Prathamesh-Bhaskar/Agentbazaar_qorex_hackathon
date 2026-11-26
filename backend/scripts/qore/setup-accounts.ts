// Prepares the project's testnet accounts in backend/.env (safe to re-run):
//   1. creates any missing key (and post-quantum recovery code) and appends it to the file; existing values are never changed
//   2. prints each address and balance
//   3. registers the ML-DSA-87 key of every funded account that sends transactions and has none registered yet
// Run from backend/: npm run setup:accounts        (ENV_FILE=path to use another file)
// Fund the printed addresses at https://dashboard.qorechain.io/faucet, then run it again. Back up .env: the recovery codes
// cannot be re-derived. Testnet only.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { generatePqcRecoveryCode, unifiedAccountFromSeed } from '@qorechain/sdk';

const file = path.resolve(process.env.ENV_FILE ?? '.env');
// `sends`: the account signs transactions, so it needs a registered post-quantum key. The verifier only signs verdicts.
const ACCOUNTS = [
  { label: 'OPERATOR', sends: true, role: 'relayer and factory owner' },
  { label: 'DESIGNER', sends: true, role: 'deploys each job contract' },
  { label: 'VERIFIER', sends: false, role: 'signs verdicts, needs no funds' },
  ...['SOLIDITY_DEV', 'SECURITY_AUDITOR', 'TEST_WRITER', 'DOCS_WRITER', 'DAPP_DEV'].map((s) => ({ label: `AGENT_${s}`, sends: true, role: 'live agent' })),
];

const read = () => (fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {});
let values = read();
const added: string[] = [];
const append = (name: string, value: string) => {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  // An empty "NAME=" line (as in .env.example) is filled in place; otherwise the value is appended.
  const empty = new RegExp(`^${name}=\\s*$`, 'm');
  const next = empty.test(current) ? current.replace(empty, `${name}=${value}`) : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${name}=${value}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  added.push(name);
};
for (const a of ACCOUNTS) {
  if (!values[`QORE_${a.label}_PRIVATE_KEY`]) append(`QORE_${a.label}_PRIVATE_KEY`, randomBytes(32).toString('hex'));
  if (a.sends && !values[`QORE_${a.label}_PQC_RECOVERY_CODE`]) append(`QORE_${a.label}_PQC_RECOVERY_CODE`, generatePqcRecoveryCode());
}
values = read();
console.log(added.length ? `added to ${path.basename(file)}: ${added.join(', ')}` : 'all keys already present; the file was not changed');

// The chain module reads its settings from the environment, so load the file before importing it.
for (const [k, v] of Object.entries(values)) process.env[k] ??= v;
process.env.DATABASE_URL ||= 'postgres://not-used-by-this-script';
const { publicClient } = await import('../../src/chain/client.js');
const { QoreIdentity } = await import('../../src/chain/window.js');
const { formatEther } = await import('viem');

let waiting = 0;
for (const a of ACCOUNTS) {
  const key = values[`QORE_${a.label}_PRIVATE_KEY`]!;
  const code = values[`QORE_${a.label}_PQC_RECOVERY_CODE`];
  const acct = unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.replace(/^0x/, ''), 'hex')), { recoveryCode: code ?? generatePqcRecoveryCode() });
  const balance = await publicClient.getBalance({ address: acct.evm as `0x${string}` });
  let note = '';
  if (a.sends) {
    if (balance === 0n) { note = 'fund it, then run again'; waiting++; }
    else {
      try { await new QoreIdentity(a.label, key, code).ensureRegistered(); note = 'post-quantum key registered'; }
      catch (e) { note = `registration failed: ${(e as Error).message}`; waiting++; }
    }
  }
  console.log(`${a.label.padEnd(24)} ${acct.evm}  ${acct.cosmos}  ${formatEther(balance).slice(0, 8).padStart(8)} QOR  ${note || a.role}`);
}
console.log(waiting ? `\n${waiting} account(s) still need attention (suggested: operator 20 QOR, designer 10, each agent 5).` : '\nAll accounts are ready.');
process.exit(0);
