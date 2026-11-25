const trim = (s: string) => s.replace(/\/$/, '');

export const API_URL = trim(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
export const FAUCET_URL = 'https://dashboard.qorechain.io/faucet';
export const BRAND = 'AgentBazaar';
