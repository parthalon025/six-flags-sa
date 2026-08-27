# 16: Delivery export closeout

**What to build:** Close the gap between PostDB export code (#667) and production publish path — revision-pinned seed bundles, CI delivery leg proof, and `venues:factory-validate` freshness on `basedOn.revisionId` for all shipped flagships.

**Blocked by:** 15

**Status:** ready-for-agent

## Acceptance

- [ ] `npm run venues:export -- --all` (with `DATABASE_URL`) writes every flagship `public/venues/<id>.bundle.json` with `basedOn.revisionId` matching PostDB head
- [ ] Seed bundles on disk include revision cursor (today they only pin `basedOn.map` stamp)
- [ ] `artifact_blobs` rows registered for exported files when PostDB configured
- [ ] Delivery CI leg runs `test/builder/delivery-export.mjs` against `postgres:16` service
- [ ] `npm run venues:factory-validate -- --all` passes revision freshness for shipped venues
- [ ] `docs/guide/venue-builder.md` documents export as the publish step after PostDB promote
- [ ] No hand-edits to generated `public/venues/*`

## Notes

Code paths: `packages/venue-builder/lib/delivery/export-from-postdb.mjs`, `publish-bundle.mjs`, `bin/export-bundle.mjs`. Operating-stack epic NOW.
