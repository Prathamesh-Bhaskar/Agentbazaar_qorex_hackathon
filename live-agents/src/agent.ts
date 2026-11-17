import Fastify from 'fastify';
import { z } from 'zod';
import { a2aCall, a2aQuote, BackendError, submitWork } from './backend.js';
import { config } from './config.js';
import { ask } from './llm.js';
import { hbar, makeSay, secs, type Say } from './log.js';
import { payer, settlementTx } from './pay.js';
import { bySlug, type AgentDef } from './roster.js';
import { loadState } from './state.js';

const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
// Structural checks look at the files delivered, so the deliverable must include the files they look for.
const CHECK_FILES: Record<string, string> = {
  lint_rules: 'a lint/format config file (".solhint.json" for Solidity, "eslint.config.js" for JS/TS, ".prettierrc" otherwise)',
  build_config: 'a build config ("foundry.toml" for Solidity, or a package.json with a "build" script)',
  dependency_check: 'a package.json whose dependency versions are pinned (no "*", "latest" or git/http versions)',
};
export const jobPrompt = (requirements: string, checks: string[]) => {
  const files = checks.filter((c) => CHECK_FILES[c]).map((c) => `- ${c}: include ${CHECK_FILES[c]} as its own "// FILE: path" file`);
  return `Job requirements:\n"""\n${requirements}\n"""${checks.length ? `\nThe result will be checked for: ${checks.join(', ')}.` : ''}${files.length ? `\nTo pass those checks the deliverable must contain these files (put the main code in its own "// FILE: path" file too):\n${files.join('\n')}` : ''}`;
};

/** One agent = one server: GET /health, POST /quote, POST /tasks (202), POST /a2a, POST /payouts-due. */
export async function runAgent(def: AgentDef) {
  const app = Fastify({ logger: { level: 'info' } });
  const me = () => loadState()[def.slug];

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/health' || !config.backendSecret) return;
    if (req.headers['x-backend-secret'] !== config.backendSecret) return reply.code(401).send({ error: 'Bad or missing x-backend-secret' });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
  });

  app.get('/health', async () => ({ ok: true, name: def.name, slug: def.slug, registered: !!me() }));

  app.post('/quote', async (req) => {
    const { requirements } = z.object({ requirements: z.string().default('') }).passthrough().parse(req.body ?? {});
    if (!def.matches.test(requirements)) return { decline: true, reason: `${def.name} does not do this kind of work` };
    return { priceTinybar: def.priceTinybar, etaHours: def.etaHours };
  });

  app.post('/tasks', async (req, reply) => {
    const key = me()?.apiKey;
    if (!key) return reply.code(503).send({ error: 'Agent not registered: run the backend seed script' });
    const ctx = z.object({ agreementId: z.string().uuid(), requirements: z.string().min(1), checks: z.array(z.string()).default([]) }).passthrough().parse(req.body);
    const say = makeSay(def.name, ctx.agreementId);
    say(`TASK RECEIVED: "${ctx.requirements.replace(/\s+/g, ' ').slice(0, 80)}" | checks: ${ctx.checks.join(', ') || 'none'}`);
    void (async () => {
      const started = Date.now();
      try {
        say('step 1/3: writing the deliverable');
        let work = await withRetries(() => ask(def.system, jobPrompt(ctx.requirements, ctx.checks), { say }), say);
        say(`step 1/3 done: draft is ${work.length} chars`);
        work = await maybeReview(def, key, ctx.agreementId, ctx.requirements, work, say);
        say(`step 3/3: submitting ${work.length} chars to the platform`);
        for (let attempt = 1; attempt <= 3; attempt++) {
          try { await submitWork(key, ctx.agreementId, work); say(`WORK SUBMITTED after ${secs(started)}. The platform now verifies it and releases or refunds the escrow.`); return; }
          catch (e) {
            const status = e instanceof BackendError ? e.status : undefined;
            say(`submit failed (attempt ${attempt}/3, status ${status ?? 'network'}): ${(e as Error).message}`);
            if (status && status < 500) return;
            await new Promise((r) => setTimeout(r, 3000 * attempt));
          }
        }
      } catch (e) {
        // Nothing fake is ever submitted: the job stays funded and the client can see there is no submission.
        say(`TASK FAILED after ${secs(started)}; nothing submitted: ${(e as Error).message}`);
      }
    })();
    return reply.code(202).send({ accepted: true, agreementId: ctx.agreementId });
  });

  // Another agent hired this one. It is paid over x402 by the hiring agent once the whole task is released.
  app.post('/a2a', async (req) => {
    const { input } = z.object({ input: z.unknown() }).passthrough().parse(req.body ?? {});
    const i = (input ?? {}) as Record<string, unknown>;
    const sub = text(i.code ?? i.text ?? input);
    const said = makeSay(def.name, (req.body as { agreementId?: string } | undefined)?.agreementId);
    const t0 = Date.now();
    said(`HIRED BY ANOTHER AGENT: working on ${sub.length} chars sent to me`);
    // A sub-task must finish well inside the hiring agent's HTTP limit (300 s), so its answer is capped lower than a full job.
    const review = await ask(def.system, `Task from another agent:\n"""\n${sub}\n"""`, { maxTokens: 4000, say: said });
    said(`sub-task done in ${secs(t0)}: ${review.length} chars sent back. I am paid over x402 after the whole job is released.`);
    return { agent: def.slug, review };
  });

  // The backend tells the hiring agent which sub-agents it owes. Pay each over x402 (autonomous, capped per payment).
  app.post('/payouts-due', async (req, reply) => {
    const m = me();
    if (!m) return reply.code(503).send({ error: 'not registered' });
    const { legs } = z.object({ legs: z.array(z.object({ legId: z.number(), payUrl: z.string().url() })) }).passthrough().parse(req.body);
    const say = makeSay(def.name, (req.body as { agreementId?: string } | undefined)?.agreementId);
    say(`PAYOUTS DUE: I owe ${legs.length} sub-agent(s), paying over x402`);
    void (async () => {
      for (const leg of legs) {
        try {
          // Spend control: never more than the leg's own price (the backend states it), and never more than 10 HBAR in any case.
          // A fixed 1 HBAR cap refused every leg above 1 HBAR on bigger jobs.
          const owed = BigInt(String((leg as { priceTinybar?: unknown }).priceTinybar ?? '0').replace(/\D/g, '') || '0');
          const cap = owed > 0n && owed <= 1_000_000_000n ? owed : 100_000_000n;
          const pay = payer(m.accountId, m.payoutKey, cap);
          say(`paying leg ${leg.legId}${owed > 0n ? ` (${hbar(owed)})` : ''} over x402`);
          const res = await pay(leg.payUrl);
          if (res.status === 200) say(`PAID leg ${leg.legId} over x402, Hedera tx ${settlementTx(res)}`);
          else say(`payment of leg ${leg.legId} REFUSED (${res.status}): ${(await res.text()).slice(0, 200)}`);
        } catch (e) { say(`payment of leg ${leg.legId} FAILED: ${(e as Error).message}`); }
      }
    })();
    return reply.code(202).send({ accepted: true });
  });

  await app.listen({ port: def.port, host: '::' }); // dual-stack: reachable as localhost over IPv4 and IPv6
  console.log(`${def.name} (${def.slug}) on :${def.port}  backend ${config.backendUrl}  ${me() ? 'registered' : 'NOT registered, run the seed script'}`);
}

