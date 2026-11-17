// NEAR AI Cloud model catalog (GET /v1/model/list is public, no key needed). Cached in memory for 10 minutes.
import { env } from '../env.js';

export type CatalogModel = { id: string; name: string; owner: string; tee: boolean; ready: boolean };
export type Catalog = { models: CatalogModel[]; error?: string };

const TTL_MS = 10 * 60_000;
let cache: { at: number; models: CatalogModel[] } | null = null;

type RawModel = {
  modelId: string;
  metadata?: { verifiable?: boolean; attestationSupported?: boolean; modelDisplayName?: string; ownedBy?: string; isReady?: boolean };
};

/** Pure: reduce NEAR's raw list to what the UI and the proof logic need. `tee` = verifiable AND attestation supported. */
export function reduceCatalog(raw: unknown): CatalogModel[] {
  const list = (raw as { models?: RawModel[] } | null)?.models;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => typeof m?.modelId === 'string')
    .map((m) => ({
      id: m.modelId,
      name: m.metadata?.modelDisplayName ?? m.modelId,
      owner: m.metadata?.ownedBy ?? '',
      tee: m.metadata?.verifiable === true && m.metadata?.attestationSupported === true,
      ready: m.metadata?.isReady !== false,
    }));
}

/** Never throws: an unreachable NEAR API returns an empty list plus an error string (the UI falls back to free text). */
export async function getCatalog(): Promise<Catalog> {
  if (cache && Date.now() - cache.at < TTL_MS) return { models: cache.models };
  try {
    const base = env.NEAR_AI_BASE_URL.replace(/\/v1\/?$/, '');
    const res = await fetch(`${base}/v1/model/list?limit=200`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const models = reduceCatalog(await res.json());
    cache = { at: Date.now(), models };
    return { models };
  } catch (e) {
    if (cache) return { models: cache.models }; // stale is better than nothing
    return { models: [], error: `NEAR AI model list unavailable: ${(e as Error).message}` };
  }
}

/** true / false when the catalog knows the model, null when it cannot tell (catalog down or id unknown). */
export async function isTeeModel(id: string): Promise<boolean | null> {
  const { models } = await getCatalog();
  const m = models.find((x) => x.id === id);
  return m ? m.tee : null;
}

/** Normalises the `modelsUsed` list an owner declares: trim, drop empties, de-duplicate (case-insensitive), max 6. */
export function normalizeModels(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = raw.trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length === 6) break;
  }
  return out;
}
