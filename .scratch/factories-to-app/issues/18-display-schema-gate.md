# 18: Display-schema CI gate

**What to build:** `display-schema.json` fixture gates `visual.json` top-level shape in builder CI — regression guard for Visual factory output contract.

**Blocked by:** None

**Status:** resolved

## Acceptance

- [x] `packages/venue-builder/fixtures/display-schema.json`
- [x] `packages/venue-builder/lib/display-schema-gate.mjs`
- [x] `test/builder/display-schema-gate.mjs` in `test:builder`
- [x] Shipped in #667 (release 1.34.0)

## Comments

Operating-stack `parallelNotNow` — do not reopen; ticket exists for epic traceability.
