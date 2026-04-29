-- Migration 004: add CHECK constraint on subscription_tier to guard against
-- invalid values being written by a buggy webhook or direct DB edit.
--
-- The constraint is added with NOT VALID so it does not scan the existing rows
-- immediately (safe for large tables / zero-downtime deploys).  The subsequent
-- VALIDATE re-checks all rows outside of a full table lock.
--
-- Run:  psql $DATABASE_URL -f migrations/004_subscription_tier_constraint.sql

ALTER TABLE users
    ADD CONSTRAINT chk_subscription_tier
    CHECK (subscription_tier IN ('free', 'pro'))
    NOT VALID;

ALTER TABLE users VALIDATE CONSTRAINT chk_subscription_tier;
