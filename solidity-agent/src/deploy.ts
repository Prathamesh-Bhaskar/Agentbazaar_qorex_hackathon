// Deploys a TaskEscrow through the TaskFactory using the agent's OWN account (the factory only accepts the designer).
// On QoreChain that account needs a registered PQC key and an open EVM window; window.ts keeps both true (SPEC-qorechain R3, R7).
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, parseEventLogs, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from './env.js';
import { specHash, type ContractSpec } from './spec.js';
import { costUqor, isWindowProblem, QoreIdentity, WindowError } from './window.js';

export class DeployError extends Error {}

const factoryAbi = parseAbi([
  'function createTask(bytes32 agreementId, address client, address agent, uint256 price, uint64 deadline, uint16 maxSubBps, uint8 maxSubLegs, uint32 payoutGrace, bytes32 termsHash) returns (address task)',
  'function taskOf(bytes32) view returns (address)',
  'function designer() view returns (address)',
  'event TaskCreated(bytes32 indexed agreementId, address task, address client, address agent, uint256 price, uint64 deadline, uint16 maxSubBps, uint8 maxSubLegs, uint32 payoutGrace, bytes32 termsHash, address designer)',
]);

const chain = defineChain({
  id: env.QORE_CHAIN_ID, name: 'QoreChain Diana Testnet',
  nativeCurrency: { name: 'QOR', symbol: 'QOR', decimals: 18 },
  rpcUrls: { default: { http: [env.QORE_EVM_RPC_URL] } },
});
const pub = createPublicClient({ chain, transport: http(env.QORE_EVM_RPC_URL, { retryCount: 4, retryDelay: 1500 }) });

const designer = new QoreIdentity('designer', env.QORE_DESIGNER_PRIVATE_KEY, env.QORE_DESIGNER_PQC_RECOVERY_CODE);

// The 18 Nov smoke test measured 1.65M gas for createTask. A reverted transaction is charged its whole gas limit, so keep the
// limit close to what is needed (the chain cap is 30M).
const CREATE_TASK_GAS = 2_500_000n;

/** Same id the backend uses on-chain for an agreement uuid. */
export const agreementIdBytes = (uuid: string): Hex => keccak256(toBytes(uuid));

// One wallet = one nonce stream: deploy strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const run = queue.then(fn, fn); queue = run.catch(() => undefined); return run; };

export function designerAddress(): Address {
  if (!env.QORE_DESIGNER_PRIVATE_KEY) throw new DeployError('QORE_DESIGNER_PRIVATE_KEY is not set');
  return privateKeyToAccount((env.QORE_DESIGNER_PRIVATE_KEY.startsWith('0x') ? env.QORE_DESIGNER_PRIVATE_KEY : `0x${env.QORE_DESIGNER_PRIVATE_KEY}`) as Hex).address;
}

export type Deployed = { task: Address; txHash: Hex | null; specHash: Hex; deadlineUnix: string; alreadyExisted: boolean };

export async function deployTask(input: { agreementId: string; client: Address; agent: Address; spec: ContractSpec }): Promise<Deployed> {
  if (!env.QORE_DESIGNER_PRIVATE_KEY) throw new DeployError('QORE_DESIGNER_PRIVATE_KEY is not set');
  if (!env.TASK_FACTORY_ADDRESS) throw new DeployError('TASK_FACTORY_ADDRESS is not set');
  const factory = env.TASK_FACTORY_ADDRESS as Address;
  const id = agreementIdBytes(input.agreementId);
  const hash = specHash(input.spec);

  return serial(async () => {
    // Idempotent: a retry after a timeout must not try to deploy twice.
    const existing = (await pub.readContract({ address: factory, abi: factoryAbi, functionName: 'taskOf', args: [id] })) as Address;
    if (existing !== '0x0000000000000000000000000000000000000000') {
      return { task: existing, txHash: null, specHash: hash, deadlineUnix: '0', alreadyExisted: true };
    }
    const account = privateKeyToAccount((env.QORE_DESIGNER_PRIVATE_KEY!.startsWith('0x') ? env.QORE_DESIGNER_PRIVATE_KEY! : `0x${env.QORE_DESIGNER_PRIVATE_KEY}`) as Hex);
    const wallet = createWalletClient({ account, chain, transport: http(env.QORE_EVM_RPC_URL, { retryCount: 3, retryDelay: 1500 }) });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + input.spec.deadlineHours * 3600);
    const gasPrice = await pub.getGasPrice();
    const need = costUqor(CREATE_TASK_GAS, gasPrice * 2n); // 2x fee-cap margin for the window budget
    // priceTinybar is a leftover field name: the value is in wei (1 QOR = 1e18).
    const write = () => wallet.writeContract({
      address: factory, abi: factoryAbi, functionName: 'createTask',
      args: [id, input.client, input.agent, BigInt(input.spec.priceTinybar), deadline, input.spec.maxSubBps, input.spec.maxSubLegs, input.spec.payoutGraceSecs, hash],
      gas: CREATE_TASK_GAS, type: 'legacy', gasPrice,
    } as never);
    let txHash: Hex;
    try {
      await designer.ensureWindow(need);
      try { txHash = await write(); }
      catch (e) {
        if (!isWindowProblem(e)) throw e;
        await designer.ensureWindow(need, true); // a race or an early expiry: open a fresh window and try once more
        txHash = await write();
      }
    } catch (e) {
      // Never report a deploy that did not happen; the backend keeps the agreement without a contract and can retry.
      if (e instanceof WindowError) throw new DeployError(e.message);
      throw e;
    }
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 90_000, pollingInterval: 2000 });
    if (receipt.status !== 'success') throw new DeployError(`createTask reverted: ${txHash}`);
    const created = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: 'TaskCreated' })[0];
    if (!created) throw new DeployError(`TaskCreated event not found in ${txHash}`);
    return { task: created.args.task, txHash, specHash: hash, deadlineUnix: deadline.toString(), alreadyExisted: false };
  });
}
