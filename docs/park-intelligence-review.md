# The park intelligence proposal, weighed against what is here

> **Canonical domain language is root `CONTEXT.md`.** This review is historical. Accepted contradictions vs this document: heights travel on the party mesh; an in-bounds **Location** trail is kept for the family; **Party** join is name-first.

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
`packages/venue-builder/lib/evidence.mjs` does arbitrate, retains dissent, and blocks conflicts from
publishing. For OpenStreetMap plus park sources that is the better call, and Foundry
has no equivalent.

## Eight defects found while auditing

None of these were on anyone's list. Three were found in the first pass; the rest
turned up when the fixes were planned in detail, and two of them are worse than what
they were found alongside.

**1. Three writers, one scheduled.** `public/venues/<id>.pois.json` is produced by
`scripts/build-venue.mjs` via `writeVenue` (`:1645`), by `scripts/attractions.mjs`
`publish()` (`:350`), and — the one missed on the first pass — by `reapply`
(`:876`), which reads the generated bundle back off disk, re-applies overrides and
writes it out again. That last one is a read–modify–write on a generated artifact,
which makes whatever is sitting in the bundle self-perpetuating. The consequence is
that `npm run venues:overrides` **preserves** published entrances while
`npm run venues:rebuild` **destroys** them: two maintenance paths that disagree about
whether a field exists. Only the builder runs in `.github/workflows/build-venue.yml`,
so the sidecar is the one artifact on the graph with no schedule at all.

**2. Provenance laundering, on two fields.** `packages/venue-builder/lib/candidates.mjs:114-126`
reads any `poi.e` entry and emits it as `source: 'osm_named_queue'` at weight 4 with
the note *"a named queue tagged one-way towards the ride"*, without checking
`e[i].src`. A traced pin, weight 3, re-enters as a weight-4 mapper-surveyed claim
with a false justification; 3 + 4 = 7 reaches the `moderate` publish floor and a
single fact publishes itself.

The heavier path is on `out`. `publish()` stamps `src.by` with the feature name, so a
published exit carries `'ride_exit'`. On the next run `fromTrace` tests
`at.src?.by === 'trace' ? 'traced' : 'official_map'` (`attractions.mjs:144`), and
`'ride_exit' !== 'trace'`, so the app's own output re-enters as **`official_map` at
weight 5** — the top of the table — annotated "traced off the park's own map".
5 + 5 = 10 = `high`. Any fix has to cover both fields.

**3. Dead read.** `scripts/attractions.mjs:134` looks for `p.in`; `applyTrace` writes
`p.e`. Nothing in the repository writes `p.in`. Traced entrances are invisible to the
inventory. Exits still work. The README repeats the stale claim in two places, at
`:745` and `:785`, and `venue-trace.mjs:7` says it a third time.

**4. Stale source kinds double-count, and it is live on disk.** `addEvidence`
supersedes only same-source entries. Commit `9a4d647` labelled the queue-name
detector `osm_named_queue`; `a318e6c` renamed it `osm_queue_name` and gave the old
label to a different detector. The rename orphaned evidence nothing will ever clear.
Cedar Point's Maverick carries both labels for **the same OpenStreetMap way**, counted
as two independent sources — the exact repetition `fuse()`'s dedupe-by-kind rule
refuses, routed around by a source rename rather than by a field. Score 6 against a
floor of 7: one more claim and a double-counted fact publishes. All seven Cedar Point
`station` slots carry the same stale label.

**5. Staleness is inert by construction.** `addEvidence` stamps `date: claim.date ||
asOf`, where `asOf` is the run date. Every evidence entry in all four sidecars reads
`2026-08-09` — when the script last ran, not when anything was observed. So
`staleness()`, which exists precisely to flag evidence older than twelve months
without decaying it, can never fire: the pipeline re-dates its own derived claims on
every run. 230 records, `last_verified: null` on all of them, `stale: false`
everywhere. This also means wiring the inventory into the build naively would rewrite
all 230 records every run and produce a non-empty pull request on every rebuild,
destroying the byte-identical-rebuild property that makes "does OpenStreetMap still
say what we shipped?" a question a diff can answer.

**6. Two keep-predicates that disagree about who owns `e`.** `publish()` keeps
entries matching `!x.src?.by && metresBetween(x, value) > 20`, so a traced entry —
which has `src.by` — fails the test and **publishing silently deletes every traced
entrance from the bundle**. `applyTrace` keeps `x.src?.by !== 'trace'`, which
preserves published entries. Whichever ran last wins.

**7. A height-chart column header is shipped as a ride.**
`public/venues/kings-island.pois.json` carries two places literally named **"Age or
Weight"**, categorised `c: "ride"`, in Action Zone and Coney Mall. It is a column
header from the park's height chart that has been ingested as an attraction. Two
"Arcade" entries are filed as rides too. Neither has a rule, so both currently render
"Check at the ride" as though they were things you could queue for. They belong on the
`drop` list.

