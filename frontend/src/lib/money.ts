// All money is tinybar (1 HBAR = 10^8 tinybar) as a decimal string from the API, handled as bigint here. No floats.
// Wallets and JSON-RPC use weibar (10^18 per HBAR): a transaction `value` must be tinybar x 10^10.

export const TINYBAR = 100_000_000n;
const WEI_PER_TINYBAR = 10_000_000_000n;

/** "12.5" -> tinybar bigint, or null if it is not a valid positive HBAR amount with at most 8 decimals. */
export function hbarToTinybar(input: string): bigint | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return BigInt(i) * TINYBAR + BigInt((f + '00000000').slice(0, 8));
}

/** tinybar -> "1,234.5 ℏ". Up to 4 decimals; tiny amounts show more so they never display as 0. */
export function fmtHbar(tinybar: string | bigint | number | null | undefined, unit = true): string {
  const v = BigInt(tinybar ?? 0);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / TINYBAR;
  const frac = (a % TINYBAR).toString().padStart(8, '0');
  let decimals = frac.slice(0, 4).replace(/0+$/, '');
  if (!decimals && a > 0n && whole === 0n) decimals = frac.replace(/0+$/, ''); // e.g. 0.00000100
  const s = whole.toLocaleString('en-US') + (decimals ? `.${decimals}` : '');
  return (neg ? '−' : '') + s + (unit ? ' ℏ' : '');
}

/** tinybar -> plain decimal string for an input box ("1.5"). */
export function tinybarToInput(tinybar: string | bigint): string {
  const v = BigInt(tinybar);
  const whole = v / TINYBAR;
  const frac = (v % TINYBAR).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** The `value` to send with a wallet transaction that must deliver exactly `tinybar` to a Hedera contract. */
export const toWeibar = (tinybar: string | bigint): bigint => BigInt(tinybar) * WEI_PER_TINYBAR;

/** Wallet/RPC balance (weibar) -> tinybar. */
export const fromWeibar = (wei: bigint): bigint => wei / WEI_PER_TINYBAR;

export const sumTinybar = (xs: (string | bigint)[]): bigint => xs.reduce<bigint>((t, x) => t + BigInt(x), 0n);

/** Wei -> "1,234.5 QOR" (QOR has 18 decimals on chain and 6 on the native lane). Display only. */
export function fmtQor(wei: string | bigint | number | null | undefined, unit = true): string {
  const v = BigInt(wei ?? 0);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const one = 10n ** 18n;
  const frac = (a % one).toString().padStart(18, '0');
  let decimals = frac.slice(0, 4).replace(/0+$/, '');
  if (!decimals && a > 0n && a < one) decimals = frac.slice(0, 6).replace(/0+$/, '') || '000000';
  const s = (a / one).toLocaleString('en-US') + (decimals ? `.${decimals}` : '');
  return (neg ? '−' : '') + s + (unit ? ' QOR' : '');
}

/** 1 uqor = 1e12 wei: native transfers count QOR with 6 decimals. */
export const WEI_PER_UQOR = 1_000_000_000_000n;

/** An exact native amount, e.g. 40001 uqor -> "0.040001 QOR". Used where the user pays, so nothing is rounded away. */
export function fmtUqor(uqor: string | bigint): string {
  const v = BigInt(uqor);
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${(v / 1_000_000n).toLocaleString('en-US')}${frac ? `.${frac}` : ''} QOR`;
}
