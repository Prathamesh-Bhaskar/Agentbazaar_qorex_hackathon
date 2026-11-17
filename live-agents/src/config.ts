import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Own .env first; the sibling backend .env only fills gaps (NVIDIA key, shared secret), so nothing is copied around.
loadEnv({ path: here('../.env') });
loadEnv({ path: here('../../backend/.env') });

const get = (k: string, d = '') => process.env[k] ?? d;

export const config = {
  backendUrl: get('BACKEND_URL', 'http://localhost:4000').replace(/\/$/, ''),
  backendSecret: get('BACKEND_SECRET') || undefined,
  llm: llmConfig(),
  network: 'hedera:testnet' as const,
};

/** The model the agents use to do their work: NEAR AI Cloud by default, NVIDIA if LLM_PROVIDER=nvidia. No silent switching. */
function llmConfig() {
  const provider = get('LLM_PROVIDER', 'near') === 'nvidia' ? 'nvidia' : 'near';
  return provider === 'near'
    ? { provider, key: get('NEAR_AI_API_KEY'), baseUrl: get('NEAR_AI_BASE_URL', 'https://cloud-api.near.ai/v1'), model: get('NEAR_AI_MODEL', 'z-ai/glm-5.3-flash'), keyName: 'NEAR_AI_API_KEY', thinkingBudget: Number(get('NEAR_AI_THINKING_BUDGET', '512')) }
    : { provider, key: get('NVIDIA_API_KEY'), baseUrl: get('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'), model: get('NVIDIA_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'), keyName: 'NVIDIA_API_KEY', thinkingBudget: 0 };
}