**8. The routing graph invents shortcuts over and under bridges.**
`splitAtCrossings` (`lib/routing.js:229-279`) welds a junction wherever two ways cross
in plan view. Two ways at different `layer` do not meet in reality. Kings Island has
30 ways tagged `bridge` and 33 carrying a `layer`, so this is not theoretical — the
router will happily walk you off a bridge onto the path beneath it. This is a
correctness bug of the same kind as the stairs one and probably a larger one in
practice.

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

Detailed per-workstream implementation plans follow. Seven workstreams, in the order
above; the first six are written against the code as it stood when each was planned,
and the seventh closes the one gap the ordered list named without a section.

### Workstream: pipeline integrity

*Partially implemented. Provenance vocabulary (`SRC_BY`), trace signing, staleness
dating, and the `p.in` → `p.e` read are landed; the inventory build stage and the
Kings Island `expect` lock are not.*

The fix for defect 1 has two candidate shapes and they are not equivalent.

**Make the inventory a stage of the build.** `inventory()` reads both its inputs off
disk today; refactor it to take `{ map, pois }` in memory and call it inside
`buildOne` after the trace block and before `pois.sort()` and `driftFrom`. `publish()`
then mutates the in-memory places and the single `writeVenue` emits them. `e` becomes
fully derived on every build, so there is nothing left to regress.

**Or have `publish()` write into `overrides.json`.** Rejected, for four reasons. The
overrides file is hand-authored and every comment in the repo says so, and a machine
appending to it makes "who wrote this line" unanswerable. `applyOverrides` does
`Object.assign`, so a published `e` would clobber `entrancesFromQueues` rather than
merge with it — the same fight in the other direction. It is the wrong layer: an
override is raw hand input and a fused coordinate is derived output, so this is
upstream-writeback, the same violation moved one file left. And it does not fix the
read side at all.

Take the first. It is the only option that satisfies both single-writer discipline and
"derived values flow downstream as ordinary properties" at once.

**Ordering is load-bearing here, not stylistic.** Defect 5 must be fixed before the
inventory joins the build, or every rebuild produces a non-empty pull request and the
property the whole design protects is gone. Three groups:

1. *Independent, no bundle regeneration.* Defect 3 and the three documentation fixes;
   the case-sensitivity join in `inventory()`, which is a no-op on today's data and
   expensive the first time OpenStreetMap recapitalises a ride; and the Kings Island
   walkable-network lock.
2. *One pull request, one bundle regeneration.* A single `src.by` vocabulary across
   all three writers, both readers refusing unsourced entries, the retired-source
   purge, a rebuild to stamp Cedar Point's six entrances, and the test that every
   entrance says where it came from. Landing any of these without the others either
   costs Cedar Point its claims or fails CI.
3. *After both.* Defect 5, then the inventory stage, then promoting the checklist's
   required items to build-aborting expectations.

**The Kings Island lock should be data, not prose.** The bundle measures 105.9 km of
walkable network today; a fresh Overpass query returns 95.9 km. That is 10 km of
service road the routing depends on, and it cannot be got back. Add an `expect` block
to the recipe carrying `walkable_km_min`, enforced in three places — a throw in the
build before `writeVenue`, carried through `recipeFrom` so a rebuild cannot delete the
lock it was built under, and a test asserting every venue clears its own floor. It
generalises: `expect` is the venue-scoped expectations block and the recipe already
records `pois`, `rides` and `heights` counts that nothing reads.

**On the primary-key expectation:** it cannot simply assert that ride names are
unique, because Fiesta Texas legitimately ships two Poltergeists and two Gully
Washers as separate OpenStreetMap objects. The assertion is that duplicates agree on
the fields the pipeline joins on.

### Workstream: path attributes and routing profiles

*Partially implemented. Tags ship as `f`/`l` on path and service ways via
`packages/venue-builder/lib/osm-tags.mjs` and `lib/wayFlags.js`; coverage is measured across all
four venues (see below). Routing profiles, the `meta` coverage counter, layer-aware
crossing splits, and the snap exclusion predicate are not.*

A live Overpass probe over the Kings Island box changes the shape of this work. Of 732
`highway` ways: `oneway` on 142, `surface` on 42, `access` and `foot` on 35 each,
`layer` on 33, `bridge` on 30 — and **`highway=steps` on exactly two.** `wheelchair`,
`incline`, `covered`, `indoor`, `width` and `conveying` are on **zero**.

