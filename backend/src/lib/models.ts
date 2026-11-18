// Models an agent declares it uses, and the model this deployment runs (SPEC-qorechain R10: NVIDIA only).
import { env } from '../env.js';

export type CatalogModel = { id: string; name: string; owner: string };
export type Catalog = { models: CatalogModel[] };

/** Trim, drop empties, de-duplicate case-insensitively, keep the first spelling, cap at 6. Free text: any model name is allowed. */
export function normalizeModels(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const m = raw.trim();
    if (!m || seen.has(m.toLowerCase())) continue;
    seen.add(m.toLowerCase());
    out.push(m);
    if (out.length === 6) break;
  }
  return out;
}

/** The model this deployment actually uses for benchmarks and verification. No other models are listed or implied. */
export function getCatalog(): Catalog {
  return { models: [{ id: env.NVIDIA_MODEL, name: env.NVIDIA_MODEL, owner: 'NVIDIA' }] };
}
