import { eq, inArray } from 'drizzle-orm';
import { createWalletClient, http, keccak256, toBytes, parseAbi, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { StargateClient } from '@cosmjs/stargate';
import * as sdk from '@qorechain/sdk';
import { db, schema as S } from './src/db/index.ts';
import { env } from './src/env.ts';
import { agreementIdBytes, publicClient, qorechainTestnet, releaseOnChain, signVerdict, submitOnChain, readEscrowState } from './src/chain/client.ts';
import { costUqor, QoreIdentity } from './src/chain/window.ts';

const API = `http://localhost:${env.PORT}`;
const raw = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} missing`); return v; };
const hex = (l: string) => raw(`QORE_${l}_PRIVATE_KEY`).replace(/^0x/, '');
const addr = (l: string) => privateKeyToAccount(`0x${hex(l)}`).address;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FACTORY = raw('TASK_FACTORY_ADDRESS') as `0x${string}`;
const factory = parseAbi(['function createTask(bytes32,address,address,uint256,uint64,uint16,uint8,uint32,bytes32) returns (address)', 'function taskOf(bytes32) view returns (address)']);
const CLIENT = 'AGENT_TEST_WRITER', OTHER = 'AGENT_DOCS_WRITER', LEAD = 'AGENT_SOLIDITY_DEV'; // test accounts with their own PQC keys
const PRICE = parseEther('0.2');
let failures = 0;
const expect = (ok: unknown, what: string) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) failures++; };
const step = (s: string) => console.log('\n== ' + s);

for (let i = 0; ; i++) { try { if ((await fetch(`${API}/health`)).ok) break; } catch {} if (i > 30) throw new Error('backend not up'); await sleep(1000); }
const designer = new QoreIdentity('designer', raw('QORE_DESIGNER_PRIVATE_KEY'), raw('QORE_DESIGNER_PQC_RECOVERY_CODE'));
const dW = createWalletClient({ account: privateKeyToAccount(`0x${hex('DESIGNER')}`), chain: qorechainTestnet, transport: http(env.QORE_EVM_RPC_URL) });
const sc = await StargateClient.connect(env.QORE_RPC_URL);
async function pay(label: string, task: string, uqor: bigint) {
  const a = sdk.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(hex(label), 'hex')), { recoveryCode: raw(`QORE_${label}_PQC_RECOVERY_CODE`) });
  const acc = (await (await fetch(`${env.QORE_REST_URL}/cosmos/auth/v1beta1/accounts/${a.cosmos}`)).json()).account;
  const r = await new sdk.EthNativeSigner(a, { signMode: 'hybrid', rest: env.QORE_REST_URL }).bankSend(sc, sdk.evmToQor(task), [{ denom: 'uqor', amount: uqor.toString() }], { chainId: env.QORE_COSMOS_CHAIN_ID, accountNumber: BigInt(acc.account_number), sequence: BigInt(acc.sequence), fee: sdk.calculateFee(300_000, '0.15uqor') });
  if (r.code !== 0) throw new Error(`payment failed ${r.code}`);
  return r.transactionHash;
}
const post = async (id: string, txHash: string) => { for (let i = 0; i < 6; i++) { const r = await fetch(`${API}/agreements/${id}/funding`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txHash }) }); const body = await r.json(); if (r.status === 404 && /not found on QoreChain/.test(body.error)) { await sleep(2000); continue; } return { code: r.status, body }; } throw new Error('tx never appeared'); };

const [client] = await db.insert(S.users).values({ address: addr(CLIENT).toLowerCase() }).onConflictDoNothing().returning();
const clientRow = client ?? (await db.select().from(S.users).where(eq(S.users.address, addr(CLIENT).toLowerCase())))[0];
const [owner] = await db.insert(S.users).values({ address: '0xe2efund-owner' }).returning();
const [agent] = await db.insert(S.agents).values({ ownerUserId: owner.id, name: 'Fixture agent', description: 'no endpoint', payoutAddress: addr(LEAD), apiKeyHash: 'x' }).returning();
const made: { agr: string; req: string; quote: string; task: string }[] = [];
async function job(name: string, deadlineSecs: number) {
  await designer.ensureWindow(costUqor(2_500_000n, (await publicClient.getGasPrice()) * 2n));
  const id = crypto.randomUUID();
  const h = await dW.writeContract({ address: FACTORY, abi: factory, functionName: 'createTask', args: [agreementIdBytes(id), addr(CLIENT), addr(LEAD), PRICE, BigInt(Math.floor(Date.now() / 1000) + deadlineSecs), 3000, 2, 3600, keccak256(toBytes('t'))], gas: 2_500_000n, type: 'legacy', gasPrice: await publicClient.getGasPrice() } as never);
  const rc = await publicClient.waitForTransactionReceipt({ hash: h });
  const task = ((await publicClient.readContract({ address: FACTORY, abi: factory, functionName: 'taskOf', args: [agreementIdBytes(id)] })) as string).toLowerCase();
  const [req] = await db.insert(S.requests).values({ clientUserId: clientRow.id, title: name, requirements: 'funding test', budgetTinybar: String(PRICE) }).returning();
  const [quote] = await db.insert(S.quotes).values({ requestId: req.id, agentId: agent.id, priceTinybar: String(PRICE) }).returning();
  await db.insert(S.agreements).values({ id, requestId: req.id, quoteId: quote.id, clientUserId: clientRow.id, agentId: agent.id, priceTinybar: String(PRICE), status: 'agreed', escrowAddress: task });
  await db.insert(S.contractSpecs).values({ quoteId: quote.id, agreementId: id, kind: 'root', spec: {}, specHash: keccak256(toBytes('t')), source: 'default', deployTx: rc.transactionHash });
  made.push({ agr: id, req: req.id, quote: quote.id, task });
  console.log(name, 'task', task);
  return { id, task: task as `0x${string}` };
}
const view = async (id: string) => { const [a] = await db.select().from(S.agreements).where(eq(S.agreements.id, id)); const p = await db.select().from(S.payments).where(eq(S.payments.agreementId, id)); return { status: a.status, p, text: `${a.status} | ${p.map((x) => `${x.kind}:${x.status}:${formatEther(BigInt(x.amountTinybar))}`).join(', ')}` }; };
async function until(id: string, ok: (v: Awaited<ReturnType<typeof view>>) => boolean, secs: number) { const t = Date.now(); let v = await view(id); while (!ok(v) && Date.now() - t < secs * 1000) { await sleep(3000); v = await view(id); } return v; }

try {
  step('A: part payment, wrong payer, top-up past the price, release, overpayment returned');
  const A = await job('A', 3600);
  const info = await (await fetch(`${API}/agreements/${A.id}/funding`)).json();
  expect(info.payTo === sdk.evmToQor(A.task) && info.amountUqor === '200000' && info.shortfallUqor === '200000', `instructions: ${info.amountUqor} uqor to ${info.payTo.slice(0, 14)}…, shortfall ${info.shortfallUqor}`);
  const part = await pay(CLIENT, A.task, 50_000n);
  let r = await post(A.id, part);
  expect(r.code === 200 && r.body.funded === false && r.body.shortfallUqor === '150000', `part payment -> ${r.code} funded=${r.body.funded} shortfall=${r.body.shortfallUqor}`);
  const wrong = await pay(OTHER, A.task, 1_000n);
  r = await post(A.id, wrong);
  expect(r.code === 422 && /your account/.test(r.body.error), `someone else's payment -> ${r.code} "${r.body.error}"`);
  expect((await view(A.id)).status === 'agreed' && (await readEscrowState(A.task)) === 0, 'still not funded');
  const top = await pay(CLIENT, A.task, 160_000n);
  r = await post(A.id, top);
  expect(r.code === 200 && r.body.funded === true, `top-up -> ${r.code} funded=${r.body.funded}`);
  let v = await until(A.id, (x) => x.status === 'funded', 60);
  const fund = v.p.find((x) => x.kind === 'fund');
  expect(v.status === 'funded' && fund?.status === 'confirmed' && fund.nativeTx === top.toUpperCase() && Boolean(fund.txHash), `indexed: ${v.text} (keeps the client's tx and the confirm tx)`);
  const leadBefore = await publicClient.getBalance({ address: addr(LEAD) });
  await db.insert(S.submissions).values({ agreementId: A.id, content: 'work', kind: 'text', deliverableHash: keccak256(toBytes('work')).slice(2) });
  await submitOnChain(A.task, keccak256(toBytes('work')));
  const sig = await signVerdict(A.task, A.id, true);
  await releaseOnChain(A.task, sig.nonce, sig.sig);
  v = await until(A.id, (x) => x.status === 'released' && x.p.some((p) => p.kind === 'excess' && p.status === 'confirmed'), 90);
  expect(v.status === 'released', `released: ${v.text}`);
  expect((await publicClient.getBalance({ address: addr(LEAD) })) - leadBefore === PRICE, 'lead agent received exactly 0.2 QOR');
  const ex = v.p.find((x) => x.kind === 'excess');
  expect(ex?.status === 'confirmed' && ex.amountTinybar === String(parseEther('0.011')) && (await publicClient.getBalance({ address: A.task })) === 0n, `excess returned ${ex ? formatEther(BigInt(ex.amountTinybar)) : '?'} QOR (0.05 + 0.001 + 0.16 - 0.2), contract empty`);

  step('B: paid in full but never reported, nothing delivered, deadline passes   C: part-paid, deadline passes');
  const B = await job('B', 150);
  const C = await job('C', 100);
  await pay(CLIENT, B.task, 200_000n);
  const cTx = await pay(CLIENT, C.task, 40_000n);
  r = await post(C.id, cTx);
  expect(r.code === 200 && r.body.funded === false, `C part payment reported -> funded=${r.body.funded}`);
  const vb = await until(B.id, (x) => x.status === 'funded', 60);
  expect(vb.status === 'funded', `B confirmed by the keeper without any report: ${vb.text}`);
  console.log('waiting for the deadlines to pass…');
  const vc = await until(C.id, (x) => x.status === 'refunded', 240);
  expect(vc.status === 'refunded' && vc.p.some((p) => p.kind === 'refund' && p.amountTinybar === String(parseEther('0.04'))) && !vc.p.some((p) => p.kind === 'fund'), `C refunded: ${vc.text}`);
  const vb2 = await until(B.id, (x) => x.status === 'refunded', 240);
  expect(vb2.status === 'refunded' && vb2.p.some((p) => p.kind === 'refund' && p.amountTinybar === String(PRICE)), `B refunded: ${vb2.text}`);
  await sleep(12_000);
  const left = (await db.select().from(S.payments).where(inArray(S.payments.agreementId, made.map((m) => m.agr)))).filter((p) => p.status === 'pending');
  expect(left.length === 0 && (await publicClient.getBalance({ address: C.task })) === 0n, 'no pending rows left; contracts empty');
} catch (e) { failures++; console.log('TEST ERROR:', (e as Error).message.split('\n')[0].slice(0, 300)); }
finally {
  for (const m of made) {
    await db.delete(S.payments).where(eq(S.payments.agreementId, m.agr));
    await db.delete(S.submissions).where(eq(S.submissions.agreementId, m.agr));
    await db.delete(S.contractSpecs).where(eq(S.contractSpecs.agreementId, m.agr));
    await db.delete(S.chainEvents).where(eq(S.chainEvents.contract, m.task));
    await db.delete(S.chainCursor).where(eq(S.chainCursor.contract, m.task));
    await db.delete(S.agreements).where(eq(S.agreements.id, m.agr));
    await db.delete(S.quotes).where(eq(S.quotes.id, m.quote));
    await db.delete(S.requests).where(eq(S.requests.id, m.req));
  }
  await db.delete(S.agents).where(eq(S.agents.id, agent.id));
  await db.delete(S.users).where(inArray(S.users.id, [clientRow.id, owner.id]));
  console.log(`\nfixtures removed; failures: ${failures}`);
  process.exit(failures ? 1 : 0);
}
