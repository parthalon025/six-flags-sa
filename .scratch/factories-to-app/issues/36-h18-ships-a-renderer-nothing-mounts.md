# 36: h18 reads BUILT, but MapLibre is never mounted

**What to build:** Reconcile slice `h18` with the app. Either mount the MapLibre renderer it claims shipped, or correct the record and the probe.

**Blocked by:** None

**Status:** resolved

## Evidence

Slice **h18** — *"MapLibre becomes the shipped renderer; the SVG map retires"* — reads **BUILT** in
`node scripts/train-plan.mjs status`. Its probe (`scripts/lib/train-plan.mjs`) asserts three things:

```js
t.has('apps/party-tracker/components/ParkMapGl.jsx')
&& !t.has('apps/party-tracker/components/ParkMapSvg.jsx')
&& !/PARK_MAP_RENDERERS\s*=\s*\[\s*'svg'/.test(t.read('apps/party-tracker/lib/mapLibreConfigured.js'))
```

All three hold. None of them asks whether anything renders it. From source:

| Check | Result |
|---|---|
| `apps/party-tracker/app/page.js:5` | imports **`ParkMap`** (the SVG renderer) and renders it at line 2948 |
| `ParkMapGl` imported anywhere in app source | **no** — the only other mention is prose inside a comment in `lib/parkMapView.js:214` |
| `park-map-gl` testid in the built server output | **absent** |
| `PARK_MAP_RENDERERS` | `Object.freeze(['gl'])`, and `parkMapRenderer()` always returns `'gl'` |

So the build declares `gl` as the only renderer, while the page mounts the SVG one and
`ParkMapGl.jsx` is dead code that never reaches a bundle.

## Why this matters

This is the inverse of ticket 22 (`h11`), and worse. `h11`'s stale probe **under**-reported
finished work — it wasted a session. `h18` reports work as **done that the app does not do**: the
repo's record says MapLibre ships, and the guest gets the SVG map.

Everything that reads the train plan inherits the error. `.scratch/factories-to-app/map.md`
records Trains H/I as built and says *do not restart*; `h18`'s own source comment argues at length
that a probe reporting `h11` built while `parkMapRenderer()` still answered `'svg'` would be
"the plan telling the next session a lie" — and then h18 does the same thing one slice over, by
checking for the renderer's **existence** rather than its **use**.

It also silently defeated the UI suites. `hydrated()` in `test/app/browser.mjs` accepts either a
MapLibre canvas or SVG markers. The canvas never appears because nothing mounts it, so every
functional suite depended on the SVG half — which was itself broken by a stale `circle.` selector
(fixed alongside this). Two independent faults, each masking the other.

## Acceptance

Decide first, then do one of:

- **If MapLibre is meant to ship:** `app/page.js` mounts it, `[data-testid="park-map-gl"]` appears
  in the built output, and a check asserts the shipped page renders the renderer
  `parkMapRenderer()` names — not merely that a file exists.
- **If the SVG renderer is what ships:** correct `h18`'s title and status, and make
  `PARK_MAP_RENDERERS` describe reality rather than an intention.

In both cases:

- [ ] `h18`'s probe asserts **use**, not existence — it must go false when nothing mounts the
      renderer it names
- [ ] `ParkMapGl.jsx` is either mounted or removed; dead code must not satisfy a slice probe
- [ ] `npm run test:pre-merge-vertical` green

## Notes

Do not close this by deleting `ParkMapGl.jsx` to make the record tidy — that discards the port
`h11` did and answers the question by throwing away the work. The owner decides which renderer
ships; this ticket only requires that the plan and the app agree.

## Escalation — this is not a bookkeeping slip (2026-08-28)

Fixing `hydrated()`'s stale selector let the suites get past the 40-second hang, and what they
reached settles it. `smoke` now reports **15 passed, 5 failed**, and every one of the five is a
MapLibre assertion:

```
FAIL park geometry is drawn -> map not drawn (no MapLibre canvas)
FAIL the camera follows this phone and snaps back after a free look
       -> waiting for locator('[data-testid="park-map-gl"]')
FAIL park-wide rest shows Zone names and ride names -> timed out waiting for map ready
FAIL wearing Pixel tycoon keeps the MapLibre map (OSM until a bake exists)
FAIL wearing Watercolor quest draws the baked world image under the overlay
       -> waiting for '[data-testid="park-map-gl"][data-baked-world$="watercolor-quest.world.png"]'
```

**`test/app/functional.mjs` contains 19 references to `park-map-gl`.** Nineteen assertions were
written against a renderer `app/page.js` has never imported — `git log -S ParkMapGl -- app/page.js`
returns nothing, in any commit.

So the hydration bug was not merely hiding itself. It was **masking the entire MapLibre
expectation**: every suite hung before reaching an assertion that would have said the shipped page
has no MapLibre map. Two defects stacked, and the outer one kept the inner one invisible for as
long as both existed.

The app is not broken for guests — the SVG map draws Zones, Places and markers. What is broken is
the agreement between three things that are supposed to describe each other: the train plan says
MapLibre ships, the test suite asserts MapLibre ships, and the page renders `ParkMap`.

### Why this needs a human

The two branches are large and opposite, and neither is an agent's call:

1. **Mount MapLibre** — `app/page.js` renders `ParkMapGl`, and the 19 assertions start passing.
   This is the shipped guest map changing engine; ADR-0019 and ADR-0021's band work assume it.
2. **Retract h18** — the SVG renderer is what ships, `PARK_MAP_RENDERERS` and the slice title are
   corrected, and the 19 assertions are rewritten against the renderer that actually draws.

Until one is chosen, `npm run test:validate-ui:changed` cannot pass — **on this branch or on
`origin/main`**, which is equally affected since no app source involved here differs between them.

## Correction — already fixed on main (2026-08-28)

**This ticket was right about the symptom and wrong about the cause, and the escalation was
premature.** Merging `origin/main` into the branch settles it.

`apps/party-tracker/components/ParkMap.jsx:68` on current main:

```js
const ParkMapGl = dynamic(() => import('./ParkMapGl'), { ssr: false });
```

rendered at line 242. **MapLibre is mounted.** It arrives through a dynamic import inside
`ParkMap.jsx` rather than a static import in `app/page.js`, which is why
`git log -S ParkMapGl -- app/page.js` came back empty and why grepping `page.js` for the import
found nothing. I read that absence as "never mounted" when it only meant "not mounted *there*".

The real history is in `b041666` — **"fix(app): restore h11 MapLibre ParkMap after zone-tone merge
regression (#729)"** — followed by `b7d59ee` (#730) cleaning up `mapWrap`, zone tones and fog
scope. A merge regression had dropped the MapLibre mount; both fixes landed on `main` **after this
branch's base commit** `3d97dc2`. Everything observed here — no `park-map-gl` on the page, no
canvas, 19 assertions failing — was this branch running without those fixes.

So **h18 is not satisfied by a renderer nothing mounts**, and the train plan, the test suite and
the page do agree. What actually happened is narrower and less alarming: a regression broke the
mount, it was caught, and it was fixed on main while this branch was in flight.

What survives from this ticket:

- The `hydrated()` selector staleness is **genuine and independent** — `circle.poiMarker` could
  never match a `<g class="poiMarker">` regardless of which renderer mounts. That fix stands on its
  own merits and is proven discriminating.
- The lesson worth keeping: a dynamic import is invisible to the grep that finds a static one, and
  "no import in the obvious place" is not evidence of "never mounted".
