// LLM layer (SPEC-qorechain R10): NVIDIA-hosted models through the OpenAI-compatible API, and nothing else.
// askJson(system, user, zodSchema). Never fakes an answer: a missing key or a failed call throws an LlmError, and an LlmError
// is an infrastructure problem, never a reason to fail someone's work (rule 5).
import OpenAI from 'openai';
import type { ZodType } from 'zod';
import { env } from '../env.js';

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

/** Map an HTTP status from the NVIDIA API to a clear, retry-aware error. 401/400 are our configuration, the rest is the service. */
export function nvidiaHttpError(status: number | undefined, message: string): LlmError {
  const detail = message.slice(0, 200);
  if (status === 401) return new LlmError('NVIDIA rejected the API key (401)', false);
  if (status === 402) return new LlmError('NVIDIA credits are exhausted (402)', true);
  if (status === 429) return new LlmError(`NVIDIA is rate limiting or overloaded (429): ${detail}`, true);
  if (status === 400) return new LlmError(`NVIDIA rejected the request (400): ${detail}`, false);
  return new LlmError(`NVIDIA request failed${status ? ` (${status})` : ''}: ${detail}`, status === undefined || status >= 500);
}

export const activeModel = () => env.NVIDIA_MODEL;

type Messages = { role: 'system' | 'user'; content: string }[];

let nvidiaClient: OpenAI | null = null;
async function nvidiaCompletion(messages: Messages): Promise<string> {
  if (!env.NVIDIA_API_KEY) throw new LlmError('NVIDIA_API_KEY is not set', false);
  nvidiaClient ??= new OpenAI({ baseURL: env.NVIDIA_BASE_URL, apiKey: env.NVIDIA_API_KEY, timeout: 120_000 });
  try {
    const res = await nvidiaClient.chat.completions.create({
      model: env.NVIDIA_MODEL, messages, temperature: 0.2, top_p: 0.95, max_tokens: 8192, seed: 42,
      // chat_template_kwargs is NVIDIA-specific and not in the SDK types; extra body fields are forwarded as-is.
      ...({ chat_template_kwargs: { enable_thinking: false } } as object),
    });
    return res.choices[0]?.message?.content ?? '';
  } catch (e) {
    throw nvidiaHttpError((e as { status?: number }).status, (e as Error).message);
  }
}

/** Ask the model for JSON and validate it with Zod, up to 3 attempts. */
export async function askJson<T>(system: string, user: string, schema: ZodType<T>): Promise<T> {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    const messages: Messages = [
      { role: 'system', content: `${system}\n\nRespond with a single JSON object only. No prose outside the JSON.` },
      { role: 'user', content: attempt === 0 ? user : `${user}\n\nYour previous answer was invalid (${lastErr}). Return valid JSON only.` },
    ];
    const content = await nvidiaCompletion(messages);
    try {
      return schema.parse(extractJson(content));
    } catch (e) {
      lastErr = (e as Error).message.slice(0, 200);
    }
  }
  throw new LlmError(`NVIDIA returned invalid JSON 3 times: ${lastErr}`);
}
