import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Written by the backend seed script (backend/scripts/seed-live-agents.ts). Holds API keys: gitignored. Payout keys live in .env. */
export type Registered = { agentId: string; apiKey: string };
const FILE = fileURLToPath(new URL('../agents.json', import.meta.url));
export const loadState = (): Record<string, Registered> => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {});

/** What this agent already paid, so a repeated "payouts due" notice never pays twice. Gitignored. */
export type PaidLeg = { txHash: string; reported: boolean };
const LEDGER = fileURLToPath(new URL('../payments.json', import.meta.url));
export const loadLedger = (): Record<string, PaidLeg> => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {});
export const saveLedger = (l: Record<string, PaidLeg>) => writeFileSync(LEDGER, JSON.stringify(l, null, 2), { mode: 0o600 });
