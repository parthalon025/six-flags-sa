# The park intelligence proposal, weighed against what is here

A proposal arrived to turn this app into a park intelligence platform: a normalized
park database in PostGIS, a Valhalla routing service, a rules engine, an evidence
pipeline with confidence scoring, a weather engine, a wait-time model, a planner, and
a party system promoted to a first-class component. This document decides, item by
item, whether the proposal or the code already in this repository is the better
answer — and where a third answer beats both.

It is written from an audit of the actual code, not from the README's account of it.
Every claim below carries the file and line it came from.

## The finding, in one paragraph

The proposal and the code disagree far less about **what to model** than about
**where truth lives at runtime**. Roughly a third of the proposal is already built
here under different names, a third is genuinely missing, and a third would break the
one property the app is built around: that it works in a queue line with no signal.
The parts worth taking are almost all *model* changes — identity, links, provenance,
reasons — and almost none are *infrastructure* changes. A third source, the ontology
vocabulary from Palantir Foundry, resolves most of the disagreement, because it
separates the semantic model from the runtime that serves it. That separation is
exactly what the proposal conflates.

## What the app is, stated as constraints

These are not preferences. They are the properties the test suite enforces and the
reasons most of the proposal's infrastructure is rejected below.

- **Offline is the premise.** `public/sw.js` precaches the shell, the venue map and
  the places. `test/functional.mjs` asserts *"the map still draws with the network
  cut"* and *"ride heights still work with the network cut"*, the latter in a browser
  context that has never answered the park question before going offline, so it also
  proves the intake does not go back to the network.
- **Five runtime dependencies**: `next`, `react`, `react-dom`, `qrcode`, `web-push`.
  The map renderer, the router, the crypto, the party protocol and the standalone
  host are all dependency-free.
- **No server is required.** A phone hosts the party and decides what is true. The
  only outbound call in the app is the weather proxy, and it fails soft.
- **The venue is generic.** Nothing in the renderer or the builder names a park. Four
  venues ship, one of which is a water park, and all four came through one pipeline.
- **Uncertainty is stated, not hidden.** Absence stays distinguishable from zero, a
  guess is labelled a guess, and the app never claims an operations feed it does not
  have.

## Verdicts: the park intelligence proposal

| § | Proposed | Verdict | Reasoning |
|---|---|---|---|
| 1 | Layered pipeline architecture | Split | The stage naming is useful; the server-centric runtime is not |
| 2 | PostgreSQL + PostGIS as the primary store | **Code** | A database cannot be service-worker precached. You would keep the JSON anyway and have two sources of truth to drift |
| 3 | Statistics separate from operational rules | **Concept** | The repo has three integers and a prose `note` used as a dumping ground |
| 4 | Eligibility engine, four verdicts | Split | The five verdicts here are richer; reasons, provenance and profiles are missing |
| 5 | Valhalla or OSRM | **Code** | 1.8 ms per query, and neither engine repairs OSM's 221 disconnected pieces |
| 6 | Path attributes — stairs, shade, stroller | **Concept** | `highway=steps` routes as flat midway. A live correctness problem |
| 7 | Weather to operational probability | **Code** | `exposureFor`/`outlookFor` already do this. Add a per-ride override seam |
| 8 | Weather-aware planning | **Concept** | Nothing exists |
| 9 | Static and dynamic data separated | **Code** | Already separated |
| 10 | Wait-time and crowd engine | **Concept** | Blocked: nothing in the app is append-only |
| 11 | Generic POI system | Split | Eleven categories, closed set; adding one touches five files |
| 12 | Accessibility engine | **Concept** | Nothing exists. `wheelchair=*` is not even queried |
| 13 | Food intelligence | **Concept** | `cuisine` and `diet:*` not read. Low priority |
| 14 | Events and showtimes | **Concept** | `opening_hours` not queried |
| 15 | Autonomous research agents | **Code** | `venue-requests.mjs` briefs a human instead, which is better calibrated |
| 16 | Evidence engine | **Code** | Dedupe-by-source and anchor-don't-average beat the proposal's averaging |
| 17 | Temporal database | **Concept** | No valid-from/to, no seasons, no operating calendar |
| 18 | Nineteen-step georeferencing pipeline | Split | `georef.mjs` is rigorous and has zero inputs on disk |
| 19 | Computer vision candidate detection | Neither | Defer. Source weights are already reserved for it |
| 20 | Human validation UI | **Concept** | The highest-leverage item in the proposal. Unblocks §18 |
| 21 | Python, FastAPI, Redis, Celery | **Code** | — |
| 22 | Uniform connectors | Split | Take the interface shape, not the framework |
| 23 | Entity resolution | **Concept** | Every join in the system is a lowercased display string |
| 24 | Confidence scoring table | **Code** | Foundry has no confidence primitive at all. This repo is ahead |
| 25–26 | The planner | **Concept** | Nothing exists |
| 27 | Canonical taxonomy | Split | Useful as a checklist of gaps |
| 28 | Generic engine, park as dataset | **Code** | Already done, including a water park |
| 29 | apps/services/workers layout | **Code** | `lib/` already maps to the same domains |
| 30 | Twelve-service docker-compose | **Code** | Kills `npm run phone` |
| 31 | MVP phases | Split | Phases 1 and 2 are largely done. Reorder against what exists |
| 32 | Digital twin end state | Ontology | See below |

## Verdicts: the party proposal

