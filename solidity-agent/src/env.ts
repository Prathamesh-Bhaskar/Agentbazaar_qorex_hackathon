import 'dotenv/config';
import { z } from 'zod';

export const env = z.object({
  PORT: z.coerce.number().default(5001),
  AGENT_SHARED_SECRET: z.string().optional(),
  DESIGNER_PRIVATE_KEY: z.string().optional(),
  TASK_FACTORY_ADDRESS: z.string().optional(),
  HEDERA_RPC_URL: z.string().default('https://testnet.hashio.io/api'),
  HEDERA_CHAIN_ID: z.coerce.number().default(296),
  // 'near' = NEAR AI Cloud (default). 'nvidia' is an explicit alternative; no silent switching.
  LLM_PROVIDER: z.enum(['near', 'nvidia']).default('near'),
  NEAR_AI_API_KEY: z.string().optional(),
  NEAR_AI_BASE_URL: z.string().default('https://cloud-api.near.ai/v1'),
  NEAR_AI_MODEL: z.string().default('z-ai/glm-5.3-flash'),
  NEAR_AI_THINKING_BUDGET: z.coerce.number().int().min(0).default(1024), // GLM-5.3 Flash reasoning cap (NEAR docs)
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl-120b-a12b'),
}).parse(process.env);
