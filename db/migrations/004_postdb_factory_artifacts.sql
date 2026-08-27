-- PostDB factory artifacts — Slice 1 (ticket 15)
-- Append-only truth revisions, display packs, blob registry, venue head pointer.
-- Depends on: 001_profiles_contributions.sql (pgcrypto)

CREATE TABLE IF NOT EXISTS factory_runs (
  run_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          TEXT NOT NULL COLLATE "C",
  factory           TEXT NOT NULL CHECK (factory IN ('map', 'visual', 'delivery')),
  route_id          TEXT NOT NULL,
  idempotency_key   TEXT,
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  UNIQUE (venue_id, route_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS truth_revisions (
  revision_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id          TEXT NOT NULL COLLATE "C",
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  map_body          JSONB NOT NULL,
  pois_body         JSONB NOT NULL,
  gaps_body         JSONB NOT NULL DEFAULT '[]',
  outputs_hash      TEXT NOT NULL,
  created_by_run    UUID REFERENCES factory_runs(run_id)
);

CREATE INDEX IF NOT EXISTS truth_revisions_venue_generated_idx
  ON truth_revisions (venue_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS venue_heads (
  venue_id            TEXT PRIMARY KEY COLLATE "C",
  truth_revision_id   UUID NOT NULL REFERENCES truth_revisions(revision_id),
  published_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS display_packs (
  pack_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              TEXT NOT NULL COLLATE "C",
  skin_id               TEXT NOT NULL COLLATE "C",
  based_on_revision_id  UUID NOT NULL REFERENCES truth_revisions(revision_id),
  body                  JSONB NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, skin_id, based_on_revision_id)
);

CREATE TABLE IF NOT EXISTS artifact_blobs (
  blob_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL COLLATE "C",
  path          TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  storage_uri   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, path, sha256)
);

CREATE TABLE IF NOT EXISTS certifications (
  cert_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      TEXT NOT NULL COLLATE "C",
  factory       TEXT NOT NULL CHECK (factory IN ('map', 'visual')),
  revision_id   UUID REFERENCES truth_revisions(revision_id),
  pack_id       UUID REFERENCES display_packs(pack_id),
  status        TEXT NOT NULL CHECK (status IN ('certified', 'uncertified', 'warn')),
  body          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS certifications_venue_factory_idx
  ON certifications (venue_id, factory, created_at DESC);
