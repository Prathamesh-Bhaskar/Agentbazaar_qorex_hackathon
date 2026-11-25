// On-chain smoke test for the escrow on QoreChain testnet, following the web app's funding path (spec A1):
// create via the factory, pay by native hybrid transfer (slightly over the price), confirmFunding, submit, release, sweepExcess.
// Needs backend/.env (operator, designer, verifier, agent keys) and a live EVM window for the operator and the designer
// (scripts/qore/open-window.mjs). The operator doubles as the paying client. Run from backend/: node scripts/qore/smoke.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes, parseEther, formatEther, parseAbi, parseEventLogs } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { StargateClient } from '@cosmjs/stargate';
import * as sdk from '@qorechain/sdk';

const env = Object.fromEntries(fs.readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)), 'utf8').split('\n').filter((l) => /^[A-Za-z_0-9]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
const chain = defineChain({ id: 9800, name: 'QoreChain Diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: ['https://evm-testnet.qore.host'] } } });
const pub = createPublicClient({ chain, transport: http() });
const hex = (l) => env[`QORE_${l}_PRIVATE_KEY`].replace(/^0x/, '');
const acc = (l) => privateKeyToAccount(`0x${hex(l)}`);
const wallet = (a) => createWalletClient({ account: a, chain, transport: http() });
const operator = acc('OPERATOR'), designer = acc('DESIGNER'), verifier = acc('VERIFIER'), agent = acc('AGENT_SOLIDITY_DEV');
const FACTORY = env.TASK_FACTORY_ADDRESS;
const abi = parseAbi([
  'function createTask(bytes32 agreementId,address client,address agent,uint256 price,uint64 deadline,uint16 maxSubBps,uint8 maxSubLegs,uint32 payoutGrace,bytes32 termsHash) returns (address)',
  'function taskOf(bytes32) view returns (address)', 'function confirmFunding()', 'function submit(bytes32)', 'function release(uint256,bytes)',
  'function sweepExcess()', 'function state() view returns (uint8)', 'event ExcessReturned(bytes32 indexed agreementId, address client, uint256 amount)',
]);
const gasPrice = await pub.getGasPrice();
const send = async (w, p) => {
  const h = await w.writeContract({ ...p, type: 'legacy', gasPrice });
  const r = await pub.waitForTransactionReceipt({ hash: h, timeout: 60000 });
  console.log(p.functionName.padEnd(15), r.status, 'gas', String(r.gasUsed), `${h.slice(0, 14)}…`);
  if (r.status !== 'success') throw new Error(`reverted ${p.functionName}`);
  return r;
};
const expect = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) process.exitCode = 1; };

const aid = keccak256(toBytes(`smoke-${Date.now()}`));
const price = parseEther('0.2');
await send(wallet(designer), { address: FACTORY, abi, functionName: 'createTask', args: [aid, operator.address, agent.address, price, BigInt(Math.floor(Date.now() / 1000) + 86400), 3000, 2, 3600, keccak256(toBytes('terms'))], gas: 2_500_000n });
const task = await pub.readContract({ address: FACTORY, abi, functionName: 'taskOf', args: [aid] });
console.log('task contract', task);

// 1. pay 0.21 QOR (0.01 too much) with a native hybrid-signed transfer, as the QoreX web path does
const payer = sdk.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(hex('OPERATOR'), 'hex')), { recoveryCode: env.QORE_OPERATOR_PQC_RECOVERY_CODE });
const { rest, rpc } = sdk.createClient().network.endpoints;
const sc = await StargateClient.connect(rpc);
const a = (await (await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${payer.cosmos}`)).json()).account;
const r = await new sdk.EthNativeSigner(payer, { signMode: 'hybrid', rest }).bankSend(sc, sdk.evmToQor(task), [{ denom: 'uqor', amount: '210000' }], { chainId: 'qorechain-diana', accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence), fee: sdk.calculateFee(300_000, '0.15uqor') });
console.log('native transfer', r.code === 0 ? 'success' : `code ${r.code}`, `${r.transactionHash.slice(0, 14)}…`);
expect((await pub.getBalance({ address: task })) === parseEther('0.21'), 'contract holds 0.21 QOR after the native transfer');

// 2. confirm, submit, release
await send(wallet(operator), { address: task, abi, functionName: 'confirmFunding', args: [], gas: 200_000n });
await send(wallet(operator), { address: task, abi, functionName: 'submit', args: [keccak256(toBytes('work'))], gas: 200_000n });
const nonce = BigInt(Date.now());
const sig = await verifier.signTypedData({ domain: { name: 'AgentForge', version: '1', chainId: 9800, verifyingContract: task }, types: { Verdict: [{ name: 'agreementId', type: 'bytes32' }, { name: 'result', type: 'uint8' }, { name: 'nonce', type: 'uint256' }] }, primaryType: 'Verdict', message: { agreementId: aid, result: 1, nonce } });
const before = await pub.getBalance({ address: agent.address });
await send(wallet(operator), { address: task, abi, functionName: 'release', args: [nonce, sig], gas: 300_000n });
expect((await pub.getBalance({ address: agent.address })) - before === price, 'agent received exactly the 0.2 QOR price');
expect((await pub.getBalance({ address: task })) === parseEther('0.01'), 'the 0.01 QOR excess is still in the contract');

// 3. return the excess
const swept = await send(wallet(operator), { address: task, abi, functionName: 'sweepExcess', args: [], gas: 200_000n });
const ev = parseEventLogs({ abi, logs: swept.logs, eventName: 'ExcessReturned' })[0];
expect(ev?.args.client.toLowerCase() === operator.address.toLowerCase() && ev.args.amount === parseEther('0.01'), `ExcessReturned ${ev ? formatEther(ev.args.amount) : '?'} QOR to the client`);
expect((await pub.getBalance({ address: task })) === 0n, 'contract is empty');
expect((await pub.readContract({ address: task, abi, functionName: 'state' })) === 3, 'state is Released');
sc.disconnect();
