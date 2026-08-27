-- Migration ledger for postdb:migrate and post-deploy schema checks (#443).

CREATE TABLE IF NOT EXISTS schema_migrations (
  name          TEXT PRIMARY KEY,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
