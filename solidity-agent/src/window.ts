// Copy of backend/src/chain/window.ts (the two packages share no code yet). Keep the two in step.
// QoreChain admits an EVM transaction only from an account that has (1) a registered post-quantum key and (2) an open
// authorisation window (a bounded number of blocks, transactions and value). This module keeps both true for the backend's
// accounts (SPEC-qorechain R3). Facts used here were confirmed on the live testnet (SPEC section 2).
import { StargateClient } from '@cosmjs/stargate';
import * as sdk from '@qorechain/sdk';
import { env } from './env.js';

export class WindowError extends Error {}

/** 1 uqor = 1e12 wei: the EVM lane is 18 decimals, the native lane 6. The window's maxValue is counted in uqor. */
export const WEI_PER_UQOR = 1_000_000_000_000n;

/** What one transaction can spend from a window: gas limit x fee cap plus the value sent, in uqor, rounded up. */
export function costUqor(gasLimit: bigint, feeCapWei: bigint, valueWei = 0n): bigint {
  return (gasLimit * feeCapWei + valueWei + WEI_PER_UQOR - 1n) / WEI_PER_UQOR;
}

export type WindowView = { live: boolean; remainingTxs: bigint; remainingValue: bigint; remainingBlocks: bigint };

/** True when the live window can still admit a transaction that needs `needUqor`, with `minBlocks` of margin. */
export function windowAdmits(w: WindowView, needUqor: bigint, minBlocks: bigint): boolean {
  return w.live && w.remainingTxs >= 1n && w.remainingValue >= needUqor && w.remainingBlocks >= minBlocks;
}

/** Size for the next window: the configured value, but never less than four transactions like the one that triggered it. */
export function windowValueUqor(needUqor: bigint, configuredUqor: bigint): bigint {
  return needUqor * 4n > configuredUqor ? needUqor * 4n : configuredUqor;
}

const MAX_BLOCKS = 17_280; // chain bounds: blocks 1..17280, txs 1..1000
const MAX_TXS = 1_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n)));

/** One account that sends EVM transactions: its post-quantum key and its authorisation window. */
export class QoreIdentity {
  private acct?: sdk.UnifiedAccount;
  private stargate?: Promise<StargateClient>;

  constructor(private readonly label: string, private readonly privateKey: string | undefined, private readonly recoveryCode: string | undefined) {}

  private account(): sdk.UnifiedAccount {
    if (!this.privateKey || !this.recoveryCode) {
      throw new WindowError(`${this.label}: private key and PQC recovery code must both be set (QORE_*_PRIVATE_KEY / _PQC_RECOVERY_CODE)`);
    }
    this.acct ??= sdk.unifiedAccountFromSeed(Uint8Array.from(Buffer.from(this.privateKey.replace(/^0x/, ''), 'hex')), { recoveryCode: this.recoveryCode });
    return this.acct;
  }

  get cosmosAddress() { return this.account().cosmos; }

  private rpc() { return (this.stargate ??= StargateClient.connect(env.QORE_RPC_URL)); }

  private async accountNumbers() {
    const res = await fetch(`${env.QORE_REST_URL}/cosmos/auth/v1beta1/accounts/${this.account().cosmos}`);
    if (!res.ok) throw new WindowError(`${this.label}: account lookup failed (${res.status}); is it funded?`);
    const a = ((await res.json()) as { account?: { account_number: string; sequence: string } }).account;
    if (!a) throw new WindowError(`${this.label}: account does not exist on chain yet; fund it first`);
    return { accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence) };
  }

  /** Register the ML-DSA-87 key once (classical signature, the one bootstrap-exempt message). Idempotent. */
  async ensureRegistered(): Promise<void> {
    const acct = this.account();
    const status = await sdk.fetchPqcStatus({ rest: env.QORE_REST_URL, address: acct.cosmos });
    if (status.registered) return;
    const proof = (await sdk.isUpgradeApplied({ rest: env.QORE_REST_URL, upgrade: sdk.CHAIN_UPGRADE_V3_2_3 }))
      ? sdk.signProofOfPossession({ chainId: env.QORE_COSMOS_CHAIN_ID, account: acct.cosmos, keypair: acct.pqc })
      : undefined;
    const message = sdk.buildRegisterPqcKeyMsg(acct.cosmos, {
      pqcKeypair: acct.pqc, ecdsaPubkey: Uint8Array.from(Buffer.from(String(acct.publicKey).replace(/^0x/, ''), 'hex')), proofOfPossession: proof,
    });
    const signer = new sdk.EthNativeSigner(acct, { signMode: 'classical', rest: env.QORE_REST_URL });
    const r = await signer.signAndBroadcast(await this.rpc(), {
      chainId: env.QORE_COSMOS_CHAIN_ID, ...(await this.accountNumbers()), fee: sdk.calculateFee(400_000, '0.2uqor'), messages: [message],
    });
    if (r.code !== 0) throw new WindowError(`${this.label}: PQC key registration failed (code ${r.code}): ${r.rawLog ?? ''}`);
  }

  /** Read the current window. */
  async window(): Promise<WindowView> {
    return sdk.fetchEvmWindow({ rest: env.QORE_REST_URL, address: this.account().cosmos });
  }

  /** Open a new window (hybrid-signed). It advances the account's nonce, so callers must read the nonce afterwards. */
  async openWindow(needUqor: bigint): Promise<void> {
    const acct = this.account();
    const signer = new sdk.EthNativeSigner(acct, { signMode: 'hybrid', rest: env.QORE_REST_URL });
    const message = sdk.openEvmWindowMsg({
      sender: acct.cosmos,
      blocks: clamp(env.QORE_WINDOW_BLOCKS, 1, MAX_BLOCKS),
      maxTxs: clamp(env.QORE_WINDOW_MAX_TXS, 1, MAX_TXS),
      maxValue: windowValueUqor(needUqor, BigInt(env.QORE_WINDOW_MAX_VALUE_UQOR)).toString(),
    });
    const r = await signer.signAndBroadcast(await this.rpc(), {
      chainId: env.QORE_COSMOS_CHAIN_ID, ...(await this.accountNumbers()), fee: sdk.calculateFee(600_000, '0.2uqor'), messages: [message],
    });
    if (r.code !== 0) throw new WindowError(`${this.label}: opening the EVM window failed (code ${r.code}): ${r.rawLog ?? ''}`);
  }

  /**
   * Make sure the next transaction (needing `needUqor`) will be admitted: register the key if needed, and open a fresh window
   * when the current one is missing, expired or too small. With `force`, open one regardless (after a window rejection).
   * Returns true when a window was opened. Throws WindowError when it cannot; the caller must not pretend the send worked.
   */
  async ensureWindow(needUqor: bigint, force = false): Promise<boolean> {
    try {
      await this.ensureRegistered();
      if (!force && windowAdmits(await this.window(), needUqor, BigInt(env.QORE_WINDOW_MIN_BLOCKS))) return false;
      await this.openWindow(needUqor);
      return true;
    } catch (e) {
      if (e instanceof WindowError) throw e;
      throw new WindowError(`${this.label}: could not prepare the EVM window: ${(e as Error).message}`);
    }
  }
}

/** True when an error from a send means "no PQC key", "no window" or "window used up" (so opening a window may fix it). */
export const isWindowProblem = (e: unknown): boolean => {
  const kind = sdk.classifyEvmWindowRejection(e);
  return kind === 'no-pqc-key' || kind === 'no-window' || kind === 'exhausted';
};
