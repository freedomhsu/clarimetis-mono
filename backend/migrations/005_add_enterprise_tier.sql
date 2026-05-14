-- Migration 005: extend the subscription_tier CHECK constraint to include
-- the 'enterprise' value.
--
-- We drop and re-add the constraint (Postgres does not support ALTER CHECK).
-- The new constraint uses NOT VALID so it skips a full table scan on deploy,
-- then VALIDATE checks existing rows outside of a full table lock.
--
-- Run:  psql $DATABASE_URL -f migrations/005_add_enterprise_tier.sql

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_subscription_tier;

ALTER TABLE users
    ADD CONSTRAINT chk_subscription_tier
    CHECK (subscription_tier IN ('free', 'pro', 'enterprise'))
    NOT VALID;

ALTER TABLE users VALIDATE CONSTRAINT chk_subscription_tier;
