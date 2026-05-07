-- Migration 007: Add preferred_language to users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) NOT NULL DEFAULT 'en';
