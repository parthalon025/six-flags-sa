# 34: h18 reads BUILT, but MapLibre is never mounted

**What to build:** Reconcile slice `h18` with the app. Either mount the MapLibre renderer it claims shipped, or correct the record and the probe.

**Blocked by:** None

**Status:** ready-for-agent

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
