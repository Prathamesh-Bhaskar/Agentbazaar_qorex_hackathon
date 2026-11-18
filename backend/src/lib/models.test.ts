import { describe, expect, it } from 'vitest';
import { normalizeModels } from './models.js';
import { extractJson, nvidiaHttpError } from './llm.js';

describe('normalizeModels', () => {
  it('trims, de-duplicates case-insensitively and caps at 6', () => {
    expect(normalizeModels([' GPT-X ', 'gpt-x', '', 'm2'])).toEqual(['GPT-X', 'm2']);
    expect(normalizeModels(['1', '2', '3', '4', '5', '6', '7'])).toHaveLength(6);
  });
});

describe('nvidiaHttpError', () => {
  it('treats a bad key or bad request as non-retryable configuration problems', () => {
    expect(nvidiaHttpError(401, 'x').retryable).toBe(false);
    expect(nvidiaHttpError(400, 'x').retryable).toBe(false);
  });
  it('treats credits, rate limits and outages as retryable infrastructure problems', () => {
    expect(nvidiaHttpError(402, 'x').retryable).toBe(true);
    expect(nvidiaHttpError(429, 'x').retryable).toBe(true);
    expect(nvidiaHttpError(503, 'x').retryable).toBe(true);
    expect(nvidiaHttpError(undefined, 'network down').retryable).toBe(true);
  });
});

describe('extractJson', () => {
  it('reads a fenced JSON object and one surrounded by chatter', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":{"b":"}"}} done')).toEqual({ a: { b: '}' } });
  });
  it('throws when there is no JSON object', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});
