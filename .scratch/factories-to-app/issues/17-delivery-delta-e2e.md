# 17: Delta sync E2E in the app

**What to build:** Prove revision-cursor delta sync end-to-end in the guest app — not seam-only. `syncVenueBundle` already calls `bundleSyncUrl` with `since`; this ticket adds browser/functional proof and promotes the behavior to a shipped critical path.

**Blocked by:** 16

**Status:** resolved

## Acceptance

- [x] Functional or browser test: cached bundle with `revisionId` A → head advances to B → sync fetches delta manifest → only changed file hashes re-fetched (`planBundleSync` keeps unchanged bytes)
- [x] API route `GET /api/venues/[venueId]/bundle?since=` returns `mode: delta` with fewer files when PostDB head advanced (integration test exists in `delivery-delta.mjs`; app vertical must mirror)
- [x] `test/app/venue-download.test.mjs` covers `mergeManifestDelta` + `bundleSyncUrl` (extend if gaps)
- [x] Documented in spec: phone contract unchanged; only transport uses revision cursor
- [x] `npm run test:pre-merge-vertical` includes the new assertion for app-touching diffs

## Notes

Pure logic: `packages/venue-builder/lib/delivery/delta-sync.mjs`. App: `apps/party-tracker/lib/venue/download.js`, `app/api/venues/[venueId]/bundle/route.js`.
