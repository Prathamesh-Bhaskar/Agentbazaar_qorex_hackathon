import OpenAI from 'openai';
import { config } from './config.js';
import { secs, type Say } from './log.js';

let client: OpenAI | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One chat completion (a single prompt) on the configured model. Retries transient failures; throws rather than invent output. */
export async function ask(system: string, user: string, opts: { maxTokens?: number; say?: Say } = {}): Promise<string> {
  const { llm } = config;
  if (!llm.key) throw new Error(`${llm.keyName} is not set`);
  // Writing a multi-file deliverable takes 2-4 minutes on NEAR's TEE models (about 40 tokens/s), so 150 s was too short.
  client ??= new OpenAI({ baseURL: llm.baseUrl, apiKey: llm.key, timeout: 600_000, maxRetries: 0 });
  let last = 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    opts.say?.(`model call ${attempt + 1}/3 -> ${llm.model} (a long answer takes 1-3 min)`);
    try {
      const res = await client.chat.completions.create({
        model: llm.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.2, top_p: 0.95, max_tokens: opts.maxTokens ?? 10000, // 6000 cut a four-file deliverable off mid-file (finish_reason "length")
        ...(llm.provider === 'nvidia' ? ({ chat_template_kwargs: { enable_thinking: false } } as object) : {}), // NVIDIA-only field
        // GLM-5.3 Flash reasons by default (up to 8192 tokens); cap it so work is fast and reasoning cannot eat max_tokens.
        ...(llm.provider === 'near' && llm.model.startsWith('z-ai/glm-5.3') ? ({ thinking_token_budget: llm.thinkingBudget } as object) : {}),
      });
      const text = res.choices[0]?.message?.content?.trim();
      // A truncated deliverable would be submitted and judged as if complete. Treat it as a failed attempt instead.
      const u = res.usage as { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } | undefined;
      const info = `${secs(t0)}, ${u?.completion_tokens ?? '?'} tokens${u?.completion_tokens_details?.reasoning_tokens ? ` (${u.completion_tokens_details.reasoning_tokens} thinking)` : ''}, ${text?.length ?? 0} chars`;
      if (res.choices[0]?.finish_reason === 'length') { last = 'answer was cut off at max_tokens'; opts.say?.(`model answer CUT OFF (${info}); trying again`); await sleep(1500); continue; }
      if (text) { opts.say?.(`model answered in ${info}`); return text; }
      last = 'empty answer';
      opts.say?.(`model returned an empty answer (${info}); trying again`);
    } catch (e) { last = (e as Error).message; opts.say?.(`model call failed after ${secs(t0)}: ${last}`); }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`model unavailable: ${last}`);
}
