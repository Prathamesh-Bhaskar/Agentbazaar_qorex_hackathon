import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Own .env first; the sibling backend .env only fills gaps (keys, NVIDIA settings, shared secret), so nothing is copied around.
config({ path: here('../.env'), quiet: true });
config({ path: here('../../backend/.env'), quiet: true });

const raw = z.object({
  PORT: z.coerce.number().default(5001),
  // Must equal the backend's SOLIDITY_AGENT_SECRET (the backend sends it in x-agent-secret).
  AGENT_SHARED_SECRET: z.string().optional(),
  SOLIDITY_AGENT_SECRET: z.string().optional(),
  // The designer's own account: the only address allowed to deploy task contracts. Testnet only.
  QORE_DESIGNER_PRIVATE_KEY: z.string().optional(),
  QORE_DESIGNER_PQC_RECOVERY_CODE: z.string().optional(),
  TASK_FACTORY_ADDRESS: z.string().optional(),
  // QoreChain testnet (qorechain-diana)
  QORE_EVM_RPC_URL: z.string().default('https://evm-testnet.qore.host'),
  QORE_CHAIN_ID: z.coerce.number().default(9800),
  QORE_COSMOS_CHAIN_ID: z.string().default('qorechain-diana'),
  QORE_REST_URL: z.string().default('https://api-testnet.qore.host'),
  QORE_RPC_URL: z.string().default('https://rpc-testnet.qore.host'),
  // EVM authorisation window sizing (same meaning as in the backend; value is counted in uqor, 1 QOR = 1e6)
  QORE_WINDOW_BLOCKS: z.coerce.number().int().min(1).max(17_280).default(17_280),
  QORE_WINDOW_MAX_TXS: z.coerce.number().int().min(1).max(1_000).default(200),
  QORE_WINDOW_MAX_VALUE_UQOR: z.string().regex(/^\d+$/).default('5000000'),
  QORE_WINDOW_MIN_BLOCKS: z.coerce.number().int().min(0).default(120),
  // AI model for requirement analysis: NVIDIA-hosted, through the OpenAI-compatible API.
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl-120b-a12b'),
}).parse(process.env);

export const env = { ...raw, AGENT_SHARED_SECRET: raw.AGENT_SHARED_SECRET ?? raw.SOLIDITY_AGENT_SECRET };
