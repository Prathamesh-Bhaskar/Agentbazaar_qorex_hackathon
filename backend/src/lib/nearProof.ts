// Verifiable-inference proof for NEAR AI Cloud completions (SPEC-near-ai.md, M2).
// What we check: the response signature (EIP-191, ecdsa) was made by the key that a NEAR model attestation lists,
// and that it covers the exact request and response bytes. What we do NOT check: the Intel TDX / NVIDIA quote itself.
// A proof never changes a verdict; any problem here yields level 'unverified' with a note.
import { createHash, randomBytes } from 'node:crypto';
import { recoverMessageAddress } from 'viem';

export type ProofLevel = 'tee_signature' | 'gateway_signature' | 'unverified';

export type LlmProof = {
  provider: 'near';
  model: string;
  chatId: string | null;
  signatureKind: string | null;
  signingAddress: string | null;
  signingAlgo: string | null;
  requestHash: string;
  responseHash: string;
  level: ProofLevel;
  checkedAt: string;
  note?: string;
};

export const sha256Hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export const newNonce = () => randomBytes(32).toString('hex');

export type SignatureReply = {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
  error_code?: unknown;
};
type ModelAttestation = { signing_address?: string; signing_algo?: string; request_nonce?: string };
export type AttestationReply = { model_attestations?: ModelAttestation[] } | null;

const lc = (s?: string | null) => (s ?? '').toLowerCase();
const strip0x = (s: string) => s.replace(/^0x/i, '');

/** The text NEAR signs, per signature_kind. null = unknown kind (we must not guess). */
export function expectedSignedText(kind: string | undefined, model: string, requestHash: string, responseHash: string): string | null {
  if (kind === 'provider_tee') return `${model}:${requestHash}:${responseHash}`;
  if (kind === 'gateway') return `${requestHash}:${responseHash}`;
  return null;
}

/**
 * Pure evaluation of a signature + preflight attestation. `nonce` is the one sent with the preflight request.
 * Exported for tests; collectNearProof() does the HTTP around it.
 */
export async function evaluateProof(input: {
  model: string; chatId: string | null; requestHash: string; responseHash: string; nonce: string;
  sig: SignatureReply | null; attestation: AttestationReply;
}): Promise<LlmProof> {
  const { model, chatId, requestHash, responseHash, nonce, sig, attestation } = input;
  const base: LlmProof = {
    provider: 'near', model, chatId, signatureKind: sig?.signature_kind ?? null,
    signingAddress: sig?.signing_address ?? null, signingAlgo: sig?.signing_algo ?? null,
    requestHash, responseHash, level: 'unverified', checkedAt: new Date().toISOString(),
  };
  const fail = (note: string): LlmProof => ({ ...base, level: 'unverified', note });

  if (!sig || sig.error_code || !sig.text || !sig.signature || !sig.signing_address) return fail('no response signature available');
  if (lc(sig.signing_algo) !== 'ecdsa') return fail(`unsupported signing algorithm: ${sig.signing_algo ?? 'none'}`);

  const expected = expectedSignedText(sig.signature_kind, model, requestHash, responseHash);
  if (expected === null) return fail(`unknown signature kind: ${sig.signature_kind ?? 'none'}`);
  if (sig.text !== expected) return fail('signed text does not match the request and response we sent');

  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: sig.text, signature: `0x${strip0x(sig.signature)}` });
  } catch (e) {
    return fail(`signature could not be recovered: ${(e as Error).message}`);
  }
  if (lc(signer) !== lc(sig.signing_address)) return fail('signature was not made by the stated signing address');

  if (sig.signature_kind === 'gateway') {
    return { ...base, level: 'gateway_signature', note: 'signature binds the response to the NEAR gateway, not to a model TEE' };
  }

  // provider_tee: at least one preflight model attestation must list this signer, and every entry that does must echo our nonce.
  const matches = (attestation?.model_attestations ?? []).filter(
    (a) => lc(a.signing_address) === lc(sig.signing_address) && lc(a.signing_algo) === 'ecdsa',
  );
  // NEAR's report can list the same signing key several times (one entry per replica), so more than one match is normal.
  // What must hold: at least one entry lists this signer, and every entry that does echoes our nonce.
  if (matches.length === 0) return fail('signer not found in the model attestation');
  if (!matches.every((a) => a.request_nonce === nonce)) return fail('model attestation did not echo our nonce');

  return { ...base, level: 'tee_signature', note: 'signature checked against the model attestation; the TDX quote itself was not verified' };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = (baseUrl: string) => baseUrl.replace(/\/v1\/?$/, '');

/** Preflight: model attestation with a fresh nonce, fetched BEFORE the completion (NEAR requires this order). */
export async function fetchPreflight(baseUrl: string, model: string): Promise<{ nonce: string; attestation: AttestationReply }> {
  const nonce = newNonce();
  const url = new URL(`${root(baseUrl)}/v1/attestation/report`);
  url.search = new URLSearchParams({ model, provider: 'near', signing_algo: 'ecdsa', include_tls_fingerprint: 'false', nonce }).toString();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'x-no-aliasing': 'true' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { nonce, attestation: null };
    return { nonce, attestation: (await res.json()) as AttestationReply };
  } catch {
    return { nonce, attestation: null };
  }
}

/** After the completion: fetch the signature (short bounded retry; it may be recorded a moment later) and evaluate. */
export async function collectNearProof(input: {
  baseUrl: string; apiKey: string; model: string; chatId: string | null;
  requestBytes: Uint8Array; responseBytes: Uint8Array; nonce: string; attestation: AttestationReply;
}): Promise<LlmProof> {
  const requestHash = sha256Hex(input.requestBytes);
  const responseHash = sha256Hex(input.responseBytes);
  const common = { model: input.model, chatId: input.chatId, requestHash, responseHash, nonce: input.nonce, attestation: input.attestation };
  if (!input.chatId) return evaluateProof({ ...common, sig: null });

  let sig: SignatureReply | null = null;
  for (let i = 0; i < 3 && !sig; i++) {
    if (i) await sleep(1500);
    try {
      const res = await fetch(`${root(input.baseUrl)}/v1/signature/${encodeURIComponent(input.chatId)}?signing_algo=ecdsa`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue; // 404 = not recorded yet
      const body = (await res.json()) as SignatureReply;
      if (!body.error_code) sig = body;
    } catch { /* retry */ }
  }
  return evaluateProof({ ...common, sig });
}

/** A proof for a path where we deliberately did not collect one (e.g. non-TEE model). */
export function skippedProof(model: string, note: string): LlmProof {
  return {
    provider: 'near', model, chatId: null, signatureKind: null, signingAddress: null, signingAlgo: null,
    requestHash: '', responseHash: '', level: 'unverified', checkedAt: new Date().toISOString(), note,
  };
}
