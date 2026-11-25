import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addressFromPublicKey, classicalKeyFromPrivate, parseSiwqMessage, pqKeyFromSeed, signMessage } from '@qorechain/qoresign';
import { checkSignature, SIGN_IN_TTL_MS, signInMessage, walletAddress, walletSignature } from './signIn.js';

// Throwaway keys made for each run; the chain lookup is replaced by a fake that returns the key we generated.
const classical = classicalKeyFromPrivate(crypto.randomBytes(32), 'secp256k1');
const pq = pqKeyFromSeed(crypto.randomBytes(32));
const qor = addressFromPublicKey(classical.publicKey, 'secp256k1').bech32;
const chain = (key: Uint8Array | null, status = 200) => (async () => new Response(JSON.stringify(
  status >= 500 ? {} : key ? { found: true, account: { public_key: Buffer.from(key).toString('base64'), algorithm_id: 1 } } : { found: false },
), { status })) as unknown as typeof fetch;

const expiresAt = new Date('2026-11-26T10:05:00.000Z');
const message = signInMessage({ qor, nonce: 'abcdef0123456789', expiresAt, origin: new URL('https://app.example.com'), chainId: 'qorechain-diana' });
const sign = (data: string) => walletSignature.parse(signMessage({ chainId: 'qorechain-diana', signer: qor, data, classicalKey: classical, pqKey: pq }));

describe('signInMessage', () => {
  it('binds the site, account, chain, nonce and a five minute window', () => {
    const f = parseSiwqMessage(message);
    expect(f).toMatchObject({ domain: 'app.example.com', address: qor, uri: 'https://app.example.com', chainId: 'qorechain-diana', nonce: 'abcdef0123456789' });
    expect(Date.parse(f.expirationTime!) - Date.parse(f.issuedAt)).toBe(SIGN_IN_TTL_MS);
  });
  it('is deterministic', () => {
    expect(signInMessage({ qor, nonce: 'abcdef0123456789', expiresAt, origin: new URL('https://app.example.com'), chainId: 'qorechain-diana' })).toBe(message);
  });
});

describe('walletAddress', () => {
  it('reads the qor1 and 0x forms as the same account', () => {
    const a = walletAddress('qor1mch6sv5sahyqf399lgfq6sp9v8078un04efcmx')!;
    expect(a.hex).toBe('0xde2fa83290edc804c4a5fa120d402561dfe3f26f');
    expect(walletAddress('0xDE2FA83290EDC804C4A5FA120D402561DFE3F26F'.replace('0X', '0x').toLowerCase())).toEqual(a);
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'hello', 'cosmos1mch6sv5sahyqf399lgfq6sp9v8078un0xxxxxx', 'qor1mch6sv5sahyqf399lgfq6sp9v8078un04efcmy']) expect(walletAddress(bad)).toBeNull();
  });
});

describe('checkSignature', () => {
  it('accepts a hybrid signature made by the account over our text', async () => {
    expect(await checkSignature(qor, message, sign(message), chain(pq.publicKey))).toBeNull();
  });
  it('refuses a signature over different text, or checked against a different post-quantum key', async () => {
    expect(await checkSignature(qor, message, sign(`${message} `), chain(pq.publicKey))).toMatchObject({ status: 401, code: 'bad_signature' });
    expect(await checkSignature(qor, message, sign(message), chain(pqKeyFromSeed(crypto.randomBytes(32)).publicKey))).toMatchObject({ status: 401 });
  });
  it('explains an account without a registered key', async () => {
    expect(await checkSignature(qor, message, sign(message), chain(null))).toMatchObject({ status: 403, code: 'no_pqc_key' });
  });
  it('reports an unreachable chain as unavailable, never as a bad signature', async () => {
    expect(await checkSignature(qor, message, sign(message), chain(null, 502))).toMatchObject({ status: 503, code: 'chain_unavailable' });
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    expect(await checkSignature(qor, message, sign(message), down)).toMatchObject({ status: 503 });
  });
  it('requires the post-quantum part in the request', () => {
    const { pq: _drop, ...classicalOnly } = sign(message);
    expect(walletSignature.safeParse(classicalOnly).success).toBe(false);
    expect(walletSignature.safeParse({ ...sign(message), signatureType: 'secp256k1' }).success).toBe(false);
  });
});
