# Factory workflow doctrine — Raw Data → Ontology → Operational Use Case

**Date researched:** 2026-08-23
**Subject:** Palantir-distilled workflow template applied to Parkbound's **Map factory** and **Visual factory**
**Status:** Research complete — claims checked against the live Notion page (template v3.1, viewed 2026-08-22) and the factory code/ADRs on this tree
**Not a new ADR.** Doctrine is already accepted in [ADR-0017](../adr/0017-visual-factory-request-contract.md), [ADR-0018](../adr/0018-factory-interaction-and-delivery.md), [ADR-0020](../adr/0020-imagery-ground-truth.md), and [CONTEXT.md](../../CONTEXT.md). This note is the stage-and-gate map so later factory work follows the gates, not just the artifacts.

## Sources

| Source | Role |
|---|---|
| [Workflow Template — Raw Data → Ontology → Operational Use Case](https://app.notion.com/p/7ced435013d143388d6b0fbd6c436f27) (v3.1) | Primary. Stages −1 → 9, default-stack translation, ontology ID rules, failure-mode table |
| [Universal Park Builder — Offline Digital Twin Blueprint](https://app.notion.com/p/9be83d3a5db441df855298559215cbe9) (v1.1) | Already maps that template onto the Map factory |
| [Grocery Need-Match Prototype — Filled Workflow Template](https://app.notion.com/p/f25c0685a7c044608d4a758420a54087) | Worked example: delete inapplicable stages, keep the gate language |
| [Foundry Pipeline Architect Skill](https://app.notion.com/p/c7f69fac547547488631a84633f75ebc) | Ingest-as-is, expectations vs health checks, one schedule per dataset |
| [Custom map display factory](./2026-08-18-custom-map-display-factory.md) | Same doctrine on the Visual factory |
| `packages/venue-builder/lib/build-pipeline.mjs` | Current Map + Visual stage list |

The template is for builds **outside Palantir**. Foundry is a translation column, not a destination. That matches ADR-0008 / ADR-0010: Databricks is back-office only. For **factory outputs**, PostDB is the bus ([ADR-0024](../adr/0024-postdb-factory-bus.md)); git remains the bus for code and builder inputs.

---

## BLUF

Treat each factory run as one **use case**, not one dataset and not one script. The use case is the certified offline twin (Map factory) or the certified **Display pack** (Visual factory). Design backward from the guest decision; build forward from raw ingest; ship the smallest slice that changes a day in the park.

A stage is finished when its **gate** passes, not when the file exists. That is the sentence the 2026-08-11 blueprint already used against PR #61, and it still holds: `certification.json` exists, fleet refuse-done does not.

The ontology is the use case API. For us that API is files, not a graph database: `map.json` / `pois.json` / `gaps.json` (truth) and `visual.json` / `manifest.json` / baked worlds (display). The phone never learns how Overpass, Tippecanoe, or an LLM step worked.

---

## The spine, in this repo

```
SOURCE                 CLEAN                    ONTOLOGY                 LOGIC                    SURFACE
(as-is caches)         (typed, tested)          (semantic + kinetic)     (verbs + AI)             (decision)

OSM Overpass        ─┐
official site / API ─┤  osm-tags · geometry   ─►  Venue · Place · Ride  ─►  evidence fuse        ─►  phone bundle
imagery / Mapillary ─┼► repair · claim parse      Height · Land · Path      PUBLISH_AT · certify      (offline)
trace / overrides   ─┘  + tests as gates          ids.json ledger           governed sidecar writes   display pack

        └──────── recipe.json + evidence-graph + certification.json ────────┘
                                    ▲
                                    └──── writeback: overrides / heights / PR merge ────┘
```

The loop at the bottom is the part most factories skip. A human decision (override, height, entrance approval, merge) lands as a sidecar and becomes input to the next rebuild. Action logs are the training set for whatever we automate next.

### Layer translation (template default stack → factories)

| Template layer | Map factory | Visual factory |
|---|---|---|
| Ingest as-is | Overpass dump, `official-cache.json`, adapter `*-cache.json`, imagery tiles | Design-request doc, material sources, grounding harvest, **Map factory** truth |
| Transform in git | `osm-tags.mjs`, geometry repair, `normalizeExternalClaims` | Skin compile, material ledger, Tippecanoe, bake |
| Expectations | `venue-certify.mjs` aborts below threshold | `display-certify` + zero coordinate-delta + size/node budgets |
| Semantic layer | `map.json` + `pois.json` + `gaps.json`; `i` is the string `id` | `Skin` / `SkinTemplate` / `DisplayPack` / `MaterialSet` |
| Actions | publish entrance · apply override · retire key · certify · merge PR | approve material · generate pack · certify pack · publish pack · retire skin |
| Logic / AI | Deterministic geometry + parsers first; LLM proposes aliases/heights as claims | LLM authors style as schema-constrained claims; bake/tile stay deterministic |
| Security / markings | License gate, ODbL attribution, no guest PII in the builder | Same license-before-embed; AGPL rejected |
| Surface | Offline phone bundle — cheapest surface that completes navigate → filter → meet | Same phone; **Wear** selects the look |
| Lineage & ops | `recipe.json`, evidence graph, `venues:report` / `compare` / `route-qa`, drift watch | `basedOn` stamp, bake-drift watch, freshness CI row |
| Packaging | One tagged release: sidecars + bundle + app | Truth + display pack ship together; visuals lagging truth cannot merge (ADR-0018) |

---

## Standing rules (bind every factory change)

These are the template rules that already have a Parkbound name. New factory work should fail a review if it violates one.

1. **Ingest raw, as-is.** The versioned pipeline is the single record of every change from source to ontology. Pre-cleaned laptop extracts destroy Stage 8 lineage. Caches (`official-cache.json`, Overpass dumps, imagery ledgers) stay identical copies.
2. **Profile before you clean.** Transforms target measured defects (null rates, unit/timezone, distinct keys). Skipping this is how silent defects survive into `pois.json`.
3. **Expectations fail the build; health checks only alert.** Certification, publish floor, and `basedOn` freshness are expectations. Drift watch and volume checks are health. Do not invert them.
4. **Deterministic work stays deterministic.** Geometry, parsing, counting, tiling, baking, and arithmetic are code. Language models earn their place on extraction, classification, ranking, and drafting — and their output is a **claim**, never a direct write. `llm_extract` alone cannot clear `PUBLISH_AT`.
5. **Resolution is its own stage.** Two systems describing the same ride (OSM name ≠ official name ≠ ParksAPI name) go through match rules, survivorship, and a recorded dissent. Never a silent rename. The `ids.json` ledger is the canonical registry: keys issued once, retired never reused; OSM id is provenance, not identity.
6. **Title ≠ key.** `n` is what a guest reads; `i` is what edits and ride reports are filed under. Never infer a property by parsing the id.
7. **Objects are pulled by the use case.** Do not model the enterprise park. Model the workflow (navigate, height-filter, wear a Skin) and let the ontology compound.
8. **Only mark an object editable if a user must change it.** Generated truth and generated display are not editable copies of each other. Overrides and design-request docs are the write path.
9. **Writeback has a contract.** Idempotency key, visible rejection, named system-of-record per field, scheduled reconciliation. For us: sidecar write + next rebuild is the transaction; the draft PR is the human action; merge is the recorded approval.
10. **AI assurance is part of the build.** Any model-backed step ships with a golden set, a fail-below threshold, pinned model/prompt/tool versions, a deterministic fallback, and a path for operator corrections back into the eval set.
11. **Health checks answer three questions:** does data get in, does it get built, does it get out. A wall of noisy checks trains everyone to ignore alerts.
12. **Package as one release.** Migrations + config + app, or for factories: sidecars + certified bundle + display pack. Shipping pieces separately is how environments drift.
13. **Missing is a finding.** Declared-absent heights beat a quietly empty Rides tab. A missing source is a scoping decision, recorded in `ask`, not a week-five surprise.
14. **No number without a denominator.** Coverage is published/known per park — never a bare percentage.
15. **The phone stays lean.** The twin is JSON plus a service worker. No PostGIS, no tile server, no Foundry, no Databricks on the serving path.
16. **Pragmatism.** If it delivers the guest decision it is good, even if imperfect. If it is perfect and delivers nothing, it is bad.

### Ontology ID rules (prevent painful migrations)

Copied from the template; already implemented for Places in `packages/venue-builder/lib/venue-ids.mjs`:

- Primary key is a string, inherently unique, built only from the object's own properties. Never row order, never a value generated at build time.
- Create a separate id column even when another column looks unique today. Columns stop being unique; migrating a key touches every app, function, and API.
- Foreign keys stay readable (`<object>_id`). Do not hash composite keys.
- Event fields follow `<verbed>_at_timestamp` / `<verbed>_by_user` when we record a decision.
- Link names describe the relationship in both directions.
- No version suffixes (`Message_v2`) and no `[tag]` prefixes on type names.
- Minimize properties. If a child's value is guaranteed by its parent, keep it on the parent.
- Every object type has a point of contact, a maturity status, a description, and aliases where the business uses different words.

---

## Stage map — what each factory already does, and the gate

Fill Stages −1 through 1 before opening a new factory tool. Everything downstream inherits that framing. Delete a stage that genuinely does not apply; keep the gate language for the ones you keep (Grocery Need-Match deleted Stage 2 for a solo prototype — that is the pattern).

| Stage | Template gate | Map factory today | Visual factory today | Still open |
|---|---|---|---|---|
| **−1 Choose** | Scored candidate + kill/pivot per slice | Offline certified twin vs. live waits / server routing (rejected) | Certified display pack vs. runtime world-gen (rejected) | Score new venue classes (zoo, campus) before building them |
| **0 Frame** | One sentence: user, decision, objects, metric | Party member offline: trust the map, heights, route | Profile offline: does this Skin feel like a prize, with zero coordinate deltas | Keep Mad Libs on every new factory slice |
| **1 Slice** | Plumbing in the user's hands in days | `runVenuePipeline`: sources → geometry → … → certify → display | Display stages after truth certify; default on for flagship venues | Fleet refuse-done (Wave 1 remainder) |
| **2 Projects / security** | Named owner, security table before real data | Builder vs phone runtimes; license markings at ingest | Same split; materials license-before-embed | Multi-steward review UI deferred (ADR-0010) |
| **3 Connect as-is** | One successful sync + row/file count + owner | Overpass, official cache, adapters, imagery ledger | Design-request + material fetch + grounding harvest | Token-gated adapters must carry `gaps.adapters.<id>` |
| **4 Clean / type / test** | Green build, expectations pass, PK unique by query | Typed layers, `ids.json` uniqueness, route-qa numbers | Schema-valid specs, material compile | Profile-before-clean still informal on new sources |
| **4.5 Resolve** | Match rules written, duplicate-rate recorded, fuzzy reviewed, reversible | Alias claims, ledger match, dissent recorded | `basedOn` binds a pack to a truth version | Operator-scale official≠OSM names (Wave 2) |
| **5 Ontology** | User answers one question by traversing objects, no purpose-built app | `venues:report` / SQL-less JSON + checklist | `visual.json` + manifest readable without the renderer | Generic object browser is the files + `venues:ask` |
| **6 Verbs** | Action writes what it claims; refused for the wrong user; evals green | publish entrance, override, retire, certify, merge | approve / generate / certify / publish / retire | Interactive claim review (Wave 4); LLM eval golden sets for design requests |
| **7 Surface** | Find → decide → act without help | Phone bundle | Phone + **Wear** | Cheapest surface is already the PWA — do not add a steward App until multiple stewards need it |
| **7.5 Adopt** | Action-log trend up; legacy path has a retirement date | Certified parks 4 → catalog; drift age | Skins with materials; pack size budget | Instrument certified-park and pack-freshness counts as queries, not slides |
| **8 Operate** | Someone else traces a number to source; runbook owner per failure | report / compare / route-qa / drift-watch / bake-drift | freshness CI, display-certify, bake-drift | Fleet-scale Databricks mirror only — never serving |
| **9 Prove** | Metric moved vs baseline; next use case named | Routing islands ≤ 2, heights with denominators | Zero coordinate deltas, size/node budgets | Adjacent venue class named when Wave 2 inventory is real |

---

## Tradecraft (from the training sessions, already Parkbound-shaped)

- Requirements are discovered inductively. Give the guest (or the gold-park fixture) something, watch it fail, keep what works, shorten the cycle.
- Be hyper-specific about the immediate problem and comparatively agnostic about the solution. A vivid Skin concept with no guest decision is Stage 0 failing.
- Get the plumbing working first: one park, sources → certify → boots in the app. Value features come after that path exists.
- Treat every factory design as a hypothesis the gold parks may invalidate. Hold high conviction about the problem (offline trust; Skin as prize).
- Engagement rhythm: hardest valuable problem → the operators who live it (here: the party in the park, and the maintainer who certifies) → the data they need → connect systems → ontology → one workflow → iterate → adjacent venue.

---

## Failure modes the template names — factory translation

| Failure mode | What it looks like here | Prevented at |
|---|---|---|
| Solution-first framing | "Stand up an ontology" / "add a tile server" with no guest decision | Stage 0 |
| Boiling the ocean | Twelve-week factory redesign, nothing certified | Stage 1 / Wave 0 |
| Preprocessing outside the pipeline | Hand-cleaned GeoJSON that the next rebuild cannot replay | Stage 3 / `recipe.json` |
| Ontologizing dirty data | Duplicate keys, null titles, mixed units in `pois.json` | Stage 4 / certify |
| Source-shaped ontology | Object types nobody says out loud (`osm_way`, `overpass_el`) | Stage 5 / CONTEXT vocabulary |
| Numeric or derived primary keys | Rebuild reassigns `i`; ride reports orphan | Stage 5 / `venue-ids.mjs` |
| Silent rename | Official name overwrites `i` | Stage 4.5 / alias claims |
| LLM doing deterministic work | Model invents coordinates or height numbers that ship | Stage 6 / publish floor |
| Actions without submission criteria | Vision guess published; Skin moves a pin | Stage 6 / `PUBLISH_AT` + zero-delta |
| Built but not certified | 100 parks on disk, unknown quality | Wave 1 |
| Shipped but unused | Packs merge; phones still on the default SVG | Stage 7.5 |
| Untested model upgrade | New extract prompt silently thins heights | Stage 8 evals |
| No kill criteria | A doomed venue class consumes three slices | Stage −1 |

---

## What this page is *not* asking us to do

- Do not adopt Foundry, Ontology Manager, Workshop, or AIP as runtime. The default-stack column is the one we are on.
- Do not add event-driven regeneration queues between the factories (ADR-0018 rejected).
- Do not put Databricks on the phone-facing path.
- Do not invent an enterprise park ontology ahead of the next use case.
- Do not write guest party data into the builder.
- Do not hide a failed gate with a prettier dashboard. The gate is the product.

---

## Definition of done for a factory slice

Reuse the template's checklist, Parkbound-named:

- [ ] Mad Libs with a named user, a specific shortcoming, and a metric
- [ ] Slice 1 is one park or one look, plumbing through certify, in a real bundle
- [ ] Every source landed as-is with a recorded count and an owner
- [ ] Clean outputs green; primary keys unique by query
- [ ] Entities resolved with written match rules; no silent merges
- [ ] Actions write through sidecars / PRs, not by editing generated files
- [ ] Model-backed steps have a green eval at pinned versions, or no model step
- [ ] Certification (truth and/or display) is a failing check, not a document
- [ ] Someone other than the author can trace a shipped number back to a cache
- [ ] Decision log records why (survivorship, editability, surface, kill)

When a factory change cannot name its stage and gate, it is not ready to start.
