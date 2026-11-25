// Links to the public QoreChain explorer. Checked on 26 Nov: address pages (0x and qor1) and native transaction hashes
// display; EVM (0x) transaction hashes are not looked up. The explorer opens on mainnet and keeps the network choice in a
// cookie, with no URL parameter, so the reader has to pick Testnet there.
export const EXPLORER = 'https://explore.qore.network';
export const EXPLORER_HINT = 'Opens the QoreChain explorer. Choose Testnet there.';

export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;
/** A link for a native (Cosmos-lane) transaction; null for an EVM hash, which the explorer cannot show. */
export const txUrl = (hash: string): string | null => (hash.startsWith('0x') ? null : `${EXPLORER}/tx/${hash.toUpperCase()}`);
export const shortTx = (id: string) => (id.length > 22 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
