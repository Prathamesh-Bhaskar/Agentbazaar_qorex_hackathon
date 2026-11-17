// LLM provider layer (SPEC-near-ai.md, M1). NEAR AI Cloud by default; NVIDIA only when LLM_PROVIDER=nvidia.
// Same call shape for both: askJson(system, user, zodSchema). Never fakes an answer: a missing key or a failed call throws.
import OpenAI from 'openai';
import type { ZodType } from 'zod';
import { env } from '../env.js';
import { isTeeModel } from './nearModels.js';
import { collectNearProof, fetchPreflight, skippedProof, type AttestationReply, type LlmProof } from './nearProof.js';

/** `retryable` = infrastructure trouble (credits, rate limit, outage). Never a reason to FAIL someone's work. */
export class LlmError extends Error {
  constructor(message: string, public retryable = true) { super(message); }
}

/** Pull the first JSON object out of a model answer (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];
  let lastErr: unknown = new Error('no JSON object in model output');
  for (const candidate of candidates) {
    // Try each '{' as a start, scanning to its balanced '}' while respecting strings.
    for (let start = candidate.indexOf('{'); start !== -1; start = candidate.indexOf('{', start + 1)) {
      let depth = 0, inStr = false, esc = false;
      for (let i = start; i < candidate.length; i++) {
        const ch = candidate[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try { return JSON.parse(candidate.slice(start, i + 1)); } catch (e) { lastErr = e; }
          break;
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('no JSON object in model output');
}

/** Map an HTTP status from NEAR AI Cloud to a clear, retry-aware error. */
export function nearHttpError(status: number, body: string): LlmError {
  const detail = body.slice(0, 200);
  if (status === 401) return new LlmError(`NEAR AI rejected the API key (401)`, false);
  if (status === 402) return new LlmError('NEAR AI credits are exhausted (402): add credits at cloud.near.ai', true);
  if (status === 429) return new LlmError(`NEAR AI is rate limiting or overloaded (429): ${detail}`, true);
  if (status === 400) return new LlmError(`NEAR AI rejected the request (400): ${detail}`, false);
  return new LlmError(`NEAR AI request failed (${status}): ${detail}`, status >= 500);
}

export const activeModel = () => (env.LLM_PROVIDER === 'near' ? env.NEAR_AI_MODEL : env.NVIDIA_MODEL);

type Messages = { role: 'system' | 'user'; content: string }[];
type Completion = { content: string; proof?: LlmProof };

let nvidiaClient: OpenAI | null = null;
async function nvidiaCompletion(messages: Messages): Promise<Completion> {
  if (!env.NVIDIA_API_KEY) throw new LlmError('NVIDIA_API_KEY is not set', false);
  nvidiaClient ??= new OpenAI({ baseURL: env.NVIDIA_BASE_URL, apiKey: env.NVIDIA_API_KEY, timeout: 120_000 });
  try {
    const res = await nvidiaClient.chat.completions.create({
      model: env.NVIDIA_MODEL, messages, temperature: 0.2, top_p: 0.95, max_tokens: 8192, seed: 42,
      // chat_template_kwargs is NVIDIA-specific and not in the SDK types; extra body fields are forwarded as-is.
      ...({ chat_template_kwargs: { enable_thinking: false } } as object),
    });
    return { content: res.choices[0]?.message?.content ?? '' };
  } catch (e) {
    throw new LlmError(`NVIDIA request failed: ${(e as Error).message}`);
  }
}

/**
 * One NEAR AI completion through raw fetch, so the exact request and response bytes are available to hash for the
 * response-signature proof. `preflight` (attestation fetched before the call) is passed in when a proof is wanted.
 */
