import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // If an agent sets BACKEND_SECRET, it only accepts /quote /tasks /a2a calls carrying this value in x-backend-secret.
  BACKEND_SECRET: z.string().optional(),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'), // how agents reach this API (submit, a2a)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL (Neon connection string) is required'),

  // QoreChain testnet (qorechain-diana). EVM lane for contracts, Cosmos REST/RPC for PQC keys, windows and native payments.
  QORE_EVM_RPC_URL: z.string().default('https://evm-testnet.qore.host'),
  QORE_CHAIN_ID: z.coerce.number().default(9800),
  QORE_COSMOS_CHAIN_ID: z.string().default('qorechain-diana'),
  QORE_REST_URL: z.string().default('https://api-testnet.qore.host'),
  QORE_RPC_URL: z.string().default('https://rpc-testnet.qore.host'),
  QORE_EXPLORER_URL: z.string().default('https://explore.qore.network'),
  // Legacy, removed with the mirror-node indexer in step 2.4.
  HEDERA_MIRROR_URL: z.string().default('https://testnet.mirrornode.hedera.com'),

  // Inference provider for benchmark, verification and checklists. 'near' = NEAR AI Cloud (private inference in a TEE).
  // 'nvidia' is kept as an explicit alternative; there is no silent switching between the two.
  LLM_PROVIDER: z.enum(['near', 'nvidia']).default('near'),
  NEAR_AI_API_KEY: z.string().optional(),
  NEAR_AI_BASE_URL: z.string().default('https://cloud-api.near.ai/v1'),
  NEAR_AI_MODEL: z.string().default('z-ai/glm-5.3-flash'),
  // GLM-5.3 Flash reasons by default (up to 8192 tokens), which makes every call slow. Documented cap: thinking_token_budget.
  NEAR_AI_THINKING_BUDGET: z.coerce.number().int().min(0).default(1024),

  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl-120b-a12b'),

  ZEROG_RPC_URL: z.string().default('https://evmrpc-testnet.0g.ai'),
  ZEROG_INDEXER_RPC: z.string().default('https://indexer-storage-testnet-turbo.0g.ai'),
  BACKEND_0G_PRIVATE_KEY: z.string().optional(),

  SOLIDITY_AGENT_URL: z.string().default('http://localhost:5001'),
  SOLIDITY_AGENT_SECRET: z.string().optional(),
  X402_FACILITATOR_URL: z.string().default('https://api.testnet.blocky402.com'),
  GATEWAY_PORT: z.coerce.number().default(4402),
  GATEWAY_PUBLIC_URL: z.string().default('http://localhost:4402'),
  INDEXER_ENABLED: z.string().default('true'),
  // EVM authorisation window sizing for backend accounts (chain bounds: blocks 1..17280, txs 1..1000; value counted in uqor, 1 QOR = 1e6).
  QORE_WINDOW_BLOCKS: z.coerce.number().int().min(1).max(17_280).default(17_280),
  QORE_WINDOW_MAX_TXS: z.coerce.number().int().min(1).max(1_000).default(200),
  QORE_WINDOW_MAX_VALUE_UQOR: z.string().regex(/^\d+$/).default('5000000'),
  QORE_WINDOW_MIN_BLOCKS: z.coerce.number().int().min(0).default(120), // renew when fewer blocks than this remain
  // Operator = relayer + factory owner: sends every backend transaction. Verifier only signs EIP-712 verdicts.
  QORE_OPERATOR_PRIVATE_KEY: z.string().optional(),
  QORE_OPERATOR_PQC_RECOVERY_CODE: z.string().optional(),
  QORE_VERIFIER_PRIVATE_KEY: z.string().optional(),

  // GitHub OAuth app (optional; without it only public repos work)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().optional(), // default http://localhost:<PORT>/github/callback
  FRONTEND_URL: z.string().optional(), // where the callback sends the browser afterwards; default first CORS_ORIGIN

  BENCHMARK_PASS_SCORE: z.coerce.number().default(80),
  BENCHMARK_CUSTOM_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),
});

export const env = schema.parse(process.env);
