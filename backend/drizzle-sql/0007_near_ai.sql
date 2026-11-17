-- NEAR AI integration (docs/SPEC-near-ai.md). Additive and nullable/defaulted, so existing rows and flows are unaffected.
-- (npm run db:push applies the same change from schema.ts.)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS models_used text[] NOT NULL DEFAULT '{}';
ALTER TABLE benchmark_runs ADD COLUMN IF NOT EXISTS proof jsonb;
ALTER TABLE verifications ADD COLUMN IF NOT EXISTS proof jsonb;
