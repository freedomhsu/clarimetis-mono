-- Migration 006: Add ego_score and emotion_control_score to score_snapshots
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS ego_score INTEGER;
ALTER TABLE score_snapshots ADD COLUMN IF NOT EXISTS emotion_control_score INTEGER;