So the framing "the blocker is the data, not the algorithm" is right but off by one
level. The blocker is not that `build-venue.mjs:387` discards the tags. It is that at
this park the tags mostly do not exist. Carrying them is still correct and nearly
free, and it is the only way data can ever arrive as OpenStreetMap improves — but the
honest deliverable is not "unlock routing profiles". It is three things: carry the
tags; ship a per-venue **coverage counter** in `meta`; and make every profile's copy a
function of that counter, so a profile with zero coverage is not offered at all and a
profile with thin coverage says so on the route card. Without the counter this ships a
wheelchair button that draws a confident line from no data, which is worse than
shipping nothing.

That also reorders the value. The stairs bug is real but it is two ways at one park.
**Grade separation is the bigger win** — 30 bridges and 33 layered ways at Kings
Island alone, every one of them a potential invented junction.

**Encoding: a bitfield integer, `f`, emitted only when non-zero.** Note that
`map.json` is written minified by `serializeVenue`, so it has no diffability to
protect — the reviewable file is `pois.json`. Measured cost: **+1.4 KB at Kings
Island, +1.8 KB at Cedar Point**, the constrained venue at 628 KB against a 1200 KB
ceiling. Named keys would cost 5–6× that and grow without bound; the bitfield is flat
to thirteen bits. This is not a bundle-size decision.

**`FACTOR` should not become a parameter.** `index()` bakes cost into the graph, so
per-profile factors mean re-indexing or duplicating it. Unnecessary — `opts.penalty`
is already a per-segment multiplier, so a profile is a pure function over
`graph.segments`, memoised per graph. One graph, one index.

**A fourth penalty-hook defect, and it is the one that breaks exclusion.**
`snapToGraph` knows nothing about `penalty`, so with a segment set to `Infinity` the
search will still snap you *onto* it and charge a finite cost to walk along it — a
wheelchair route that begins by going up the stairs it excluded. Snapping needs an
exclusion predicate, and "the only reachable snap is excluded" is a legitimate
`blocked` result.

Relatedly, `continue` alone does not fix the alternates bug. Penalty accumulates only
from accepted routes, so a rejected candidate would be re-derived identically next
round and the loop would spin to its limit producing nothing. The rejected candidate's
segments have to be penalised too.

**Synthetic segments must mean unknown, not step-free.** `bridgeIslands` is how the
graph is connected at all — 221 pieces down to two. A profile that hard-excluded
unknown segments would disconnect the park. Synthetic links stay traversable under
every profile and their presence on a route is reported rather than excluded.

**Shade: ship the cheap version, defer the real one.** Solar geometry is
straightforward to write and the obstacle grid already exists, but shadow length needs
building heights and OpenStreetMap has essentially none at these parks — every shadow
would be a guess dressed as geometry. Tree cover is the shade you can actually trust:
"within about 15 m of a `wood` ring" is one cheap pass over 34 rings at Kings Island
and 114 at Cedar Point, needs no clock, and honestly labelled captures most of the
real shade. When solar does arrive it belongs in its own module taking the sun vector
as an argument, so `lib/routing.js` keeps its no-clock promise.

**Precomputing the graph is declined.** It would add roughly 150 KB to Kings Island
and 250 KB to Cedar Point, and it is pure duplication — the renderer still needs the
same geometry, so you would ship it twice. Caching the built graph in IndexedDB keyed
on a hash of the map file gets the same result for zero bytes, and only if a real
phone measurement shows the idle-time build actually hurts.

**Coverage is now measured across all four venues.** `packages/venue-builder/lib/osm-tags.mjs` carries
the counts from 3,037 path and service ways between them — not from the Kings Island
probe alone. The headline numbers settle the profile question:

| Tag / flag | All four | Notes |
|---|---:|---|
| `highway=steps` | 112 | 110 at Fiesta Texas; Kings Island's two were the first sighting |
| `bridge` | 135 | with `layer` on 124 |
| `tunnel` | 36 | |
| `oneway` | 567 | read for queue detection, not yet carried on the graph |
| `access=no/private` | 220 | |
| `wheelchair` | 77 | all at Cedar Point; 76 of them `yes`, one `no` |
| `incline`, `indoor`, `conveying` | 0 | |
| `covered` | 28 | 0.9% — too thin for a shade profile |
| `surface` | 218 | 15.7% at Fiesta Texas, 0.3% at Cedar Point — wants a vocabulary, not a bit |

So the honest deliverable stands: carry the tags, ship a per-venue coverage counter in
`meta`, and make every profile's copy a function of that counter. **Wheelchair is not
offered at three of four parks** — not because the code refuses, but because 76 of 77
`wheelchair` tags are at Cedar Point and the single `no` is the whole signal against
112 flights of steps. Fiesta Texas is the steps park; Kings Island is the grade-
separation park. Profiles should be gated per venue from these counts, not from hope.

