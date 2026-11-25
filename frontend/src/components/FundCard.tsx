'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, apiErrorText } from '@/lib/api';
import { FAUCET_URL } from '@/lib/config';
import { fmtQor, fmtUqor, WEI_PER_UQOR } from '@/lib/money';
import { connectQorex, requireAccount, sendQor, WalletError } from '@/lib/qorex';
import type { AgreementDetail, FundingInfo, FundingReport } from '@/lib/types';
import { useSession } from '@/providers/Session';
import { useToast } from '@/providers/Toasts';
import CopyBox from './CopyBox';
import Notice from './Notice';
import { Icon } from './Icon';

/** Rough network fee of one QoreX transfer at the gas limit we suggest (measured on testnet: 45,000 uqor). */
const FEE_UQOR = 45_000n;
const STEPS = ['Contract ready', 'Approve in QoreX', 'Checking the payment', 'Funded'] as const;
type Stage = 'idle' | 'wallet' | 'checking' | 'confirming';
const AT: Record<Stage, number> = { idle: 0, wallet: 1, checking: 2, confirming: 3 };

// A payment that was sent but not yet acknowledged survives a reload, so the page never invites paying twice.
const keyFor = (id: string) => `agentbazaar.funding.${id}`;
const loadPending = (id: string) => (typeof window === 'undefined' ? null : localStorage.getItem(keyFor(id)));
const savePending = (id: string, hash: string | null) => (hash ? localStorage.setItem(keyFor(id), hash) : localStorage.removeItem(keyFor(id)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Steps({ stage }: { stage: Stage }) {
  const at = AT[stage];
  return (
    <>
      <ol className="stepper" aria-label="Funding progress" style={{ marginBottom: 18, listStyle: 'none', flexWrap: 'wrap', rowGap: 8 }}>
        {STEPS.map((label, i) => (
          <li key={label} className={`step-pill ${i < at ? 'done' : i === at ? 'on' : ''}`} aria-current={i === at ? 'step' : undefined}>
            <i>{i < at ? <Icon name="check" /> : i + 1}</i>{label}
          </li>
        ))}
      </ol>
      <span className="sr" role="status" aria-live="polite">Step {at + 1} of {STEPS.length}: {STEPS[at]}</span>
    </>
  );
}

export default function FundCard({ a, isClient, signedIn, onFunded }: {
  a: AgreementDetail['agreement']; isClient: boolean; signedIn: boolean; onFunded: () => void;
}) {
  const session = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'warn' | 'bad'; text: string }>();

  const funding = useQuery({
    queryKey: ['funding', a.id],
    queryFn: () => api<FundingInfo>(`/agreements/${a.id}/funding`),
    enabled: isClient && signedIn,
    refetchInterval: 6000,
  });
  const balance = useQuery({
    queryKey: ['balance', session.qorAddress],
    queryFn: () => api<{ balanceWei: string }>('/me/balance', { auth: true }),
    enabled: isClient && !!session.qorAddress,
  });

  const settle = useCallback((hash: string | null) => { savePending(a.id, hash); setPending(hash); }, [a.id]);

  /** Tell the backend about a sent payment and wait for its answer. The hash is only forgotten once the answer is final. */
  const report = useCallback(async (hash: string) => {
    setStage('checking');
    setMessage(undefined);
    for (const pause of [0, 2000, 3000, 5000, 8000, 12000]) {
      await sleep(pause);
      try {
        const r = await api<FundingReport>(`/agreements/${a.id}/funding`, { body: { txHash: hash } });
        if (r.funded) { settle(null); setStage('confirming'); toast('Payment confirmed', 'The job starts as soon as the chain event is read.'); onFunded(); return; }
        if (r.shortfallUqor !== undefined && r.shortfallUqor !== '0') {
          settle(null); setStage('idle');
          setMessage({ kind: 'warn', text: `Payment received, but ${fmtUqor(r.shortfallUqor)} is still missing. Send the rest to start the job.` });
          void funding.refetch(); return;
        }
        if (r.status && r.status !== 'agreed') { settle(null); setStage('confirming'); setMessage({ kind: 'warn', text: r.note ?? `This job is ${r.status}.` }); onFunded(); return; }
        // Verified, but confirming on the contract failed for now. The backend keeps trying on its own.
        setStage('confirming'); setMessage({ kind: 'warn', text: r.error ?? 'Your payment is verified and is being confirmed.' }); onFunded(); return;
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        if (status === 404 || status === 503 || status === 0) continue; // still confirming, or a service is briefly away
        settle(null); setStage('idle'); setMessage({ kind: 'bad', text: apiErrorText(e) }); void funding.refetch(); return;
      }
    }
    setStage('idle');
    setMessage({ kind: 'warn', text: 'Your payment was sent but could not be checked yet. Do not pay again; use "Check payment".' });
  }, [a.id, funding, onFunded, settle, toast]);

  // After a reload, check an unacknowledged payment once.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !isClient || !signedIn) return;
    resumed.current = true;
    const hash = loadPending(a.id);
    if (hash) { setPending(hash); void report(hash); }
  }, [a.id, isClient, signedIn, report]);

  async function pay() {
    if (!funding.data) return;
    setMessage(undefined);
    setStage('wallet');
    let hash: string;
    try {
      const { provider, account } = await connectQorex();
      requireAccount(account, session.qorAddress!);
      const fresh = await api<FundingInfo>(`/agreements/${a.id}/funding`); // pay only what is missing right now
      if (fresh.shortfallUqor === '0') { setStage('idle'); void funding.refetch(); return; }
      hash = (await sendQor(provider, account, fresh.payTo, BigInt(fresh.shortfallUqor), fresh.gasLimit)).txHash;
    } catch (e) {
      setStage('idle');
      const rejected = e instanceof WalletError && ['rejected', 'wrong_account', 'not_installed', 'too_old'].includes(e.code);
      const text = e instanceof ApiError ? apiErrorText(e) : (e as Error).message;
      // Any other wallet error may come after the transfer left: say so before the person tries again.
      setMessage({ kind: 'bad', text: rejected || e instanceof ApiError ? text : `${text} Check the history in QoreX before paying again.` });
      void funding.refetch();
      return;
    }
    settle(hash);
    void balance.refetch();
    void qc.invalidateQueries({ queryKey: ['balance'] });
    await report(hash);
  }

  if (!signedIn) return <div className="card"><h3>Fund this job</h3><p className="muted" style={{ marginBottom: 14 }}>Log in with the account that posted the job.</p><button className="btn btn-primary" onClick={session.openConnect}><Icon name="lock" />Log in</button></div>;
  if (!isClient) return <div className="card"><h3>Waiting for funding</h3><p className="muted">The client has to lock {fmtQor(a.priceTinybar)} in the contract before the agent starts.</p></div>;

  const f = funding.data;
  const shortfall = f ? BigInt(f.shortfallUqor) : null;
  const have = balance.data ? BigInt(balance.data.balanceWei) / WEI_PER_UQOR : null;
  const tooLittle = shortfall !== null && have !== null && have < shortfall + FEE_UQOR;
  const covered = shortfall === 0n;
  const busy = stage === 'wallet' || stage === 'checking';

  return (
    <div className="stack">
      <div className="escrow">
        <div className="k">Lock in escrow</div>
        <div className="amt">{fmtQor(a.priceTinybar)}</div>
        <div className="k">Contract made for this job</div>
        <div className="addr">{f?.payTo ?? a.escrowAddress}</div>
        <div className="meta"><span>Released to the agent only on PASS</span><span>Returned to you on FAIL or if the deadline passes</span></div>
      </div>
      <div className="card">
        <Steps stage={covered && stage === 'idle' ? 'confirming' : stage} />
        {message && <Notice kind={message.kind} style={{ marginBottom: 14 }}>{message.text}</Notice>}
        {funding.error ? <Notice kind="bad" style={{ marginBottom: 14 }}>{apiErrorText(funding.error)} <button className="link" onClick={() => funding.refetch()}>Try again</button></Notice> : null}
        {stage === 'confirming' || (covered && stage === 'idle' && !pending) ? (
          <div className="row" style={{ gap: 12 }}><span className="ico-run" style={{ width: 24, height: 24 }} /><b>The contract holds your payment. Confirming on QoreChain…</b></div>
        ) : stage === 'checking' ? (
          <div className="row" style={{ gap: 12 }}><span className="ico-run" style={{ width: 24, height: 24 }} /><b>Checking your payment on QoreChain…</b></div>
        ) : pending ? (
          <div className="stack" style={{ gap: 12 }}>
            <button className="btn btn-primary btn-lg" onClick={() => void report(pending)}>Check payment</button>
            <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => { if (window.confirm('Forget this payment? Only do this if QoreX shows it failed. Paying again could pay twice; any excess is returned when the job settles.')) { settle(null); setMessage(undefined); } }}>The transfer failed in QoreX: start over</button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {tooLittle && <Notice kind="warn">Your wallet holds {fmtUqor(have!)}, less than {fmtUqor(shortfall!)} plus the network fee. <a className="link" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Get test QOR</a></Notice>}
            <button className="btn btn-primary btn-lg" onClick={pay} disabled={busy || !f}>
              {stage === 'wallet' ? 'Approve in QoreX…' : !f ? 'Loading…' : f.shortfallUqor === f.amountUqor ? `Pay ${fmtUqor(f.shortfallUqor)} with QoreX` : `Pay the remaining ${fmtUqor(f.shortfallUqor)} with QoreX`}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>QoreX sends a normal transfer to this job’s contract, signed with a classical and a post-quantum key. The network fee is about {fmtUqor(FEE_UQOR)}.</span>
          </div>
        )}
        {pending && <div style={{ marginTop: 14 }}><CopyBox label="Your payment transaction" value={pending} /></div>}
      </div>
    </div>
  );
}
