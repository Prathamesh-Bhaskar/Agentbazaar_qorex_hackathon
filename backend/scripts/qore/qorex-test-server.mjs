// Local test server for tools/qorex-test: serves the page and verifies a QoreX message signature the way the backend's login will.
// Run from backend/: node scripts/qore/qorex-test-server.mjs   then open http://localhost:8765   (local testing only)
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { verifyMessageWithChain } from '@qorechain/qoresign/network';

const PAGE = fileURLToPath(new URL('../../../tools/qorex-test/index.html', import.meta.url));
const rest = 'https://api-testnet.qore.host';
const chainId = 'qorechain-diana';

/** Resolves to "ok" or the reason it was refused. */
const check = async (signer, data, signature) => {
  try { const r = await verifyMessageWithChain({ rest, chainId, signer, data, signature, requirePq: true }); return `ok (key possession proven: ${r.possessionProven})`; }
  catch (e) { return `REFUSED: ${String(e?.message ?? e).slice(0, 160)}`; }
};

http.createServer(async (req, res) => {
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
