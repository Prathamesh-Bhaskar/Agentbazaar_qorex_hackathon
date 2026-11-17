// On-chain smoke test for the escrow on QoreChain testnet: create via the factory, fund, submit, release.
// Needs backend/.env (operator, designer, verifier, agent keys) and a live EVM window for the operator and the designer
// (see docs/SPEC-qorechain.md R3). Run from backend/: node scripts/qore/smoke.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes, parseEther, formatEther, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
const env = Object.fromEntries(fs.readFileSync(fileURLToPath(new URL('../../.env', import.meta.url)),'utf8').split('\n').filter(l=>/^[A-Za-z_0-9]+=/.test(l)).map(l=>[l.split('=')[0], l.slice(l.indexOf('=')+1)]));
const chain = defineChain({ id: 9800, name: 'QoreChain Diana', nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 }, rpcUrls: { default: { http: ['https://evm-testnet.qore.host'] } } });
const pub = createPublicClient({ chain, transport: http() });
const acc = (l) => privateKeyToAccount('0x' + env[`QORE_${l}_PRIVATE_KEY`].replace(/^0x/,''));
const wallet = (a) => createWalletClient({ account: a, chain, transport: http() });
const operator = acc('OPERATOR'), designer = acc('DESIGNER'), verifier = acc('VERIFIER'), agent = acc('AGENT_SOLIDITY_DEV');
const FACTORY = '0x83CD43960C3634bfCc63D22C971Aa2f9c8477719';
const abi = parseAbi([
 'function createTask(bytes32 agreementId,address client,address agent,uint256 price,uint64 deadline,uint16 maxSubBps,uint8 maxSubLegs,uint32 payoutGrace,bytes32 termsHash) returns (address)',
 'function taskOf(bytes32) view returns (address)',
 'function fund() payable', 'function submit(bytes32)', 'function release(uint256,bytes)', 'function state() view returns (uint8)',
]);
const gasPrice = await pub.getGasPrice();
const send = async (w, p) => { const h = await w.writeContract({ ...p, type: 'legacy', gasPrice }); const r = await pub.waitForTransactionReceipt({ hash: h, timeout: 60000 }); console.log(p.functionName.padEnd(11), r.status, 'gas', String(r.gasUsed), h.slice(0,14)+'…'); if (r.status !== 'success') throw new Error('reverted ' + p.functionName); return r; };
const aid = keccak256(toBytes('smoke-' + Date.now()));
const price = parseEther('1');
const before = await pub.getBalance({ address: agent.address });
await send(wallet(designer), { address: FACTORY, abi, functionName: 'createTask', args: [aid, operator.address, agent.address, price, BigInt(Math.floor(Date.now()/1000) + 86400), 3000, 2, 3600, keccak256(toBytes('terms'))], gas: 3_000_000n });
const task = await pub.readContract({ address: FACTORY, abi, functionName: 'taskOf', args: [aid] });
console.log('task contract', task);
await send(wallet(operator), { address: task, abi, functionName: 'fund', args: [], value: price, gas: 200_000n });
await send(wallet(operator), { address: task, abi, functionName: 'submit', args: [keccak256(toBytes('work'))], gas: 200_000n });
const nonce = BigInt(Date.now());
const sig = await verifier.signTypedData({ domain: { name: 'AgentForge', version: '1', chainId: 9800, verifyingContract: task }, types: { Verdict: [{ name: 'agreementId', type: 'bytes32' }, { name: 'result', type: 'uint8' }, { name: 'nonce', type: 'uint256' }] }, primaryType: 'Verdict', message: { agreementId: aid, result: 1, nonce } });
await send(wallet(operator), { address: task, abi, functionName: 'release', args: [nonce, sig], gas: 300_000n });
const after = await pub.getBalance({ address: agent.address });
console.log('state', await pub.readContract({ address: task, abi, functionName: 'state' }), '(3 = Released)');
console.log('agent received', formatEther(after - before), 'QOR');
