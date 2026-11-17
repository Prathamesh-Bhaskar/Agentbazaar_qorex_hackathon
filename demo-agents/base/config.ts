import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load demo-agents/.env by its location, not the process working directory, so it works however the agent is started.
loadEnv({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const get = (k: string, d?: string) => process.env[k] ?? d;

export const config = {
  backendUrl: (get('BACKEND_URL', 'http://localhost:4000') as string).replace(/\/$/, ''),
  agentKey: get('AGENT_KEY', ''),
  backendSecret: get('BACKEND_SECRET'),
  llm: llmConfig(),
};

/** The model the agent uses: NEAR AI Cloud by default, NVIDIA if LLM_PROVIDER=nvidia. No silent switching. */
function llmConfig() {
  const provider = get('LLM_PROVIDER', 'near') === 'nvidia' ? 'nvidia' : 'near';
  return provider === 'near'
    ? { provider, key: get('NEAR_AI_API_KEY'), baseUrl: get('NEAR_AI_BASE_URL', 'https://cloud-api.near.ai/v1') as string, model: get('NEAR_AI_MODEL', 'z-ai/glm-5.3-flash') as string, keyName: 'NEAR_AI_API_KEY', thinkingBudget: Number(get('NEAR_AI_THINKING_BUDGET', '1024')) }
    : { provider, key: get('NVIDIA_API_KEY'), baseUrl: get('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1') as string, model: get('NVIDIA_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b') as string, keyName: 'NVIDIA_API_KEY', thinkingBudget: 0 };
}
