-- Park Bound plain Postgres (no PostGIS) — E0.3 / E0.4
-- Profiles + contributions + observations. Geometry stays in builder JSON.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  avatar_key      TEXT,
  rank            TEXT NOT NULL DEFAULT 'visitor',
  xp              INTEGER NOT NULL DEFAULT 0,
  reputation      INTEGER NOT NULL DEFAULT 0,
  impact_helped   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS managed_guests (
  id              TEXT PRIMARY KEY,
  guardian_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  height_in       NUMERIC,
  age_years       NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contributions (
  id              TEXT PRIMARY KEY,
  author_id       TEXT NOT NULL REFERENCES users(id),
  venue_id        TEXT NOT NULL,
  place_id        TEXT,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  payload         JSONB NOT NULL DEFAULT '{}',
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS contributions_venue_status_idx
  ON contributions (venue_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS confirmations (
  id              TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL REFERENCES users(id),
  vote            TEXT NOT NULL CHECK (vote IN ('confirm', 'deny')),
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contribution_id, author_id)
);

CREATE TABLE IF NOT EXISTS score_events (
  id              TEXT PRIMARY KEY,
  author_id       TEXT NOT NULL REFERENCES users(id),
  contribution_id TEXT REFERENCES contributions(id) ON DELETE SET NULL,
  delta_xp        INTEGER NOT NULL DEFAULT 0,
  delta_rep       INTEGER NOT NULL DEFAULT 0,
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS observations (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL,
  place_id        TEXT NOT NULL,
  ts              TIMESTAMPTZ NOT NULL,
  wait_min        INTEGER,
  status          TEXT,
  source          TEXT NOT NULL,
  confidence      TEXT NOT NULL DEFAULT 'low',
  author_id       TEXT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS observations_place_ts_idx
  ON observations (venue_id, place_id, ts DESC);

CREATE TABLE IF NOT EXISTS evidence_claims (
  id              TEXT PRIMARY KEY,
  venue_id        TEXT NOT NULL,
  place_id        TEXT,
  kind            TEXT NOT NULL,
  source          TEXT NOT NULL,
  claim           JSONB NOT NULL,
  confidence      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
