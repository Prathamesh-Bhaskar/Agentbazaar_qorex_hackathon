// Local test server for tools/qorex-test: serves the page and verifies a QoreX message signature the way the backend's login will.
// Run from backend/: node scripts/qore/qorex-test-server.mjs   then open http://localhost:8765   (local testing only)
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createSiwqMessage, parseSiwqMessage } from '@qorechain/qoresign';
import { verifyMessageWithChain, verifySiwqWithChain } from '@qorechain/qoresign/network';

const PAGE = fileURLToPath(new URL('../../../tools/qorex-test/index.html', import.meta.url));
const rest = 'https://api-testnet.qore.host';
const chainId = 'qorechain-diana';

/** Resolves to "ok" or the reason it was refused. */
const check = async (signer, data, signature) => {
  try { const r = await verifyMessageWithChain({ rest, chainId, signer, data, signature, requirePq: true }); return `ok (key possession proven: ${r.possessionProven})`; }
  catch (e) { return `REFUSED: ${String(e?.message ?? e).slice(0, 160)}`; }
};

// ---- Sign In With QoreChain (open question Q8) ----
const DOMAIN = 'localhost:8765';
const issued = new Map(); // address -> nonce
function signInMessage(address) {
  const nonce = crypto.randomBytes(12).toString('hex');
  issued.set(address, nonce);
  const t = Date.now();
  return createSiwqMessage({
    domain: DOMAIN, address, statement: 'Sign in to AgentBazaar. This does not send a transaction.', uri: `http://${DOMAIN}`,
    chainId, nonce, issuedAt: new Date(t).toISOString(), expirationTime: new Date(t + 5 * 60_000).toISOString(),
  });
}
const attempt = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return `REFUSED: ${e?.code ?? ''} ${String(e?.message ?? e).slice(0, 140)}`.replace('  ', ' '); } };

/** Route A: the library's sign-in verifier. */
const viaSiwq = (o) => attempt(() => verifySiwqWithChain({ rest, chainId, domain: DOMAIN, requirePq: true, ...o }));
/** Route B: verify the text as a plain signed message, then check the sign-in fields ourselves. */
const viaMessage = ({ address, nonce, message, signature, domain = DOMAIN, now = Date.now() }) => attempt(async () => {
  const f = parseSiwqMessage(message);
  if (f.domain !== domain) throw new Error('domain does not match');
  if (f.nonce !== nonce) throw new Error('nonce does not match');
  if (f.chainId !== chainId) throw new Error('chain does not match');
  if (f.address !== address) throw new Error('address does not match');
  if (!f.expirationTime || Date.parse(f.expirationTime) <= now) throw new Error('the sign-in message has expired');
  await verifyMessageWithChain({ rest, chainId, signer: address, data: message, signature, requirePq: true });
});

async function checkSignIn({ address, message, signature }) {
  const nonce = issued.get(address);
  const base = { address, nonce, message, signature };
  const out = {};
  for (const [route, verify] of [['A_siwqVerifier', viaSiwq], ['B_messageVerifier', viaMessage]]) {
    out[`${route}.genuine`] = await verify(base);
    out[`${route}.wrongNonce`] = await verify({ ...base, nonce: 'a'.repeat(24) });
    out[`${route}.wrongSite`] = await verify({ ...base, domain: 'evil.example' });
    out[`${route}.expired`] = await verify({ ...base, now: route.startsWith('A') ? new Date(Date.now() + 3600_000) : Date.now() + 3600_000 });
    out[`${route}.alteredText`] = await verify({ ...base, message: message.replace('Sign in to', 'Sign out of') });
    out[`${route}.noPostQuantumPart`] = await verify({ ...base, signature: { ...signature, pq: undefined, signatureType: 'secp256k1' } });
  }
  return out;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${DOMAIN}`);
  if (req.method === 'GET' && url.pathname === '/signin-message') {
    try { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ message: signInMessage(url.searchParams.get('address') ?? '') })); }
    catch (e) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message ?? e) })); }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/verify-signin') {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 100_000) { res.writeHead(413).end(); return; } }
    let out;
    try { out = await checkSignIn(JSON.parse(body)); } catch (e) { out = { error: String(e?.message ?? e) }; }
    console.log(JSON.stringify(out));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    return;
  }
  if (req.method === 'POST' && req.url === '/verify') {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 100_000) { res.writeHead(413).end(); return; } }
    let out;
    try {
      const { signer, message, signature } = JSON.parse(body);
      const other = 'qor10n4vu9vng7ta6xagjefrkgfm00l83x7n7r66fn';
      out = {
        genuine: await check(signer, message, signature),
        tamperedMessage: await check(signer, `${message}x`, signature),
        wrongAccount: await check(other, message, signature),
        withoutPostQuantumPart: await check(signer, message, { ...signature, pq: undefined, signatureType: undefined }),
      };
    } catch (e) { out = { error: String(e?.message ?? e) }; }
    console.log(JSON.stringify(out));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    return;
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(fs.readFileSync(PAGE));
    return;
  }
  res.writeHead(404).end();
}).listen(8765, '127.0.0.1', () => console.log('qorex test server on http://localhost:8765'));