**Path attribute / routing profiles workstream — largely landed.** `meta.coverage` ships from the builder; `splitAtCrossings` skips different layers; snap exclusion and routing profiles (`default` / `no_steps` / `allow_restricted`) live in `routingProfiles.js` and are wired from the app. Residual: carry `oneway` on the graph if needed; wheelchair profile only where coverage exists.

**Historical note (do not treat as current debt):** Earlier drafts said layer-aware crossings and profiles were unbuilt; that is no longer true as of 2026-08.

**Still open in related GIS work:** entrance export coverage uneven across venues (KI/Fiesta thin); admin validation UI; vision/CV workers deferred.

### Workstream: stable identity

*Implemented. Keys ship in all four bundles; ledgers live under `data/venues/<id>.ids.json`.*

Two things assumed at the top of this document turned out to be wrong, and the plan is
better for it.

**The OpenStreetMap element id is the wrong primary key.** `buildPois` has no 1:1
relationship with OSM elements to begin with — the dedupe deliberately collapses a
track way, a station building and a name node into one place, and which element "wins"
depends on iteration order. `poisFromTrack`, `campPitches`, `overrides.add` and traced
features have no element at all. An OSM-keyed scheme covers perhaps 60% of rows and
needs a second scheme for the rest, which means two schemes, which means none. It is
also not as stable as it sounds: a mapper who deletes and redraws a way produces a new
`way/id` for the same physical coaster — exactly the edits-lost failure the guidance
warns about. Keep OSM ids as **provenance and as a matching tiebreaker**, not as
identity.

**The id rule is not duplicated across three files.** `lib/venue/store.js`,
`app/api/rides/catalog.js` and `server/index.mjs` all *import* `withIds` from
`lib/venue/ids.js`; the relative-import-with-extension style is deliberate and the
module header says why. That requirement is already met, and the job is to avoid
regressing it rather than to build it.

**The duplicate-name problem is far larger than "two Poltergeists."** Measured on the
shipped bundles: Cedar Point has 26 places called "Restrooms", 12 "Services", 11
"Parking", 8 "Dippin' Dots" — **78 rows in a name collision, 18% of the venue**, every
one of them currently addressed by a positionally-assigned suffix, and every one a
live address for a ride report, a favourite and a nav target.

**The scheme:** keep `slug(name)` when the name is unique, and `slug(name)-N` when it
is not — but make `N` *data* rather than a computation over array order. Write the key
into the bundle as `i`, and keep a committed, diffable
`data/venues/<id>.ids.json` ledger so the next rebuild has a memory. A rebuild then
matches in three passes: unique names take their slug outright, which settles 85–100%
of every venue with no possibility of drift; collision groups match against the ledger
by nearest-position with an OSM-id tiebreaker; anything unmatched takes the next number
never yet issued, and anything unclaimed is retired with a tombstone so its number is
never reissued.

**The migration costs nothing and touches no network.** Seeding the ledger from the
*current* `withIds` output reproduces, by definition, exactly the ids that are on
phones today — so the ledger is born agreeing with production and no live ride report
moves. `npm run venues:overrides` already re-applies overrides from disk without
Overpass, which is what makes this affordable.

**Name-keyed overrides stay.** Converting 196 hand-written entries to slugs would be a
downgrade: those files are read and edited against a park's published height chart,
where `"BATMAN The Ride"` is checkable and `batman-the-ride` is not. Id keys become an
*escape hatch* for the ambiguous cases. This is the title-separate-from-key rule doing
its job — the overrides file is the title side, the bundle is where the key lives.

**Two latent bugs this exposes.** `applyOverrides` uses a shallow `Object.assign`, so
an override supplying `h: { min: 48 }` would set `alone` and `max` to undefined; every
override on disk happens to write all three keys, so it has never bitten.
`overrides.drop` filters by name, so `drop: ["Entrance"]` at Cedar Point would silently
remove all five — the same duplicate-name bug as `rideEligibility`, in the build.

**And one piece of the brief to reject.** Entity-level tombstones are right; property-
level ones are not. A "deliberately absent" height rule would create a third state
alongside absent and zero that no UI can render, in an app whose whole discipline is
keeping those two distinguishable. If a height rule is wrong, the edit is `h: null`,
which already reads as "check at the ride."

### Workstream: links and the ontology manifest

Stable keys made the join *possible*; this workstream makes every other file use them
and declares, once, what each category *means*.

**The join is still a display string everywhere that matters.** `inventory()` matches
a claim to a record with `recordFor(claim.ride)`, which lowercases a name
(`attractions.mjs:307`). `publish()` looks up targets with
`byName.get(String(record.name).toLowerCase())` (`:341`). The sidecar's own `id` is
`{venue}-{slug(name)}` (`attractions.mjs:176`) — not the `i` that now ships on the
place. Evidence accumulates under a name; a mapper who recapitalises Maverick orphans
the record while the place keeps its key; and when two Poltergeists share a name the
pipeline patches both, which is what `applyOverrides` does on purpose but what a
*link* should not have to guess at.

