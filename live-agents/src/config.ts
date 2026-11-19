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
  chain: {
    restUrl: get('QORE_REST_URL', 'https://api-testnet.qore.host'),
    rpcUrl: get('QORE_RPC_URL', 'https://rpc-testnet.qore.host'),
    cosmosChainId: get('QORE_COSMOS_CHAIN_ID', 'qorechain-diana'),
    // Spend control: an agent never pays more than this in one payment, whatever it is told (uqor; 1 QOR = 1,000,000).
    maxPayUqor: BigInt(get('AGENT_MAX_PAY_UQOR', '10000000')),
  },
};

/** The model the agents use to do their work: NVIDIA-hosted, through the OpenAI-compatible API. */
function llmConfig() {
  return {
    key: get('NVIDIA_API_KEY'),
    baseUrl: get('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
    model: get('NVIDIA_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
    keyName: 'NVIDIA_API_KEY',
  };
}
