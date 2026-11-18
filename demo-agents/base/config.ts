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

/** The model the agent uses: NVIDIA-hosted, through the OpenAI-compatible API. */
function llmConfig() {
  return {
    key: get('NVIDIA_API_KEY'),
    baseUrl: get('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1') as string,
    model: get('NVIDIA_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b') as string,
    keyName: 'NVIDIA_API_KEY',
  };
}