Measured on disk today: **230 ride records, 246 evidence entries**, every one joined
to its place by `n` and nothing else. The attractions file header already says it sits
beside the bundle because the bundle is overwritten every rebuild — which is exactly
why the link cannot live in the bundle. It belongs in the sidecar, as a `place` field
holding the place's `i`, written on first match and kept across renames by the same
ledger pass that keeps `i` itself.

**Migrate in one direction, with a name fallback for one release.** On inventory,
resolve `claim.ride` → `poi.i` through the address book (`resolveOverride` already
knows how). Write `record.place = poi.i` and change `record.id` to equal `place` — the
venue prefix bought nothing once keys are unique inside a venue. On publish, look up
`byId.get(record.place)` first; keep the name path only while a sidecar row still
lacks `place`, then delete it. A test that every record's `place` resolves and that
no two records share one is the gate.

**Do not put evidence on the wire.** The sidecar stays in `data/venues/` and never
enters `public/venues/`. The phone reads fused coordinates and confidence bands that
cleared the publish floor — `e`, `out`, and eventually `h` from the heights sidecar —
not the 246 rows behind them. That is the same separation this file already enforces
for entrances, and extending it to rules does not change the rule.

**Entrances are not entities and must not get links.** `venue-ids.mjs` already says
why: an entrance is a claim *about* a ride, keyed by the ride's `i` plus `src.by`.
Giving `e[0]` its own `i` would invent a second thing the app never addresses and
would need tombstones for a coordinate that legitimately appears and disappears.
What an entrance carries is provenance on the parent — which is what `src.osm` is for
once two detectors read the same queue way.

**The ontology manifest is not a platform.** Foundry's value here is vocabulary:
interfaces over concrete types, and a single place that says what a category *is* so
the renderer, the router, the weather engine and the build pipeline stop each carrying
their own half-overlapping copy.

Today, `p.c === 'coaster' || p.c === 'ride'` is written independently in **ten**
files — `build-venue.mjs`, both attractions modules, `candidates.mjs`,
`venue-checklist.mjs`, `venue-io.mjs`, `venue-requests.mjs`, `PlaceList.jsx`,
`ParkMap.jsx`, `app/page.js`, and `test/unit.mjs`. `lib/weather.js` already has
three partial sets (`RIDE_CATEGORIES`, `SHELTERED_CATEGORIES`, `INERT_CATEGORIES`)
that disagree in edge cases with the ride test — a `show` is inert to heights but
not to weather. `packages/venue-builder/lib/osm-tags.mjs` ends its header with *"The vocabulary
matches lib/theme.js"* while `POI_RULES` and `CATEGORY_LABELS` are separate tables
that a new category must be edited in twice. The proposal's §11 verdict — *adding one
category touches five files* — was an undercount.

**One committed manifest, one runtime module.** Shape:

```json
{
  "categories": {
    "coaster": { "label": "Coasters", "interfaces": ["Locatable", "Rideable", "Queueable", "HeightChecked", "Reportable"] },
    "ride":    { "label": "Rides",    "interfaces": ["Locatable", "Rideable", "Queueable", "HeightChecked", "Reportable"] },
    "food":    { "label": "Food",     "interfaces": ["Locatable", "Sheltered"] },
    "show":    { "label": "Shows",    "interfaces": ["Locatable", "Schedulable"] },
    "gate":    { "label": "Gates",    "interfaces": ["Locatable", "Inert"] }
  },
  "interfaces": {
    "Locatable":     "has a coordinate the map can draw and the router can snap to",
    "Rideable":      "a height rule may apply; the filter and the report button care",
    "Queueable":     "may carry `e` — a queue entrance is a claim, not a row",
    "HeightChecked": "may carry `h`",
    "Reportable":    "ride status can be set and replicated",
    "Sheltered":     "weather treats as under cover by default",
    "Schedulable":   "opening hours would matter if they were ever read",
    "Inert":         "weather and status ignore it"
  }
}
```

`lib/ontology.js` imports the manifest and exports `implements(poi, 'Queueable')`,
`categoriesWith('Reportable')`, and the label/colour lookup that `lib/theme.js` keeps
today. The builder imports the same file for `POI_RULES` ordering — category first,
tag rules second — so adding `first_aid` as its own category is one manifest row and
one rule block, not five grep targets. The manifest is committed JSON; the module is
the only reader; the bundle carries only `c` on each place, as now.

