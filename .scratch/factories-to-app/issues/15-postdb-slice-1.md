# 15: PostDB Slice 1 — factory bus schema and I/O

**What to build:** PostDB as the canonical store for factory outputs — migrations, `postdb-io.mjs`, truth revisions, display packs, venue heads, factory mirror sync from build pipeline.

**Blocked by:** None

**Status:** resolved

## Acceptance

- [x] `db/migrations/004_postdb_*.sql` applied in CI (`postgres:18`)
- [x] `writeTruth` / `writeDisplayPack` / `getHeadRevisionId` round-trip
- [x] `mirrorTruthToPostdb` + `mirrorDisplayPacksToPostdb` wired
- [x] `DATABASE_URL` required for factory verbs (ADR-0024 §5)
- [x] Release notes 1.33.3

## Comments

Shipped before this epic's delivery closeout. Ticket 16 stacks on this.
