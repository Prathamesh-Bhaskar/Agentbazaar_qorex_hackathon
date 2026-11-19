// Lists the live demo agents (live-agents/) on the platform directly: no GitHub, no wallet signature.
//   npm run seed:agents            create what is missing (safe to re-run)
// Per agent in live-agents/roster.json:
//   1. its payout account is the QoreChain account already in backend/.env (QORE_AGENT_<SLUG>_PRIVATE_KEY); nothing is created on chain
//   2. an agent row: status 'listed', is_seeded = true, endpoint http://localhost:<port>, NO benchmark run (shown as not benchmarked)
//   3. live-agents/agents.json with each agent's API key (gitignored). Payout keys stay in .env only.
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { env } from '../src/env.js';
import { db, schema } from '../src/db/index.js';
import { newToken, sha256 } from '../src/lib/auth.js';

type Meta = { slug: string; port: number; name: string; priceTinybar: string; capabilities: string[]; description: string };
const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const roster: Meta[] = JSON.parse(readFileSync(path('../../live-agents/roster.json'), 'utf8'));
const STATE = path('../../live-agents/agents.json');
type Saved = { agentId: string; apiKey: string };
const state: Record<string, Saved> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};

// The model the live agents work with (live-agents/ reads the same NVIDIA_MODEL), shown on their listing.
const MODELS = [env.NVIDIA_MODEL];

const keyOf = (slug: string) => {
  const name = `QORE_AGENT_${slug.toUpperCase().replace(/-/g, '_')}_PRIVATE_KEY`;
  const k = process.env[name];
  if (!k) throw new Error(`${name} is missing in backend/.env`);
  return `0x${k.replace(/^0x/, '')}` as `0x${string}`;
};

// The platform-owned user that "owns" these agents.
const OWNER_NAME = 'AgentBazaar live agents';
let ownerId = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.displayName, OWNER_NAME)).limit(1))[0]?.id;
if (!ownerId) {
  const addr = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  [{ id: ownerId }] = await db.insert(schema.users).values({ address: addr, displayName: OWNER_NAME }).returning({ id: schema.users.id });
  console.log(`created owner user ${addr}`);
}

for (const m of roster) {
  const payout = privateKeyToAccount(keyOf(m.slug)).address.toLowerCase();
  const listing = { status: 'listed', endpointUrl: `http://localhost:${m.port}`, priceTinybar: m.priceTinybar, name: m.name, description: m.description, capabilities: m.capabilities, payoutAddress: payout, modelsUsed: MODELS };
  const existing = state[m.slug];
  if (existing) {
    const [row] = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.id, existing.agentId)).limit(1);
    if (row) {
      await db.update(schema.agents).set(listing).where(eq(schema.agents.id, existing.agentId));
      console.log(`  ${m.slug}: already created, refreshed and listed`);
      continue;
    }
  }
  const apiKey = `afk_${newToken(24)}`;
  const [agent] = await db.insert(schema.agents).values({ ownerUserId: ownerId!, ...listing, apiKeyHash: sha256(apiKey), isSeeded: true }).returning({ id: schema.agents.id });
  state[m.slug] = { agentId: agent.id, apiKey };
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }); // write after each agent so a failure never loses a key
  console.log(`  ${m.slug}: listed as ${agent.id}, payout ${payout}, price ${m.priceTinybar} wei`);
}
console.log('\nDone. Keys saved to live-agents/agents.json. Start the agents: cd live-agents && npm run all');
process.exit(0);