**`Queueable` is not `Rideable`.** Kings Island ships **0 of 171** queue entrances;
Cedar Point ships dozens. Entrance-aware routing is already a Cedar Point feature, and
the interface split makes that a coverage fact rather than a silent assumption — a
venue checklist item: *N of M rideables carry `e`*.

**Base ⊕ edits gets written down here, not invented.** The overrides file is base
input; the bundle is base plus derived properties; the sidecars are base plus
accumulated claims. The rule the plan needs stated: **a tombstoned `i` survives a
rebuild; a derived property is recomputed and wins over base; a hand override wins over
derived on the fields it touches.** That is what `applyOverrides` already does
informally and what made the three-writer entrance fight painful when it was not
written anywhere. Put it in the manifest header so the next pipeline stage cannot
re-litigate it.

**Ordering.** After stable identity — done. Before the inventory joins the build,
because the inventory is the first consumer that must stop joining on names. Before
eligibility v2's heights sidecar, which will link rules to places the same way. Before
scenarios, because ride reports and favourites already address `i` and a plan step that
says "Orion" should say `orion`.

**Reject.** Shipping the evidence table to the phone "for transparency" — it cannot be
service-worker precached at this size and it exposes source weights a guest did not
ask for. Generating the manifest from `POI_RULES` at build time — the manifest is the
contract, the rules are one implementation of it, and generated contracts are not
contracts. Entity-level links for features inside a ride (`queue_entrance` as its own
row) — features stay inside the attraction record, keyed by the parent's `place`.

### Workstream: eligibility

**Both encoding holes share one root cause.** `min: 0` is a magic number meaning "the
park states there is no floor", but that distinction exists for `min` alone — `alone`
and `max` have no way to say "the park states there is no ceiling". That is why Cedar
Point spells "no floor" a second way as `{min: null, alone: null, max: 54}`, and why
Buccaneer Cove's stated 48" ceiling is unrepresentable. So v2's central move is not
adding fields; it is one uniform three-state on every dimension: absent means nobody
recorded it, `"none"` means the park states there is no such limit, a number is the
threshold. `"none"` as an explicit string rather than by inverting `null`, because a
reader that does not understand it cannot silently read it as zero.

**Big Kahuna's Wave Pool is not a contradiction after all.** `alone: 48` with a note
saying 42 looked like one source disagreeing with another. It is two rules at two
thresholds — a companion at 48", a flotation device at 42" — and the flat triple could
hold only one, so the other went to prose. v2 holds both. Genuine source disagreement
is a different thing and lives in the sidecar.

**`advisory` is the honesty discipline made mechanical.** Buccaneer Cove's "built for
children under 48\"" is a stated intent, not an enforced rule, so it must never
produce `toobig`. A 52" teenager gets a pass with a caveat, because the park did not
say they may not ride — it said who it was built for.

**A correction to what this document said earlier.** The name-keyed `rideEligibility`
map is a latent hazard, not a live bug. `applyOverrides` deliberately patches *every*
POI sharing a name, with a comment saying so, added for exactly this reason — so
Fiesta Texas's two Poltergeists both carry `{min: 54}` and both get the same verdict.
Verified in the bundle. The live duplicate-name bug is next door: `PlaceList.jsx:218`
opens **both** rows and `ParkMap.jsx:744` pins **both** markers, including the wrong
one of Cedar Point's 26 "Restrooms".

**Heights must not go on the wire.** `publicSnapshot` returns the members map
wholesale and there is no field-level redaction anywhere in the model, so anything
added to `createMember` reaches every peer — and the host is whichever phone won an
election, in a party joinable by a six-character code. `patch-member` already
allowlists name, avatar and status; adding height means widening a list that exists to
stop exactly this. Nothing needs it: every consumer of a height is local, and the one
genuinely shared question — can all five of us ride this together — is answerable from
verdicts alone. Profiles live in `localStorage` beside the identity blob, and
`createMember` gains nothing.

**Per-rule provenance goes in a sidecar**, `data/venues/<id>.heights.json`, parallel
to the attractions sidecar and for the same reason its header already gives. Of
`evidence.mjs`, `staleness()` transfers verbatim and is the best fit — rules change
between seasons, and flagging without decaying is exactly right for "the 2026 chart is
old, not wrong". The bands and publish floor transfer. `fuse()` does not, because half
of it is distance arithmetic, but its reasoning copies into a scalar equivalent.

**One thing inverts and must be handled.** A coordinate that fails the publish floor is
dropped, which loses a pin. A *height rule* that is dropped makes the app say "no
rule", which is the permissive answer — the safety bug. So a below-floor height rule
publishes at low confidence marked "reported, not confirmed", never dropped.

