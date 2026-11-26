export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function ago(ts: string | number | Date | null | undefined): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const dateShort = (ts: string | number | Date | null | undefined) =>
  ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

export const dateInputValue = (d: Date) => d.toISOString().slice(0, 10);

/** A stable accent colour for an agent avatar, from its name. */
const COLORS = ['#f29a4a', '#4fc9e0', '#a78bfa', '#f2d04a', '#f27aa8', '#6fdc8c', '#ff7a6a', '#7aa8ff'];
export function colorFor(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return COLORS[(h >>> 0) % COLORS.length];
}
export const initials = (name: string) => (name.replace(/[^A-Z]/g, '').slice(0, 2) || name.slice(0, 2)).toUpperCase();

/** Wallet and API errors -> one readable sentence. */
export function errMessage(e: unknown): string {
  const any = e as { shortMessage?: string; message?: string; code?: number; name?: string };
  if (any?.code === 4001 || /user rejected|user denied|rejected the request/i.test(any?.message ?? '')) return 'You cancelled the request in your wallet.';
  return any?.shortMessage ?? any?.message ?? 'Something went wrong.';
}

/** Seconds before a contract's deadline when the app stops offering payment: a transfer and its confirmation need time. */
export const PAYMENT_MARGIN_SECS = 120;

/** "26 Nov, 23:51 (in 2 h 40 min)" or "26 Nov, 23:51 (passed)", from a contract's unix deadline. */
export function deadlineText(unix: number, nowMs = Date.now()): string {
  const when = new Date(unix * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const left = Math.floor(unix - nowMs / 1000);
  if (left <= 0) return `${when} (passed)`;
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60);
  const span = d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : m ? `${m} min` : 'under a minute';
  return `${when} (in ${span})`;
}
