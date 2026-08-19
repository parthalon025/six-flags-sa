-- Thanks on a Contribution — the Death Stranding like. One guest thanks the
-- finder of a settled fact; the first thanks per (contribution, thanker)
-- feeds the finder's profiles.impact_helped. Self-thanks never count and are
-- rejected in the store, not here.

CREATE TABLE IF NOT EXISTS contribution_thanks (
  id              TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  thanker_id      TEXT NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contribution_id, thanker_id)
);

CREATE INDEX IF NOT EXISTS contribution_thanks_contribution_idx
  ON contribution_thanks (contribution_id);