**And a tension needing a human call, not a script's.** Cedar Point's overrides state
the tie-break policy out loud: where charts disagreed, the lower floor was taken, so
the filter errs towards letting a child queue. That is deliberate and guest-friendly,
and it is the opposite of safety-conservative. Under `evidence.mjs`'s own anchor rule
The Bat's 54" from the park's own page outranks the 48" the app publishes. That should
be changed or explicitly justified, not carried through the migration unexamined.

### Workstream: scenarios, undo and the action log

**Scenarios should be local to one phone.** Replicating them is the wrong call for
four reasons, strongest first. Payload: `publicSnapshot` rides on **every VICTORY
frame**, and a contested election re-asserts roughly every 1.5 s — so a shared plan is
several hundred bytes on the wire precisely when the party is least healthy, on a
phone whose radio is already failing. Authorization: the reducer's rule is that a patch
applies to `from`, with two exceptions justified as "crowd data about a shared object,
not a claim about a person". A shared plan is neither — it is a claim about the
party's future, owned by nobody. Conflict: two phones reordering one list is
collaborative editing, and last-write-wins on an ordered list eats an insert silently.
And Foundry's own scenario is a per-user sandbox; replicating it is the thing Foundry
specifically does not do.

Most of the value survives, because **the merge is party-wide even when the plan is
not.** Merging emits ordinary commands, so the party sees the meet-up move and targets
set — real, shared, at one version bump.

**Atomicity is free.** `withOps` already bumps the version by exactly one per call and
clients hard-require `version + 1`, so a merge that produces one call with N ops is
already atomic on the wire and already replicates correctly.

**Broken steps are shown, never dropped.** A step whose ride has been reported down
stays in place, struck through with the reason, excluded from the overlay and the
merge, and offering *Keep it anyway* — because the app's own status vocabulary is
hedged, and a family who can see the ride running from where they stand is better
informed than the forecast.

**Undo is not the scenario.** A scenario holds actions that have not happened; undo
concerns actions that have. If undo were "pop the scenario" then merging a plan would
clear your undo, and undoing something done by hand outside a plan would be
impossible. Undo instead reads the log and emits a *new forward command* that inverts
the effect — the reducer has no reverse, and building one would mean keeping every
prior state. Its limits are real and should be stated in the UI: a party-wide action
someone else has since touched cannot be undone, a report past its TTL cannot, and
side effects never are. You cannot un-buzz a phone.

**The log belongs in IndexedDB, not localStorage.** The offline outbox already owns
that quota and degrades silently on overflow, so a second writer there could start
dropping *outbound party traffic* — a correctness bug, not a storage inconvenience.
IndexedDB is already in the codebase for push keys. Append-only is enforced
structurally: the module exports no update, and `add()` throws on a duplicate key.

**What context capture can and cannot support.** It yields genuinely new information —
how long the party's belief survived before someone corrected it — and its first and
best customer is the app's own constants, because `RIDE_STALE_AFTER_MS` is currently
30 minutes chosen by hand. What it cannot support is any rate. One family produces
maybe 20–40 observations a day across 60 rides, so most rides sit at n = 0 or 1
forever; the sample is a walk, not a random draw; and reporting is negatively biased
because people tap when something is surprising. **Show counts, never rates, always
show n, and below n = 5 show the raw observations instead of a summary.**

**Delete `avatar` from the wire before adding anything.** It is populated by nothing,
and an avatar is a data URL — precisely the payload that must never land in a snapshot
during a VICTORY storm. Initials already exist in the tab bar. Similarly delete
`shareLocationHistory`, which is worse than dead: it implies location history could be
shared, and the code says flatly that it is never kept.

### Workstream: the party gaps

**Add no assigned roles.** The decisive argument is not taste — **the crypto cannot
back a role.** The party key is one symmetric key everybody holds, `from` is a
plaintext field of the inner frame, and `reduce` trusts it unconditionally. Anyone
with the key can seal a frame claiming to be anybody, so a host-enforced capability
check constrains phones running this build and nothing else. Today's single rule is
honest precisely because it is *not* a security claim: self-ownership is a data-model
invariant that stops two people fighting over one record. Second: host migration is
designed to be invisible, and attaching powers to `host` turns an automatic failover
into a power transfer nobody consented to, at the worst possible moment.

The concept's four roles are really three separate wants wearing one word — who can
end the party (already answered by the code and the key window), a fact about a person
for heights and supervision (local, not party state), and "I'd rather not give this
person everything" (a sharing control, not a role). None is a permission.

**Subgroups: membership is a field on the member, not a list on the group.** That one
choice makes the conflict question vanish — `reduce` always patches `from`, so nobody
can reassign anybody. You join a group; you are never put in one. A members array
would be a set-CRDT problem in a reducer that is last-writer-wins on owned fields.

