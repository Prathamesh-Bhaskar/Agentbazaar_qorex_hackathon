// The QoreX wallet connector (SPEC-qorechain R6). QoreX injects `window.qorex.native`; the page asks it to sign a message or to send
// native messages, and the wallet shows each request to the user. The page never holds a key.
import { getQorexNative, hasCapability, QOREX_DOWNLOAD_URLS, type QorexNativeProvider } from '@qorechain/qorex-types';
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx';

export const QORE_CHAIN_ID = 'qorechain-diana';
export const QORE_NETWORK_NAME = 'QoreChain testnet';
export const QOREX_INSTALL_URL = QOREX_DOWNLOAD_URLS.chrome;

export type WalletErrorCode = 'not_installed' | 'too_old' | 'rejected' | 'wrong_account' | 'failed';
export class WalletError extends Error {
  constructor(message: string, readonly code: WalletErrorCode) { super(message); }
}

export type Account = { qor: string; hex: `0x${string}` };

/** The extension injects itself after the page starts, so look for a moment before saying it is missing. */
export async function findQorex(timeoutMs = 1500): Promise<QorexNativeProvider | null> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const p = getQorexNative();
    if (p) return p;
    if (Date.now() >= until) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Turn whatever the wallet threw into a sentence the user can act on. */
function walletFailure(e: unknown): WalletError {
  if (e instanceof WalletError) return e;
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/signature rejected|user rejected|request rejected|denied|cancel/i.test(msg)) return new WalletError('You cancelled the request in QoreX.', 'rejected');
  return new WalletError(`${msg.replace(/^QoreX:\s*/, 'QoreX: ')} (check that QoreX is unlocked and switched to testnet, ${QORE_CHAIN_ID})`, 'failed');
}

/** Find QoreX, ask it to connect this site, and return the active account. */
export async function connectQorex(): Promise<{ provider: QorexNativeProvider; account: Account }> {
  const provider = await findQorex();
  if (!provider) throw new WalletError('QoreX was not found. Install the QoreX extension, then reload this page.', 'not_installed');
  if (!hasCapability(provider, 'signAndBroadcast') || !hasCapability(provider, 'signArbitrary')) {
    throw new WalletError('This version of QoreX cannot sign for websites. Update QoreX, then reload this page.', 'too_old');
  }
  try {
    await provider.enable(QORE_CHAIN_ID);
    const key = await provider.getKey(QORE_CHAIN_ID);
    const hex = `0x${Array.from(key.address, (b) => b.toString(16).padStart(2, '0')).join('')}` as const;
    return { provider, account: { qor: key.bech32Address, hex } };
  } catch (e) { throw walletFailure(e); }
}

/** Fails when the wallet's active account is not the one the user signed in with. */
export function requireAccount(account: Account, expectedQor: string) {
  if (account.qor !== expectedQor) {
    throw new WalletError(`QoreX is on a different account (${account.qor.slice(0, 10)}…). Switch to ${expectedQor.slice(0, 10)}… in QoreX, or log in again.`, 'wrong_account');
  }
}

/**
 * Sign a text (free, no transaction). QoreX answers with a hybrid secp256k1 + ML-DSA-87 signature object, which is passed to the
 * backend unchanged. (The published type says this method is refused; the current wallet supports it, as tested on 25 Nov.)
 */
export async function signText(provider: QorexNativeProvider, account: Account, message: string): Promise<unknown> {
  const sign = provider.signArbitrary as unknown as (chainId: string, signer: string, data: string) => Promise<unknown>;
  try { return await sign.call(provider, QORE_CHAIN_ID, account.qor, message); }
  catch (e) { throw walletFailure(e); }
}

export type TransferResult = { txHash: string; code: number };

/**
 * Ask QoreX to send `amountUqor` to `to` as a native transfer. The wallet shows it, sets the fee, adds the hybrid
 * secp256k1 + ML-DSA-87 signature and broadcasts. The message bytes are passed as a plain number array (tested in a browser).
 */
export async function sendQor(provider: QorexNativeProvider, account: Account, to: string, amountUqor: bigint, gasLimit: number): Promise<TransferResult> {
  const value = MsgSend.encode(MsgSend.fromPartial({ fromAddress: account.qor, toAddress: to, amount: [{ denom: 'uqor', amount: amountUqor.toString() }] })).finish();
  let r: TransferResult;
  try {
    r = await provider.signAndBroadcast({ chainId: QORE_CHAIN_ID, messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: Array.from(value) }], gasLimit });
  } catch (e) { throw walletFailure(e); }
  if (r.code !== 0) throw new WalletError(`QoreChain rejected the transfer (code ${r.code}). Nothing was paid, apart from the network fee.`, 'failed');
  return r;
}