/** The model or the network can be down for minutes. Try again with a growing pause instead of leaving a funded job stuck. */
async function withRetries<T>(fn: () => Promise<T>, say: Say): Promise<T> {
  const pauses = [20_000, 60_000, 120_000, 240_000];
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= pauses.length) throw e;
      say(`could not produce the work yet (${(e as Error).message}); waiting ${pauses[i] / 1000}s, then retry ${i + 1}/${pauses.length}`);
      await new Promise((r) => setTimeout(r, pauses[i]));
    }
  }
}

/** Agent-to-agent: have another listed agent review the draft; fix the draft only if the reviewer found a real critical/high problem. */
async function maybeReview(def: AgentDef, key: string, agreementId: string, requirements: string, draft: string, say: Say) {
  const target = def.hires ? loadState()[def.hires] : undefined;
  if (!def.hires || !target || !bySlug(def.hires)) { say('step 2/3: no sub-agent to hire for this agent, skipping the review'); return draft; }
  const subName = bySlug(def.hires)!.name;
  const t0 = Date.now();
  try {
    say(`step 2/3: asking the platform whether I may hire ${subName} for a review`);
    const q = await a2aQuote(key, agreementId, target.agentId); // refused (403) if over the on-chain sub-agent cap
    say(`hire allowed at ${hbar(q.priceTinybar)}; adding the leg to the contract on-chain and sending the draft to ${subName} (this takes 1-4 min)`);
    const hired = await a2aCall(key, q.callId, { code: draft });
    const review = text((hired.output as { review?: unknown })?.review ?? hired.output);
    say(`${subName} answered in ${secs(t0)}: ${review.length} chars. ${subName} is paid ${hbar(q.priceTinybar)} over x402 after release.`);
    if (/critical|high/i.test(review) && !/VERDICT:\s*PASS/i.test(review)) {
      say('the reviewer reported critical/high problems: fixing the draft with them (second model call)');
      return await ask(def.system, `${jobPrompt(requirements, [])}\n\nYour draft:\n${draft}\n\nAn independent reviewer found these problems. Fix every real one and return the full corrected deliverable only:\n${review}`, { say });
    }
    say('the reviewer found nothing critical: keeping the draft as is');
  } catch (e) {
    // Not allowed, or the sub-agent is down: deliver the unreviewed draft rather than fail the job.
    say(`review skipped after ${secs(t0)}, delivering the draft unreviewed: ${(e as Error).message}`);
  }
  return draft;
}
