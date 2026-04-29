-- Run this against your Cloud SQL PostgreSQL instance to bootstrap the schema.
-- Connect via: psql $DATABASE_URL -f migrations/init.sql

-- pgvector extension (must be enabled per database)
CREATE EXTENSION IF NOT EXISTS vector;

-- ──────────────────────────────────────────────
-- Users
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id         VARCHAR(255) UNIQUE NOT NULL,
    email                 VARCHAR(255) UNIQUE NOT NULL,
    full_name             VARCHAR(255),
    stripe_customer_id    VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255),
    subscription_tier     VARCHAR(50)  NOT NULL DEFAULT 'free',
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- Chat sessions
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(255) NOT NULL DEFAULT 'New Session',
    summary    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);

-- ──────────────────────────────────────────────
-- Messages  (vector dim = 768 for text-embedding-004)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id     UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role           VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content        TEXT        NOT NULL,
    media_urls     JSONB       NOT NULL DEFAULT '[]',
    crisis_flagged BOOLEAN     NOT NULL DEFAULT FALSE,
    embedding      vector(768),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

-- HNSW index for fast approximate nearest-neighbour search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_messages_embedding_hnsw
    ON messages USING hnsw (embedding vector_cosine_ops);

-- ──────────────────────────────────────────────
-- Auto-update updated_at trigger
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at        ON users;
DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON chat_sessions;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();

CREATE TRIGGER trg_chat_sessions_updated_at
    BEFORE UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();

-- ──────────────────────────────────────────────
-- Score snapshots  (one row per analytics generation)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS score_snapshots (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    confidence_score      INTEGER,
    anxiety_score         INTEGER,
    self_esteem_score     INTEGER,
    stress_load           INTEGER,
    social_gratitude_index INTEGER,
    data_reliability      VARCHAR(20) NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_snapshots_user_id   ON score_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_score_snapshots_created_at ON score_snapshots(created_at);

-- ──────────────────────────────────────────────
-- Evaluation scores  (one row per assistant message, from evaluation agent)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_scores (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    trace_id            TEXT,
    empathy             REAL,
    coaching_quality    REAL,
    safety              REAL,
    actionability       REAL,
    boundary_adherence  REAL,
    overall             REAL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_scores_session_id ON evaluation_scores(session_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_scores_created_at ON evaluation_scores(created_at);
