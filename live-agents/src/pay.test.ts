import { describe, expect, it } from 'vitest';
import { checkPayment } from './pay.js';

const ok = { payTo: 'qor1a22ns5dl0auy46l3awhune9fdkh8z94nw3g0c2', amountUqor: 200_000n, owedUqor: 200_000n, capUqor: 10_000_000n };

describe('checkPayment (spend control)', () => {
  it('accepts exactly what is owed to a valid qor1 address', () => { expect(checkPayment(ok)).toBeNull(); });
  it('accepts less than owed but never more', () => {
    expect(checkPayment({ ...ok, amountUqor: 100_000n })).toBeNull();
    expect(checkPayment({ ...ok, amountUqor: 200_001n })).toMatch(/more than/);
  });
  it('refuses an invalid or look-alike payee', () => {
    expect(checkPayment({ ...ok, payTo: '0x7CeaCe15934797DD1BA896523B213b7Bfe789BD3' })).toMatch(/valid qor1/);
    expect(checkPayment({ ...ok, payTo: 'cosmos1a22ns5dl0auy46l3awhune9fdkh8z94nw3g0c2' })).toMatch(/valid qor1/);
    expect(checkPayment({ ...ok, payTo: ok.payTo.slice(0, -1) })).toMatch(/valid qor1/);
    expect(checkPayment({ ...ok, payTo: ok.payTo.toUpperCase() })).toMatch(/valid qor1/);
  });
  it('refuses a zero or negative amount', () => {
    expect(checkPayment({ ...ok, amountUqor: 0n })).toMatch(/not positive/);
    expect(checkPayment({ ...ok, amountUqor: -5n })).toMatch(/not positive/);
  });
  it('enforces the hard per-payment cap even when more is owed', () => {
    expect(checkPayment({ ...ok, amountUqor: 10_000_001n, owedUqor: 20_000_000n })).toMatch(/cap/);
    expect(checkPayment({ ...ok, amountUqor: 10_000_000n, owedUqor: 20_000_000n })).toBeNull();
  });
});
