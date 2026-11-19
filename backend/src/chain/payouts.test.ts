import { describe, expect, it } from 'vitest';
import { evaluatePayment, isTxHash, normalizeTxHash, weiToUqorCeil, type NativeTx } from './payouts.js';

const A = 'qor13d8sjfuffh9exw4cg7n37pydyyt3cuahcw3q7h';
const B = 'qor1a22ns5dl0auy46l3awhune9fdkh8z94nw3g0c2';
// Shape copied from the real testnet receipt of tx 29CE54CE...8B8C (a hybrid-signed 0.01 QOR transfer, 17 Nov 2026).
const receipt = (over: Partial<NativeTx['tx']['body']> = {}, resp: Partial<NativeTx['tx_response']> = {}): NativeTx => ({
  tx: { body: {
    messages: [{ '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: A, to_address: B, amount: [{ denom: 'uqor', amount: '10000' }] }],
    extension_options: [{ '@type': '/qorechain.pqc.v1.PQCHybridSignature', algorithm_id: 1 }],
    non_critical_extension_options: [],
    ...over,
  } },
  tx_response: { code: 0, height: '10269962', timestamp: '2026-11-17T18:25:07Z', txhash: '29CE54CE', ...resp },
});
const want = { from: A, to: B, minUqor: 10_000n, notBeforeUnix: Date.parse('2026-11-17T18:00:00Z') / 1000 };

describe('evaluatePayment', () => {
  it('accepts the exact payment from the real receipt shape', () => {
    const r = evaluatePayment(receipt(), want);
    expect(r).toEqual({ ok: true, paidUqor: 10_000n, height: 10269962n, timeUnix: Date.parse('2026-11-17T18:25:07Z') / 1000 });
  });
  it('accepts an overpayment and adds up several transfers in one tx', () => {
    const msg = { '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: A, to_address: B, amount: [{ denom: 'uqor', amount: '6000' }] };
    expect(evaluatePayment(receipt({ messages: [msg, msg] }), want)).toMatchObject({ ok: true, paidUqor: 12_000n });
  });
  it('rejects a failed transaction', () => {
    expect(evaluatePayment(receipt({}, { code: 5 }), want)).toMatchObject({ ok: false });
  });
  it('rejects a payment from someone else or to someone else', () => {
    expect(evaluatePayment(receipt(), { ...want, from: B })).toMatchObject({ ok: false });
    expect(evaluatePayment(receipt(), { ...want, to: A })).toMatchObject({ ok: false });
  });
  it('rejects an underpayment, and other denominations do not count', () => {
    expect(evaluatePayment(receipt(), { ...want, minUqor: 10_001n })).toMatchObject({ ok: false });
    const other = { '@type': '/cosmos.bank.v1beta1.MsgSend', from_address: A, to_address: B, amount: [{ denom: 'ufoo', amount: '99999' }] };
    expect(evaluatePayment(receipt({ messages: [other] }), want)).toMatchObject({ ok: false });
  });
  it('ignores messages that are not bank sends', () => {
    const other = { '@type': '/cosmos.staking.v1beta1.MsgDelegate', from_address: A, to_address: B, amount: [{ denom: 'uqor', amount: '99999' }] };
    expect(evaluatePayment(receipt({ messages: [other] }), want)).toMatchObject({ ok: false });
  });
  it('rejects a transaction without the ML-DSA-87 hybrid signature extension', () => {
    expect(evaluatePayment(receipt({ extension_options: [] }), want)).toMatchObject({ ok: false });
    expect(evaluatePayment(receipt({ extension_options: [{ '@type': '/qorechain.pqc.v1.PQCHybridSignature', algorithm_id: 2 }] }), want)).toMatchObject({ ok: false });
  });
  it('finds the extension in the non-critical list too', () => {
    const r = evaluatePayment(receipt({ extension_options: [], non_critical_extension_options: [{ '@type': '/qorechain.pqc.v1.PQCHybridSignature', algorithm_id: '1' }] }), want);
    expect(r.ok).toBe(true);
  });
  it('rejects a payment made before the task was released', () => {
    expect(evaluatePayment(receipt(), { ...want, notBeforeUnix: Date.parse('2026-11-17T18:25:08Z') / 1000 })).toMatchObject({ ok: false });
    expect(evaluatePayment(receipt(), { ...want, notBeforeUnix: Date.parse('2026-11-17T18:25:07Z') / 1000 }).ok).toBe(true);
  });
});

describe('amounts and hashes', () => {
  it('rounds a wei price up to whole uqor', () => {
    expect(weiToUqorCeil(10n ** 18n)).toBe(1_000_000n);
    expect(weiToUqorCeil(40_000_000_000_000_000n)).toBe(40_000n); // 0.04 QOR
    expect(weiToUqorCeil(1n)).toBe(1n);
    expect(weiToUqorCeil(10n ** 12n + 1n)).toBe(2n);
  });
  it('normalises and validates tx hashes', () => {
    const h = '29ce54ceb6e3b2408b20e71407da7b302abce96b3d40a23535c101baad528b8c';
    expect(normalizeTxHash('0x' + h)).toBe(h.toUpperCase());
    expect(isTxHash(h)).toBe(true);
    expect(isTxHash('0x' + h)).toBe(true);
    expect(isTxHash('xyz')).toBe(false);
    expect(isTxHash(h.slice(2))).toBe(false);
  });
});
