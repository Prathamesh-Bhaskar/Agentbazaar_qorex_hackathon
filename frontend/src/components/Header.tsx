'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/providers/Session';
import { fmtQor } from '@/lib/money';
import { api } from '@/lib/api';
import { QORE_NETWORK_NAME } from '@/lib/qorex';
import { shortAddr } from '@/lib/format';
import { FAUCET_URL } from '@/lib/config';
import Modal from './Modal';
import ThemeToggle from './ThemeToggle';
import { Icon } from './Icon';

const NAV = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/post-job', label: 'Post a job' },
  { href: '/list-agent', label: 'List an agent' },
  { href: '/dashboard', label: 'Dashboard' },
];

/** The balance is read by the backend (the chain's REST API does not allow every browser origin). */
const useBalance = () => {
  const { qorAddress } = useSession();
  return useQuery({
    queryKey: ['balance', qorAddress],
    queryFn: () => api<{ balanceWei: string }>('/me/balance', { auth: true }),
    enabled: !!qorAddress, refetchInterval: 20_000,
  });
};

function WalletChip({ onOpen }: { onOpen: () => void }) {
  const { qorAddress } = useSession();
  const bal = useBalance();
  return (
    <button className="wallet-chip" onClick={onOpen} title="Wallet">
      <span className="bal"><b>{bal.data ? fmtQor(bal.data.balanceWei) : bal.isError ? '—' : '…'}</b></span>
      <span className="addr">{shortAddr(qorAddress)}</span>
    </button>
  );
}

function WalletMenu({ onClose }: { onClose: () => void }) {
  const { qorAddress, signOut } = useSession();
  const bal = useBalance();
  return (
    <Modal onClose={onClose} label="Your wallet">
      <h2>Your wallet <button onClick={onClose} aria-label="Close">&times;</button></h2>
      <p className="sub">QoreX &middot; {QORE_NETWORK_NAME}</p>
      <dl className="gvm-rows">
        <dt>Address</dt><dd className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{qorAddress}</dd>
        <dt>Balance</dt><dd>{bal.data ? fmtQor(bal.data.balanceWei) : bal.isError ? 'Could not read it' : '…'}</dd>
      </dl>
      <div className="gvm-acts">
        <Link className="gvm-btn" href="/dashboard" onClick={onClose}>Dashboard</Link>
        <Link className="gvm-btn" href="/account" onClick={onClose}>Account</Link>
        <button className="gvm-btn" onClick={() => { onClose(); signOut(); }}>Log out</button>
      </div>
      <a className="gvm-btn" style={{ width: '100%', marginTop: 10 }} href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Get test QOR (faucet)</a>
    </Modal>
  );
}

export default function Header() {
  const path = usePathname();
  const s = useSession();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const active = (href: string) => path === href || path.startsWith(href + '/');
  useEffect(() => { setMobile(false); }, [path]);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobile(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobile]);
  return (
    <header className={`gv-header${scrolled ? ' scrolled' : ''}`}>
      <div className="container gv-nav">
        <Link className="gv-logo" href="/" aria-label="AgentBazaar home">
          <span className="gv-wordmark">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 5l8 7-8 7zM11 5l8 7-8 7z" /></svg>
            <span>Agent<b>Bazaar</b></span>
          </span>
        </Link>
        <nav className="gv-links" aria-label="App">
          {NAV.map((n) => <Link key={n.href} href={n.href} className={active(n.href) ? 'active' : ''} aria-current={active(n.href) ? 'page' : undefined}>{n.label}</Link>)}
        </nav>
        <div className="gv-right">
          <span className="net-pill"><i />{QORE_NETWORK_NAME}</span>
          <ThemeToggle />
          {s.ready && s.signedIn
            ? <WalletChip onOpen={() => setMenu(true)} />
            : <button className="btn btn-primary btn-sm" onClick={s.openConnect}><Icon name="lock" /><span>Log in<span className="hide-sm"> / Sign up</span></span></button>}
          <button className="burger" aria-label="Menu" aria-expanded={mobile} aria-controls="mobile-nav" onClick={() => setMobile((v) => !v)}><span /><span /><span /></button>
        </div>
      </div>
      <nav id="mobile-nav" className={`mnav ${mobile ? 'open' : ''}`} aria-label="Mobile">
        {[...NAV, ...(s.signedIn ? [{ href: '/account', label: 'Account' }] : [])].map((n) => <Link key={n.href} href={n.href} className={active(n.href) ? 'active' : ''} aria-current={active(n.href) ? 'page' : undefined} onClick={() => setMobile(false)}>{n.label}</Link>)}
      </nav>
      {menu && <WalletMenu onClose={() => setMenu(false)} />}
    </header>
  );
}
