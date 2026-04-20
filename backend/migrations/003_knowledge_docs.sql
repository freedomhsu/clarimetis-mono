-- Tier-1 static knowledge base: RET protocols, CBT frameworks, cognitive bias definitions.
-- Documents are embedded at seed-time and queried via pgvector cosine similarity.

CREATE TABLE IF NOT EXISTS knowledge_docs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT        NOT NULL,
    content     TEXT        NOT NULL,
    category    TEXT        NOT NULL,   -- 'RET' | 'CBT' | 'cognitive_bias' | 'framework'
    embedding   vector(768),            -- populated by seed_knowledge.py
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_embedding
    ON knowledge_docs USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_category
    ON knowledge_docs (category);
