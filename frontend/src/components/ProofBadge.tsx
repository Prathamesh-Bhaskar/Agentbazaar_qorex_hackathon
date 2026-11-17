import type { LlmProof } from '@/lib/types';
import { shortAddr } from '@/lib/format';

// Shows what we actually checked about an AI judgement made on NEAR AI Cloud. Never a failure state:
// a missing or weak proof does not change a verdict, it only says how much the inference can be trusted.
const COPY: Record<LlmProof['level'], { cls: string; title: string; body: string }> = {
  tee_signature: {
    cls: 's-ok',
    title: 'Signed by a NEAR AI TEE key',
    body: 'The response signature matches the signing key in the model’s attestation. We checked the signature, not the hardware quote.',
  },
  gateway_signature: {
    cls: 's-warn',
    title: 'Signed by the NEAR AI gateway',
    body: 'The response is signed by the gateway, which does not bind it to a model TEE.',
  },
  unverified: {
    cls: 's-idle',
    title: 'Inference proof not available',
    body: 'No usable proof was recorded for this AI judgement. The result itself is unaffected.',
  },
};

export default function ProofBadge({ proof }: { proof?: LlmProof | null }) {
  if (!proof) return <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>No inference proof recorded.</p>;
  const c = COPY[proof.level];
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer' }}>
        <span className={`status ${c.cls}`}>{c.title}</span>
        <span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>{proof.model}</span>
      </summary>
      <div className="muted" style={{ fontSize: 13, marginTop: 8, display: 'grid', gap: 4 }}>
        <span>{c.body}{proof.level === 'unverified' && proof.note ? ` (${proof.note})` : ''}</span>
        {proof.chatId && <span>Response id: <span className="mono">{proof.chatId}</span></span>}
        {proof.signingAddress && <span>Signer: <span className="mono">{shortAddr(proof.signingAddress)}</span> ({proof.signingAlgo})</span>}
        {proof.requestHash && <span>Request hash: <span className="mono">{proof.requestHash.slice(0, 16)}…</span></span>}
        {proof.responseHash && <span>Response hash: <span className="mono">{proof.responseHash.slice(0, 16)}…</span></span>}
        <span>Checked {new Date(proof.checkedAt).toLocaleString()}</span>
      </div>
    </details>
  );
}