| § | Verdict | Reasoning |
|---|---|---|
| 1–3 | **Code** | Party object, live map and staleness tiers all exist — 5 min dim, 12 min quiet, 45 min evict |
| 4 | **Concept** | No sharing duration or precision control. `settings.shareLocationHistory` is unreachable dead code |
| 5 | **Concept** | Two roles, derived from who hosts, carrying no permissions |
| 6–7 | **Concept** | Subgroups and split-party absent entirely |
| 8 | **Concept** | Reunification absent, and cheap now that routes cost 1.8 ms |
| 9 | **Code** | Navigate-to-member re-resolves live coordinates each render |
| 10–12 | **Concept** | Party-aware routing, party-aware ride planning and guardians: none exist |
| 13 | **Code** | Lifecycle is covered by the TTL ladder. Low value |
| 14 | **Code** | Hybrid is already the default: five transports, warm standby, host mirroring |
| 15 | **Code** | Two-axis adaptive GPS with battery interpolation beats the proposal's flat table |
| 16 | Split | Layers exist. A weather layer does not |
| 17 | **Code** | Trip replay is a deliberate refusal: *"Location history is never kept"* |
| 18 | Split | The meet-up exists as one manual pin. Expiry and calculation are the upgrades |
| 19 | **Code** | Four sealed notification kinds with host-only deduplication |
| 20 | **Concept** | Party-aware planner |
| 21–22 | **Code** | Four surfaces over one data layer is already the architecture |

## What the ontology adds that neither document had

Foundry's value here is not its platform, which is irrelevant at this scale. It is a
vocabulary that names things this codebase has half-built.

**Scenarios are the planner.** A scenario is a sandbox of *staged actions* over live
data, not a cloned store: reads inside see the overlay, reads outside do not; it
rebases onto fresh base data, so a plan absorbs a ride going down; merging is itself
one action committing every staged edit at a single version bump; it is scoped to
declared types and it expires. `lib/core/state.js` is already a reducer where every
mutation goes through `submit()`, so the primitive fits. It yields the missing planner
and the missing undo from one mechanism. Foundry's own warning travels with it:
scenarios are not version history, so this must not become the edit log.

**The action log is the wait-time series.** Foundry's log captures *unedited context
properties* — the state of the world at the time of submission. Recording what was
observed when somebody reports a ride down turns the existing reducer into the
observation series the app lacks, with no server and no claimed feed.

**Deterministic primary keys, framed as data loss.** Palantir's warning is not about
tidiness: non-deterministic keys *lose user edits*, because edits are keyed to the
primary key. That is precisely `lib/venue/ids.js`.

**Interfaces over concrete types.** `Queueable`, `Locatable`. This collapses the
rideable test currently copy-pasted six times.

**Base ⊕ edits with a declared conflict strategy.** Base data is replaceable
wholesale; edits live keyed by primary key with per-property precedence; deletions are
not edits, so a tombstone survives the source reinstating the object. This is close to
what `applyOverrides` already does informally, and writing the rule down prevents a
class of "why did my correction come back" bugs.

One place this repo is ahead of Foundry: Foundry refuses to arbitrate conflicting
sources at the ontology layer — one property, one source, reconcile upstream.
`scripts/lib/evidence.mjs` does arbitrate, retains dissent, and blocks conflicts from
publishing. For OpenStreetMap plus park sources that is the better call, and Foundry
has no equivalent.

## Three defects found while auditing

These were not on anyone's list. They are described here and tracked as work items.

**1. Two writers, one scheduled.** `public/venues/<id>.pois.json` is produced by both
`scripts/build-venue.mjs`, which regenerates it wholesale from OpenStreetMap, and
`scripts/attractions.mjs` `publish()`, which writes fused entrances into `e` and
`out`. Only the first runs in `.github/workflows/build-venue.yml`. Published derived
entrances therefore regress silently on every rebuild: the evidence sidecar survives,
the published fields do not.

**2. Provenance laundering.** `scripts/lib/candidates.mjs:114-126` reads any `poi.e`
entry and emits it as `source: 'osm_named_queue'` at weight 4 with the note *"a named
queue tagged one-way towards the ride"*, without checking `e[i].src`. But `e` is also
written by `applyTrace` and by `publish()`. A traced pin, weight 3, re-enters as a
weight-4 mapper-surveyed claim with a false justification; 3 + 4 = 7 reaches the
`moderate` publish floor, and a single fact publishes itself. This is the exact
repetition `fuse()`'s dedupe-by-source-kind rule exists to prevent, routed around by
the field rather than the source.

**3. Dead read.** `scripts/attractions.mjs:134` looks for `p.in`; `applyTrace` writes
`p.e`. Nothing in the repository writes `p.in`. Traced entrances are invisible to the
inventory. Exits still work.

## The work, in order

Sequencing is driven by what unblocks what, not by what is most visible.

1. **The three defects.** Small, independent, and two of them corrupt data quality
   silently.
2. **Deterministic primary keys.** Five later items get materially easier, and every
   hand-authored override in the repo is currently keyed to a display string that
   OpenStreetMap can change underneath it.
3. **Links and the ontology manifest.** Connect the 230 accumulated evidence records
   to the bundle that ships, and kill the copy-pasted type tests.
4. **Path attributes, then routing profiles.** The router already has the right seam;
   the bundle carries `{r, n}` and nothing else.
5. **Eligibility v2** — reasons, provenance, per-member profiles.
6. **Scenarios and the action log.** The planner, the undo, and the observation
   series.
7. **Party gaps** — subgroups, reunification on the real graph, sharing controls.

Detailed per-workstream implementation plans follow as they are completed.

## Deliberately not planned

Wait-time prediction, crowd modelling, food and menu data, computer-vision detection,
and autonomous research agents writing to the database. Three of these have no data
source that does not require a server. Computer vision is a stated non-goal in
`scripts/attractions.mjs`, which is candid about why: those sources are real and each
one is a project. The door is already open — `aerial`, `guest_photo` and `video`
carry weights in the evidence table — and nothing needs to be built until somebody
walks through it.
