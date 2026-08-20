# ADR-0018 — Factory interaction and delivery

**Status:** Accepted (owner-confirmed point by point, 2026-08-20)
**Depends on:** [ADR-0008](./0008-databricks-back-office.md) · [ADR-0010](./0010-databricks-ops-free-tier.md) · [ADR-0013](./0013-display-pipeline.md) · [ADR-0016](./0016-custom-map-worlds.md) · [ADR-0017](./0017-visual-factory-request-contract.md)

## Context

Two factories now exist: the **Map factory** (universal venue builder) publishing truth, and the
**Visual factory** producing everything a guest sees on it. They need a contract for how they
couple, how a truth change propagates into visuals, and how certified packs reach phones — without
inventing runtime infrastructure this repo has rejected before.

## Decision

1. **Coupling is an artifact contract: the repo is the bus.** The Map factory publishes versioned
   truth (`map.json` + its `generated` stamp); the Visual factory conditions on it and stamps
   every pack with `basedOn` (already in the visual-spec shape). Either factory can run alone; no
   runtime link exists between them.
2. **Propagation is a CI freshness gate.** A certification row asserts every shipped pack's
   `basedOn` matches current truth, so a truth change without regenerated visuals cannot merge.
   The weekly drift and bake-drift watches remain the safety net. (The row itself lands with
   Train F.)
3. **Databricks stays back-office only** per ADR-0008/0010/0013 (do not relitigate): a Delta
   mirror of ledgers and certifications, and the natural home for fleet-scale batch regeneration
   compute — never a phone-facing delivery path.
4. **Delivery to the app is CDN + download manager** (the deferred ADR-0013 item): the phone
   fetches hash/manifest-addressed venue bundles, caches them offline, and re-checks manifests at
   app start. The four flagship venues stay pre-bundled as seed content.
5. **Publication: the deployed origin is the CDN.** Packs merge into
   `apps/party-tracker/public` through the freshness-gated PR and ship with the existing deploy
   pipeline (`cdn:warm` primes). No new hosting infra, no new credentials.
6. **Sequencing.** The download manager + manifest refresh + cache management is Train F,
   immediately after Train E; this ADR records it so Train E stays four slices.

## Rejected

- Event-driven regeneration queues between the factories.
- Post-merge auto-regen bot commits (regeneration rides the PR that changes truth).
- A separate object-storage publish job or new hosting origin.
- Databricks anywhere in the serving path.

## Consequences

- The freshness gate turns "visuals lag truth" from a process promise into a failing check.
- Publishing stays a reviewed diff: `venues:publish-worlds` (and its successors) write into
  `public/`, and the PR is the gate — exactly how Train E shipped the first two worlds.
- Train F owns: download manager, manifest refresh, cache management, the `basedOn` freshness
  row, the per-look size budget row, and the beyond-palette distinctness row (ADR-0017).
