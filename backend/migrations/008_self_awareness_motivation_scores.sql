-- Migration 008: Add self_awareness_score and motivation_score to score_snapshots
ALTER TABLE score_snapshots
    ADD COLUMN IF NOT EXISTS self_awareness_score INTEGER,
    ADD COLUMN IF NOT EXISTS motivation_score     INTEGER;
