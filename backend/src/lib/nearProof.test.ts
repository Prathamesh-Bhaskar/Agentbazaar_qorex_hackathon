import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { evaluateProof, expectedSignedText, sha256Hex } from './nearProof.js';
import { normalizeModels, reduceCatalog } from './nearModels.js';
import { nearHttpError } from './llm.js';

const model = 'z-ai/glm-5.3-flash';
const nonce = 'ab'.repeat(32);
const requestHash = sha256Hex('request-bytes');
const responseHash = sha256Hex('response-bytes');
const acct = privateKeyToAccount(generatePrivateKey());

async function sigFor(text: string, kind: string | undefined = 'provider_tee') {
  return { text, signature: await acct.signMessage({ message: text }), signing_address: acct.address, signing_algo: 'ecdsa', signature_kind: kind };
}
const attestation = (over: object = {}) => ({ model_attestations: [{ signing_address: acct.address, signing_algo: 'ecdsa', request_nonce: nonce, ...over }] });
const base = { model, chatId: 'chatcmpl-1', requestHash, responseHash, nonce };

describe('evaluateProof', () => {
  it('accepts a provider_tee signature that matches the attestation', async () => {
    const sig = await sigFor(expectedSignedText('provider_tee', model, requestHash, responseHash)!);
    const p = await evaluateProof({ ...base, sig, attestation: attestation() });
    expect(p.level).toBe('tee_signature');
    expect(p.signingAddress).toBe(acct.address);
  });

  it('marks a gateway signature as gateway_signature only', async () => {
    const sig = await sigFor(expectedSignedText('gateway', model, requestHash, responseHash)!, 'gateway');
    expect((await evaluateProof({ ...base, sig, attestation: null })).level).toBe('gateway_signature');
  });

  it('rejects tampered signed text', async () => {
    const sig = await sigFor(`${model}:${requestHash}:${sha256Hex('other')}`);
    const p = await evaluateProof({ ...base, sig, attestation: attestation() });
    expect(p.level).toBe('unverified');
    expect(p.note).toMatch(/does not match/);
  });

  it('rejects a signature made by a different key than signing_address', async () => {
    const text = expectedSignedText('provider_tee', model, requestHash, responseHash)!;
    const other = privateKeyToAccount(generatePrivateKey());
    const sig = { ...(await sigFor(text)), signature: await other.signMessage({ message: text }) };
    expect((await evaluateProof({ ...base, sig, attestation: attestation() })).level).toBe('unverified');
  });

  it('accepts the same signing key listed several times, and rejects it when any listed entry misses our nonce', async () => {
    const sig = await sigFor(expectedSignedText('provider_tee', model, requestHash, responseHash)!);
    const one = { signing_address: acct.address, signing_algo: 'ecdsa', request_nonce: nonce };
    expect((await evaluateProof({ ...base, sig, attestation: { model_attestations: [one, { ...one }, { ...one }] } })).level).toBe('tee_signature');
    expect((await evaluateProof({ ...base, sig, attestation: { model_attestations: [one, { ...one, request_nonce: 'zz' }] } })).level).toBe('unverified');
  });

  it('is unverified when the signer is not in the model attestation, or the nonce differs', async () => {
    const sig = await sigFor(expectedSignedText('provider_tee', model, requestHash, responseHash)!);
    expect((await evaluateProof({ ...base, sig, attestation: { model_attestations: [] } })).level).toBe('unverified');
    expect((await evaluateProof({ ...base, sig, attestation: null })).level).toBe('unverified');
    expect((await evaluateProof({ ...base, sig, attestation: attestation({ request_nonce: 'zz' }) })).level).toBe('unverified');
  });

  it('is unverified for a missing signature, an error reply, an unknown kind and a non-ecdsa algorithm', async () => {
    const text = expectedSignedText('provider_tee', model, requestHash, responseHash)!;
    expect((await evaluateProof({ ...base, sig: null, attestation: attestation() })).level).toBe('unverified');
    expect((await evaluateProof({ ...base, sig: { error_code: 'x' }, attestation: attestation() })).level).toBe('unverified');
    expect((await evaluateProof({ ...base, sig: { ...(await sigFor(text)), signature_kind: undefined }, attestation: attestation() })).level).toBe('unverified');
    expect((await evaluateProof({ ...base, sig: { ...(await sigFor(text)), signing_algo: 'ed25519' }, attestation: attestation() })).level).toBe('unverified');
  });
});

describe('model catalog helpers', () => {
  it('reduceCatalog marks tee only when verifiable and attestation supported', () => {
    const out = reduceCatalog({ models: [
      { modelId: 'a', metadata: { verifiable: true, attestationSupported: true, modelDisplayName: 'A' } },
      { modelId: 'b', metadata: { verifiable: false, attestationSupported: false, isReady: false } },
      { nope: 1 },
    ] });
    expect(out).toEqual([
      { id: 'a', name: 'A', owner: '', tee: true, ready: true },
      { id: 'b', name: 'b', owner: '', tee: false, ready: false },
    ]);
    expect(reduceCatalog(null)).toEqual([]);
  });

  it('normalizeModels trims, de-duplicates case-insensitively and caps at 6', () => {
    expect(normalizeModels([' GPT-X ', 'gpt-x', '', 'm2'])).toEqual(['GPT-X', 'm2']);
    expect(normalizeModels(['1', '2', '3', '4', '5', '6', '7'])).toHaveLength(6);
  });
});

describe('nearHttpError', () => {
  it('treats credits, rate limits and 5xx as retryable infrastructure errors; 401/400 are not', () => {
    expect(nearHttpError(402, '').retryable).toBe(true);
    expect(nearHttpError(429, '').retryable).toBe(true);
    expect(nearHttpError(503, '').retryable).toBe(true);
    expect(nearHttpError(401, '').retryable).toBe(false);
    expect(nearHttpError(400, 'bad').retryable).toBe(false);
  });
});
