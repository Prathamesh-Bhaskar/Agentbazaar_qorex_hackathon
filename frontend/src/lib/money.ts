// All money is wei (1 QOR = 10^18) as a decimal string from the API, handled as bigint here. No floats.
// Native QoreX transfers count QOR with 6 decimals (uqor), so amounts people type are limited to 6 decimals.

/** 1 uqor = 1e12 wei. */
export const WEI_PER_UQOR = 1_000_000_000_000n;
const ONE_QOR = 10n ** 18n;

/** "12.5" -> wei, or null unless it is a plain non-negative QOR amount with at most 6 decimals. */
export function parseQor(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return BigInt(i) * ONE_QOR + BigInt((f + '000000').slice(0, 6)) * WEI_PER_UQOR;
}

const split = (a: bigint) => ({ whole: a / ONE_QOR, frac: (a % ONE_QOR).toString().padStart(18, '0') });

/** Wei -> "1,234.5 QOR". Up to 4 decimals; tiny amounts show up to 6 so they never display as 0. */
export function fmtQor(wei: string | bigint | number | null | undefined, unit = true): string {
  const v = BigInt(wei ?? 0);
  const neg = v < 0n;
  const { whole, frac } = split(neg ? -v : v);
  let decimals = frac.slice(0, 4).replace(/0+$/, '');
  if (!decimals && whole === 0n && v !== 0n) decimals = frac.slice(0, 6).replace(/0+$/, '') || '000000';
  const s = whole.toLocaleString('en-US') + (decimals ? `.${decimals}` : '');
  return (neg ? '−' : '') + s + (unit ? ' QOR' : '');
}

/** Wei -> plain decimal string for an input box ("1.5"), exact to 6 decimals. */
export function weiToInput(wei: string | bigint): string {
  const { whole, frac } = split(BigInt(wei));
  const d = frac.slice(0, 6).replace(/0+$/, '');
  return d ? `${whole}.${d}` : `${whole}`;
}

/** An exact native amount, e.g. 40001 uqor -> "0.040001 QOR". Used where the user pays, so nothing is rounded away. */
export function fmtUqor(uqor: string | bigint): string {
  const v = BigInt(uqor);
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${(v / 1_000_000n).toLocaleString('en-US')}${frac ? `.${frac}` : ''} QOR`;
}

export const sumWei = (xs: (string | bigint)[]): bigint => xs.reduce<bigint>((t, x) => t + BigInt(x), 0n);
