'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, apiErrorText, ApiError, readSession, writeSession, type StoredSession } from '@/lib/api';
import { shortAddr } from '@/lib/format';
import { connectQorex, findQorex, QORE_NETWORK_NAME, signText } from '@/lib/qorex';
import { useToast } from './Toasts';

export type StepKey = 'connect' | 'sign';
export type StepState = 'wait' | 'run' | 'ok' | 'bad';
const FRESH: Record<StepKey, StepState> = { connect: 'wait', sign: 'wait' };

/** What the person typed in the connect form. Login needs the password only if the account has one. */
export type AuthIntent = { mode: 'login' | 'signup'; password?: string; email?: string; displayName?: string; role?: 'client' | 'lister' | 'both' };

type Ctx = {
  ready: boolean;
  signedIn: boolean;
  /** The signed-in account: 0x form (matches API records) and qor1 form (what QoreX shows). */
  address?: `0x${string}`;
  qorAddress?: string;
  /** False once we have looked for QoreX and not found it. */
  hasWallet: boolean;
  steps: Record<StepKey, StepState>;
  error?: string;
  busy: boolean;
  modalOpen: boolean;
  openConnect: () => void;
  closeConnect: () => void;
  signIn: (intent?: AuthIntent) => Promise<void>;
  /** Back to the form after a failed attempt. */
  resetSteps: () => void;
  signOut: () => void;
};

const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => {
  const c = useContext(SessionCtx);
  if (!c) throw new Error('useSession must be used inside SessionProvider');
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [hasWallet, setHasWallet] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [steps, setSteps] = useState(FRESH);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setReady(true);
    void findQorex().then((p) => setHasWallet(!!p));
  }, []);

  // The API said the session is no longer valid.
  useEffect(() => {
    const onExpired = () => { setSession(null); toast('Session expired', 'Log in again to continue', 'info'); };
    window.addEventListener('gv:session-expired', onExpired);
    return () => window.removeEventListener('gv:session-expired', onExpired);
  }, [toast]);

  const mark = (k: StepKey, v: StepState) => setSteps((s) => ({ ...s, [k]: v }));

  const signIn = useCallback(async (intent: AuthIntent = { mode: 'login' }) => {
    setBusy(true);
    setError(undefined);
    setSteps({ ...FRESH, connect: 'run' });
    let current: StepKey = 'connect';
    try {
      // 1. connect QoreX (the wallet must already be on testnet; a website cannot switch it)
      const { provider, account } = await connectQorex();
      setHasWallet(true);
      mark('connect', 'ok');

      // 2. prove ownership: sign the server's one-time sign-in text. No transaction.
      current = 'sign';
      mark('sign', 'run');
      const { nonce, message, passwordRequired } = await api<{ nonce: string; message: string; passwordRequired: boolean }>('/auth/nonce', { body: { address: account.qor } });
      if (intent.mode === 'login' && passwordRequired && !intent.password) throw new Error('This account is protected by a password. Go back, enter it and try again.');
      const signature = await signText(provider, account, message);
      type Session = { token: string; expiresAt: string; user: { address: string; qorAddress: string } };
      const out = intent.mode === 'signup'
        ? await api<Session>('/auth/signup', { body: { address: account.qor, nonce, signature, email: intent.email, password: intent.password, displayName: intent.displayName || undefined, role: intent.role } })
        : await api<Session>('/auth/verify', { body: { address: account.qor, nonce, signature, password: intent.password || undefined } });
      const stored: StoredSession = { token: out.token, address: out.user.address, qor: out.user.qorAddress, expiresAt: out.expiresAt };
      writeSession(stored);
      setSession(stored);
      mark('sign', 'ok');
      setModalOpen(false);
      toast(intent.mode === 'signup' ? 'Account created' : 'Signed in', `${shortAddr(stored.qor)} · ${QORE_NETWORK_NAME}`);
    } catch (e) {
      mark(current, 'bad');
      setError(e instanceof ApiError ? apiErrorText(e) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const signOut = useCallback(() => {
    writeSession(null);
    setSession(null);
    toast('Logged out', 'To disconnect this site completely, remove it in QoreX.', 'info');
  }, [toast]);

  const resetSteps = useCallback(() => { setSteps(FRESH); setError(undefined); }, []);

  const value = useMemo<Ctx>(() => ({
    ready,
    signedIn: !!session,
    address: session?.address as `0x${string}` | undefined,
    qorAddress: session?.qor,
    hasWallet, steps, error, busy, modalOpen,
    openConnect: () => { setError(undefined); setSteps(FRESH); setModalOpen(true); },
    closeConnect: () => setModalOpen(false),
    signIn, resetSteps, signOut,
  }), [ready, session, hasWallet, steps, error, busy, modalOpen, signIn, resetSteps, signOut]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
