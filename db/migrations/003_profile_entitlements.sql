-- Profile subscription entitlements — one row per store transaction (ADR-0011).
-- Clerk owns identity; Apple/Google/web rails write here. Unique on store txn id
-- so the same purchase cannot grant twice.

CREATE TABLE IF NOT EXISTS profile_entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('apple', 'google', 'stripe', 'grant', 'prelaunch')),
  product_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked', 'grace')),
  original_transaction_id TEXT,
  expires_at TIMESTAMPTZ,
  environment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_entitlements_txn_uidx
  ON profile_entitlements (source, original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profile_entitlements_user_active_idx
  ON profile_entitlements (user_id, status, expires_at DESC);
