-- Clerk external id on users (ADR-0010-clerk-profile-signup)

ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS users_clerk_id_idx ON users (clerk_id) WHERE clerk_id IS NOT NULL;