**Split-party is a subgroup plus one scheduled rejoin**, not a third concept. All that
is missing is time: one optional `at` on the existing `meet`. Deliberately one meet,
not one per group — a split party has *one* rejoin point, and that is what makes it a
rejoin. The payoff is the countdown, which flips to "leave now — 12 min walk" and is
impossible without real graph distances.

**Reunification: fairness first, total walking as tiebreak.** Minimising total walking
picks a point beside the largest cluster and sends the one straggler on a fourteen-
minute march — and that straggler is reliably the person with the pushchair, because
that is *why* they are the straggler. Candidates are named, findable, standing-room
places (71 of Kings Island's 171 POIs), pruned to the 12 nearest before routing, which
makes the matrix 96 queries and about 170 ms, once, on a tap.

Two things that would quietly ruin it. `findRoute` silently falls back to crow-flies
when snapping fails or the detour exceeds its sanity guard, so **any candidate where
any member's leg came back `direct` must be disqualified** — otherwise the straight
line the whole exercise exists to eliminate walks back in through the cost function.
And **never recompute automatically: a meeting point that moves is not a meeting
point.** Navigate-to-member re-resolves live because a person walks; a rendezvous must
not.

**Coarsening happens at capture time, on the sharing phone.** `publicSnapshot` cannot
be made per-recipient without breaking the version contract outright — two replicas at
the same version would hold different data. A host-side filter would also have to
travel to the next host through the very channel it is meant to be filtering. And
capture-time is the only version that is *true*: once a coarse fix leaves the phone,
the exact one was never on the wire and no replay or future feature can recover it.
Pleasingly, coarsening before the broadcast gate means the existing 12 m threshold
suppresses grid flapping for free.

**Pause must be visible.** A dot that goes stale reads as *her phone died*, which is
scarier than *she stopped sharing* and produces the wrong family response.

**Do not enforce a guardian rule.** Enforcement means refusing an action, and the only
relevant actions are leaving the party and walking away — the app can refuse neither.
Physical reality violates the rule constantly: a flat phone, a queue building with no
signal, a 45-minute eviction while standing next to the child. Worst, any guardian
alert keyed on staleness repeats the quiet-notification mistake exactly, because
staleness is what a queue building produces, and that lesson is already written into
this codebase. Build instead a local one-directional watch, fired on **graph walking
distance** — *"Mia is 6 minutes' walk away and getting further"* is a fact about the
world; *"Mia's phone hasn't spoken in 6 minutes"* is a fact about a building.

**Heights: not on the wire, and not even the verdict.** This workstream and the
eligibility one reached the same conclusion independently, and this one goes further —
a per-member set of rideable ids is a *reconstruction* of the height, because
intersecting it against the venue's rules recovers the inches to within a tier. If a
family wants a group answer, the phone holding the profiles computes it and somebody
reads it out.

**And a migration hazard worth naming.** `members`, `rides` and `settings` are
re-copied by hand in **four** separate places across the runtime, host service and
client. Any new collection must be added to all four, and a missed one loses subgroups
silently at the exact moment the party is already repairing itself. Better to replace
the four hand-written spreads with one `adoptSnapshot` helper so the next collection
cannot be forgotten.

**One measurement worth recording:** Kings Island's places file carries **no queue
entrances at all** — 0 of 171. The entrance-aware routing added recently is effectively
a Cedar Point feature, which is a second reason to keep rides out of the reunification
candidate set.

## Deliberately not planned

Wait-time prediction, crowd modelling, food and menu data, computer-vision detection,
and autonomous research agents writing to the database. Three of these have no data
source that does not require a server. Computer vision is a stated non-goal in
`scripts/attractions.mjs`, which is candid about why: those sources are real and each
one is a project. The door is already open — `aerial`, `guest_photo` and `video`
carry weights in the evidence table — and nothing needs to be built until somebody
walks through it.

## Appendix: external open-source adapters (2026)

A dependency matrix now evaluates ~20 open-source projects (LangGraph, Playwright,
OSM tooling, Valhalla, MapLibre, Tippecanoe, Mapillary, YOLO, SAM 2, ParksAPI, etc.)
for **wrap** integration into the builder without forking them into this monorepo or
adding server dependencies to the phone runtime.

- [universal-venue-builder-dependency-matrix.md](./universal-venue-builder-dependency-matrix.md)
- [universal-venue-builder-architecture.md](./universal-venue-builder-architecture.md)
- Code registry: `packages/venue-builder/lib/adapters/registry.mjs`
- CLI: `npm run venues:adapters`

Verdict unchanged for phone runtime: PostGIS, Valhalla-on-phone, and live ops feeds
stay rejected. Builder-side wrappers and the Venue Evidence Graph (`evidence-graph.mjs`)
extend the evidence engine without changing offline-first constraints.
