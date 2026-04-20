-- Migration 002: Tier-2 identity layer, sentiment scoring, and user profiles
-- Run against your Cloud SQL PostgreSQL instance:
--   psql $DATABASE_URL -f migrations/002_user_profiles_sentiment.sql

-- ──────────────────────────────────────────────
-- 1. Add sentiment_score column to messages
-- ──────────────────────────────────────────────
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS sentiment_score FLOAT;

-- Optional index to allow fast range queries (e.g. messages with score < -0.5)
CREATE INDEX IF NOT EXISTS idx_messages_sentiment_score ON messages(sentiment_score);

-- ──────────────────────────────────────────────
-- 2. User profiles (Tier-2 longitudinal identity)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    -- LLM-extracted identity fields
    core_values         TEXT,
    long_term_goals     TEXT,
    recurring_patterns  TEXT,
    -- Telemetry JSONB: stores sentiment_history[], avg_sentiment, stress_score
    telemetry           JSONB       NOT NULL DEFAULT '{}',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Auto-update updated_at trigger for user_profiles
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;

CREATE TRIGGER trg_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();
