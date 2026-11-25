// Sign in with QoreX (SPEC-qorechain R11). The server builds a Sign In With QoreChain text holding a one-time nonce; QoreX signs it
// with signArbitrary, producing a hybrid secp256k1 + ML-DSA-87 signature. We verify that signature over OUR OWN copy of the text
// against the post-quantum key registered on chain. QoreX signs it as a plain message (confirmed in a browser on 25 Nov: the
// library's sign-in verifier expects a different post-quantum prefix and refuses it), so we use the message verifier.
import { createSiwqMessage, parseAddress } from '@qorechain/qoresign';
import { verifyMessageWithChain } from '@qorechain/qoresign/network';
import { z } from 'zod';
import { env } from '../env.js';

export const SIGN_IN_TTL_MS = 5 * 60_000;
const STATEMENT = 'Sign in to AgentBazaar. This does not send a transaction.';

/** The web app's origin: the only site the sign-in text is issued for. */
export const appOrigin = () => new URL(env.FRONTEND_URL ?? env.CORS_ORIGIN.split(',')[0].trim());

/** Accepts a qor1 or 0x address. `hex` (lower case) keys the user record; both are the same 20 bytes. */
export function walletAddress(input: string): { qor: string; hex: string } | null {
  try { const a = parseAddress(input.trim()); return { qor: a.bech32, hex: a.hex.toLowerCase() }; } catch { return null; }
}

/** Deterministic: the same nonce and expiry always give the same text, so the server never has to trust a client's copy. */
export function signInMessage(a: { qor: string; nonce: string; expiresAt: Date; origin?: URL; chainId?: string }): string {
  const origin = a.origin ?? appOrigin();
  return createSiwqMessage({
    domain: origin.host, address: a.qor, statement: STATEMENT, uri: origin.origin, chainId: a.chainId ?? env.QORE_COSMOS_CHAIN_ID, nonce: a.nonce,
    issuedAt: new Date(a.expiresAt.getTime() - SIGN_IN_TTL_MS).toISOString(), expirationTime: a.expiresAt.toISOString(),
  });
}

const base64 = z.string().min(1).max(10_000).regex(/^[A-Za-z0-9+/]+={0,2}$/);
/** What QoreX's signArbitrary returns (extra fields are ignored). The post-quantum part is mandatory. */
export const walletSignature = z.object({
  signatureType: z.literal('ml-dsa-87-hybrid'),
  classical: z.object({ keyType: z.enum(['secp256k1', 'eth_secp256k1']), publicKey: base64, signature: base64 }),
  pq: z.object({ algorithmId: z.number().int(), signature: base64 }),
});
export type WalletSignature = z.infer<typeof walletSignature>;

export type SignInFailure = { status: number; code: 'no_pqc_key' | 'bad_signature' | 'chain_unavailable'; error: string };

/** Map a verification error to an answer. A chain we cannot reach is never reported as a bad signature. */
export function signInFailure(e: unknown): SignInFailure {
  const code = (e as { code?: unknown })?.code;
  if (code === 'KEY_NOT_REGISTERED') {
    return { status: 403, code: 'no_pqc_key', error: 'This account has no post-quantum key on QoreChain yet. Send any transaction from QoreX once (that registers it), then sign in again.' };
  }
  if (typeof code === 'string' && code !== 'NETWORK_UNAVAILABLE') return { status: 401, code: 'bad_signature', error: 'The signature does not match this account.' };
  return { status: 503, code: 'chain_unavailable', error: 'QoreChain could not be reached to check your signature. Try again shortly.' };
}

/** Null when the hybrid signature over `message` is valid for `qor`; otherwise why not. */
export async function checkSignature(qor: string, message: string, signature: WalletSignature, fetchImpl?: typeof fetch): Promise<SignInFailure | null> {
  try {
    await verifyMessageWithChain({ rest: env.QORE_REST_URL, chainId: env.QORE_COSMOS_CHAIN_ID, signer: qor, data: message, signature, requirePq: true, fetch: fetchImpl });
    return null;
  } catch (e) { return signInFailure(e); }
}
