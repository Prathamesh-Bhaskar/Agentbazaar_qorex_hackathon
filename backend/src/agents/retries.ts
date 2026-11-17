// Agents are separate servers and can be unreachable for a few seconds (restart, busy, network blip). The two one-shot calls the
// platform makes to them must not be lost when that happens:
//   - "start work" on a funded task      -> retried until the agent accepts it
//   - "you owe these sub-agents" notice   -> repeated until every sub-leg is paid
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { legNotFailed, notifyPayoutsDue } from '../chain/ops.js';
import { dispatchTask } from './dispatch.js';

const DAY_MS = 24 * 3600_000;
/** Do not nag an agent that is already paying: wait this long between payout notices for one agreement. */
const NOTICE_EVERY_MS = 90_000;
const lastNotice = new Map<string, number>();
let busy = false;

export async function retryOnce() {
  if (busy) return;
  busy = true;
  try {
    const since = new Date(Date.now() - DAY_MS);

    // 1. Funded tasks the agent never accepted.
    const failed = await db.select({ id: schema.agreements.id }).from(schema.agreements)
      .where(and(eq(schema.agreements.status, 'funded'), eq(schema.agreements.taskDispatchStatus, 'failed'), gt(schema.agreements.createdAt, since)));
    for (const a of failed) {
      const r = await dispatchTask(a.id).catch((e) => { console.error('[retry] dispatch', a.id, (e as Error).message); return 'failed'; });
      console.log(`[retry] task ${a.id.slice(0, 8)} -> ${r}`);
    }

    // 2. Released jobs whose sub-agents are still unpaid, long enough after the release to be sure the first notice was lost.
    const owed = await db.selectDistinct({ id: schema.subLegs.agreementId }).from(schema.subLegs)
      .innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
      .where(and(eq(schema.subLegs.status, 'pending'), eq(schema.agreements.status, 'released'), gt(schema.agreements.createdAt, since), legNotFailed,
        sql`exists (select 1 from payments p where p.agreement_id = ${schema.agreements.id} and p.kind = 'release' and p.status = 'confirmed' and p.created_at < now() - interval '60 seconds')`));
    for (const a of owed) {
      if (Date.now() - (lastNotice.get(a.id) ?? 0) < NOTICE_EVERY_MS) continue;
      lastNotice.set(a.id, Date.now());
      await notifyPayoutsDue(a.id).catch((e) => console.error('[retry] payouts', a.id, (e as Error).message));
      console.log(`[retry] told the agent on ${a.id.slice(0, 8)} which sub-agents it still owes`);
    }
  } catch (e) {
    console.error('[retry]', (e as Error).message);
  } finally {
    busy = false;
  }
}

export function startRetries(intervalMs = 30_000) {
  const t = setInterval(() => { void retryOnce(); }, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}