async function nearCompletion(
  messages: Messages,
  preflight: { nonce: string; attestation: AttestationReply } | null,
): Promise<Completion> {
  if (!env.NEAR_AI_API_KEY) throw new LlmError('NEAR_AI_API_KEY is not set (create a key at cloud.near.ai)', false);
  const model = env.NEAR_AI_MODEL;
  const base = env.NEAR_AI_BASE_URL.replace(/\/$/, '');
  const requestBytes = new TextEncoder().encode(JSON.stringify({
    model, messages, temperature: 0.2, top_p: 0.95, max_tokens: 8192, stream: false,
    // GLM-5.3 Flash only (per NEAR docs): cap hidden reasoning so calls are fast and never eat the whole max_tokens.
    ...(model.startsWith('z-ai/glm-5.3') ? { thinking_token_budget: env.NEAR_AI_THINKING_BUDGET } : {}),
  }));

  let res: Response, responseBytes: Uint8Array;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.NEAR_AI_API_KEY}`,
        'x-no-aliasing': 'true', // the model id in the request is part of what NEAR signs: no alias rewriting
        'Accept-Encoding': 'identity', // the signature covers the uncompressed body
      },
      body: requestBytes,
      signal: AbortSignal.timeout(300_000), // NEAR TEE models generate at roughly 20-40 tokens/s
    });
    responseBytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new LlmError(`NEAR AI request failed: ${(e as Error).message}`);
  }
  const text = new TextDecoder().decode(responseBytes);
  if (!res.ok) throw nearHttpError(res.status, text);

  let parsed: { id?: string; choices?: { message?: { content?: string | null } }[] };
  try { parsed = JSON.parse(text); } catch { throw new LlmError('NEAR AI returned a non-JSON response'); }
  const content = parsed.choices?.[0]?.message?.content ?? '';

  let proof: LlmProof | undefined;
  if (preflight) {
    try {
      proof = await collectNearProof({
        baseUrl: base, apiKey: env.NEAR_AI_API_KEY, model, chatId: parsed.id ?? null,
        requestBytes, responseBytes, nonce: preflight.nonce, attestation: preflight.attestation,
      });
    } catch (e) {
      proof = skippedProof(model, `proof collection failed: ${(e as Error).message}`);
    }
  }
  return { content, proof };
}

/**
 * Ask the model for JSON and validate it with Zod, up to 3 attempts. With `wantProof` and NEAR as provider, also returns
 * the signature proof of the attempt that produced the accepted answer. A proof problem never changes the answer.
 */
export async function askJsonWithProof<T>(
  system: string, user: string, schema: ZodType<T>, wantProof = false,
): Promise<{ data: T; proof: LlmProof | null }> {
  const near = env.LLM_PROVIDER === 'near';
  if (near && !env.NEAR_AI_API_KEY) throw new LlmError('NEAR_AI_API_KEY is not set (create a key at cloud.near.ai)', false);

  // Preflight attestation is fetched once, before the first completion. Skipped for models that are not TEEs.
  let preflight: { nonce: string; attestation: AttestationReply } | null = null;
  let skipNote: string | null = null;
  if (near && wantProof) {
    const tee = await isTeeModel(env.NEAR_AI_MODEL);
    if (tee === false) skipNote = 'model is not a NEAR TEE model (runs outside a TEE)';
    else preflight = await fetchPreflight(env.NEAR_AI_BASE_URL, env.NEAR_AI_MODEL);
  }

  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    const messages: Messages = [
      { role: 'system', content: `${system}\n\nRespond with a single JSON object only. No prose outside the JSON.` },
      { role: 'user', content: attempt === 0 ? user : `${user}\n\nYour previous answer was invalid (${lastErr}). Return valid JSON only.` },
    ];
    const out = near ? await nearCompletion(messages, preflight) : await nvidiaCompletion(messages);
    try {
      const data = schema.parse(extractJson(out.content));
      return { data, proof: near && wantProof ? (out.proof ?? (skipNote ? skippedProof(env.NEAR_AI_MODEL, skipNote) : null)) : null };
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 200);
    }
  }
  throw new LlmError(`${near ? 'NEAR AI' : 'NVIDIA'} returned invalid JSON 3 times: ${lastErr}`);
}

export async function askJson<T>(system: string, user: string, schema: ZodType<T>): Promise<T> {
  return (await askJsonWithProof(system, user, schema, false)).data;
}
