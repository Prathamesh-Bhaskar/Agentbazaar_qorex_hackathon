'use client';
import { useState } from 'react';
import Modal from './Modal';
import Field, { PasswordInput } from './Field';
import { QOREX_ICON_DATA_URI } from '@qorechain/qorex-types/icon';
import { Icon } from './Icon';
import { QOREX_INSTALL_URL } from '@/lib/qorex';
import { useSession, type AuthIntent, type StepKey } from '@/providers/Session';

const LABELS: Record<StepKey, string> = {
  connect: 'Connect QoreX (switched to testnet)',
  sign: 'Sign the one-time sign-in message',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Errs = Partial<Record<'email' | 'password' | 'confirm', string>>;

export default function ConnectModal() {
  const s = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'client' | 'lister' | 'both'>('both');
  const [errs, setErrs] = useState<Errs>({});
  const [last, setLast] = useState<AuthIntent>({ mode: 'login' });
  if (!s.modalOpen) return null;
  const started = Object.values(s.steps).some((v) => v !== 'wait');
  const signup = mode === 'signup';

  function switchMode(m: 'login' | 'signup') { setMode(m); setErrs({}); }

  function go() {
    let intent: AuthIntent;
    if (signup) {
      const e: Errs = {};
      if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address, like name@example.com.';
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) e.password = 'Use at least 8 characters, with a letter and a number.';
      if (password !== confirm) e.confirm = 'The two passwords do not match.';
      setErrs(e);
      if (Object.keys(e).length) {
        // Send the person to the first problem.
        const first = (['email', 'password', 'confirm'] as const).find((k) => e[k]);
        document.getElementById(`gv-auth-${first}`)?.focus();
        return;
      }
      intent = { mode, email: email.trim(), password, displayName: name.trim() || undefined, role };
    } else {
      setErrs({});
      intent = { mode, password: password || undefined };
    }
    setLast(intent);
    void s.signIn(intent);
  }

  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };

  return (
    <Modal onClose={s.closeConnect} label="Log in or sign up">
      <h2>{signup ? 'Create your account' : 'Log in'} <button onClick={s.closeConnect} aria-label="Close">&times;</button></h2>
      <p className="sub">AgentBazaar runs on QoreChain testnet. Your account is your <b>QoreX</b> wallet{signup ? ', protected by an email and password' : ', plus your password if you set one'}.</p>

      {!started ? (
        <>
          <div className="gvm-tabs" role="tablist" aria-label="Log in or sign up">
            <button role="tab" aria-selected={!signup} className="gvm-btn" onClick={() => switchMode('login')}>Log in</button>
            <button role="tab" aria-selected={signup} className="gvm-btn" onClick={() => switchMode('signup')}>Sign up</button>
          </div>

          <div className="form-grid" style={{ gap: 14, marginBottom: 16 }} role="tabpanel">
            {signup && (
              <>
                <Field label="Email" error={errs.email}>
                  <input id="gv-auth-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
                </Field>
                <Field label="Display name (optional)">
                  <input className="input" autoComplete="nickname" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
                </Field>
              </>
            )}
            <Field
              label={signup ? 'Password' : 'Password (only if you set one)'}
              hint={signup ? 'At least 8 characters, with a letter and a number.' : undefined}
              error={errs.password}
            >
              <PasswordInput id="gv-auth-password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
            </Field>
            {signup && (
              <>
                <Field label="Confirm password" error={errs.confirm}>
                  <PasswordInput id="gv-auth-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={onEnter} />
                </Field>
                <Field label="What will you do here?">
                  <select className="select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="both">I will hire agents and list agents</option>
                    <option value="client">I will hire agents</option>
                    <option value="lister">I will list agents</option>
                  </select>
                </Field>
              </>
            )}
          </div>

          <button className="gvm-opt" onClick={go} disabled={s.busy}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={QOREX_ICON_DATA_URI} alt="" width={32} height={32} /><span>{signup ? 'Sign up with QoreX' : 'Log in with QoreX'}<small>Post-quantum signature · no transaction</small></span>
          </button>
          {!s.hasWallet && (
            <div className="gvm-err" role="alert">QoreX was not detected. <a className="link" href={QOREX_INSTALL_URL} target="_blank" rel="noopener noreferrer">Install QoreX</a>, then reload.</div>
          )}
          <p className="gvm-note">{signup ? 'QoreX signs one message. No transaction, no cost. Later logins need the wallet and this password.' : 'Signing in does not send a transaction and costs nothing. New here? Choose Sign up.'} A brand-new QoreX account must send one transaction first, which registers its post-quantum key. Check that the sign-in message names this site.</p>
        </>
      ) : (
        <>
          <div className="gvm-steps" role="status" aria-live="polite">
            {(Object.keys(LABELS) as StepKey[]).map((k) => (
              <div key={k} className={`gvm-step ${s.steps[k] === 'wait' ? '' : s.steps[k]}`}>
                <i>{s.steps[k] === 'ok' ? <Icon name="check" /> : s.steps[k] === 'bad' ? <Icon name="x" /> : null}</i>
                {LABELS[k]}
                <span className="sr">{{ wait: ' (waiting)', run: ' (in progress)', ok: ' (done)', bad: ' (failed)' }[s.steps[k]]}</span>
              </div>
            ))}
          </div>
          {s.error && <div className="gvm-err" role="alert">{s.error}</div>}
          {s.busy ? <p className="gvm-note">Approve each request in QoreX.</p> : (
            <div className="gvm-acts">
              <button className="gvm-btn" onClick={s.closeConnect}>Close</button>
              {s.error && <button className="gvm-btn" onClick={s.resetSteps}>Back</button>}
              {s.error && <button className="gvm-btn p" onClick={() => void s.signIn(last)}>Try again</button>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
