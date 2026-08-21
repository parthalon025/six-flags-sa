# Train H seams

The design pass #563 asks for before code: where Train H's **modules** sit, what each
**interface** hides, and which **seams** are real. Not an ADR — the decisions live in
[ADR-0019](./adr/0019-zoomable-worlds.md) and [ADR-0021](./adr/0021-zoomable-worlds-revised.md);
this note only says what shape the code takes.

Vocabulary is the deep-module vocabulary: a module is deep when a lot of behaviour sits behind a
small interface. A seam is real when two adapters actually exist; one adapter is a hypothetical.

---

## 1. Zoom bands as data — `packages/shared/zoomBands.js`

**The seam.** Both factories and the phone need the same answer to "which band, at what
resolution, with what parent." The builder needs it to bake and to cut tiles; the app needs it to
pick a raster source and to know what to upscale from when a tile has not arrived. One table, two
consumers — that is the leverage, and it is why this is `shared` rather than a constant in either.

**Interface.** Data plus pure functions, no I/O:

- `BANDS` — the ordered band table, coarsest first.
- `bandResolution(bandId)` → metres of ground per baked pixel.
- `bandPixels(bandId, { spanXMetres, spanYMetres })` → the bake's pixel dimensions.
- `bandForZoom(zoom, { latitude })` → the band a camera zoom selects.
- `parentOf(bandId)` → the band to upscale from, or `null` at the coarsest.

**Depth.** Behind five names: the power-of-two chain, the parent-fallback order that
playbook row 5's placeholder depends on, mip-style band selection, and the web-mercator
zoom↔resolution conversion (including that MapLibre's zoom counts 512 px tiles, so its zoom `z`
has the density of slippy `z + 1` — an easy thing to get wrong in four separate places).

**What the absolute-GSD decision bought.** ADR-0021 clause 2 fixes resolution rather than pixel
dimensions, so nothing here needs the venue's cell size: `bandResolution` is the table, and
`cellMetres` never crosses the seam. Under a px/cell table every one of these signatures would
have carried it. Clause 3's alignment budget likewise needs no column — "≤ 1 px at that band" is
`bandResolution(id)`, so the budget is derived rather than stored.

**Two rules the interface enforces rather than documents.** Only the coarsest band rounds; finer
bands are derived from it, so `bandPixels(child)` is *exactly* four times `bandPixels(parent)` for
every World. Rounding each band independently drifts by a pixel on any span that is not a round
multiple of the resolution, and the tiler's placeholder upscales pixel-for-pixel, so a pixel of
drift is a visible seam. And the band boundaries move with latitude — Mercator pixels cover less
ground away from the equator — so ADR-0021 clause 4's "the pitch ease must not overlap a band
boundary" cannot be a hardcoded zoom range in the camera config. Seam 2 has to derive it from
`bandForZoom` at the World's own latitude.

**Deletion test.** Delete this module and the band table reappears in the baker, the tiler, the
map view, and the certification rows — four copies that drift.

**No adapters yet.** Nothing outside its own test imports this module: seams 2 and 3 are its
consumers and neither is built. That makes it a table without a caller for now, which is worth
naming — it is only defensible because every value is fixed by an accepted ADR rather than
invented here, and because the whole interface is exercised through its own tests. It should not
grow any surface a caller has not asked for before those seams land.

---

## 2. Map view — `apps/party-tracker/lib/mapView.js` + one component

**The seam is already real.** Two adapters exist today: `ParkMap.jsx` draws the world as SVG, and
`DisplayMap.jsx` draws it through MapLibre behind `mapLibreDisplayEnabled()` (the #527 spike).
That is the two-adapters test passing on its own, before Train H adds anything. ADR-0013 item 4's
real-time PBR tier is the third adapter this seam is being shaped for.

**Interface.** What a caller must know, and no more:

- `mountMapView(container, { renderer, world, skin, palette, places, camera, available, maxPitch })`
  → a view handle.
- `setCamera({ center, zoom, bearing })` and `easeCamera(camera, { durationMs })`.
- `setAvailableBands(ids)` — what the device holds, as the cache learns it.
- `setOverlay(model)` — party dots, route, quest nodes as *data*, never draw calls.
- `hitTest(point)` → the Place at a screen point, or null.
- `state()` → the last camera and band plan, for a HUD or a perf trace.
- `destroy()`.

**Pitch is not in that list, deliberately.** ADR-0019 clause 2 makes pitch a function of zoom and
ADR-0021 clause 4 stages that ease clear of every band handoff, so a caller that could set pitch
per frame could land a tilt and a restyle in the same instant — the one thing clause 4 exists to
prevent. The Skin's declared camera feel enters at mount instead, as `maxPitch`, which is where a
per-Skin trait belongs.

**What crosses to the renderer**, and nothing else: the World and Skin, the camera with its pitch
already derived, the band plan (`primary`, `placeholder`, `primaryReady`, `draw` bottom-to-top),
Places as frozen positions, and a normalised Overlay. A renderer is asked for one thing back —
`pick(point)` → an id — and the Place itself is looked up this side of the seam, so a renderer can
never hand a caller a Place the venue has not got.

**The renderer is also where camera moves come from.** Gestures happen inside it, and a caller
hands one straight back through `setCamera`. That would echo forever, so a camera equal to the one
already held is not a move; pitch is excluded from that comparison precisely because it is derived,
which is what makes the round trip settle.

**Depth.** Everything ADR-0019 clauses 3–4 converge lives behind those five: which renderer draws,
raster band sources and their crossfade, the pitch ease and its staging off band boundaries
(ADR-0021 clause 4), symbol collision and time-based fade, gesture handling, and projection.

**Why the overlay crosses as data.** ADR-0021 clause 1 says the paint carries no fact the Truth
tier does not have. If the overlay crossed this seam as draw calls, the renderer would be deciding
what a Member's dot *means*; as data, the view only decides how it looks. It also keeps the
alignment rule enforceable — the overlay is drawn from Truth, never snapped to art
(ADR-0021 clause 3).

**Retirement, not deletion.** The SVG adapter stays behind this interface until the MapLibre one
passes the gate. That is the escape hatch, and it costs nothing extra because the seam has to
exist anyway.

---

## 3. Tiler — one orchestrator export in `packages/venue-builder`

**The seam.** The bake produces a PNG per band; delivery needs a raster PMTiles pyramid. Between
them sits a deterministic transform with a lot of machinery and almost nothing a caller decides.

**Interface.** One export:

- `buildPyramid({ id, bandId, bakePng, outDir, cellMetres })` → written files plus the manifest
  rows that pin them.

**Depth.** The sharp resize chain, tile cutting on MapLibre's 512 px convention, WebP encoding
(playbook row 13), PMTiles assembly, and the byte-identity that certification asserts.

**One adapter, deliberately.** There is no second tiler and none is planned, so this is a
hypothetical seam by the two-adapter rule — it earns its place as a *module* (locality: the
determinism rules live in one file) rather than as a swap point. If a second ever appears, the
interface is already the right shape.

---

## Status

Seam 1 is built and tested (`test/app/zoom-bands.test.mjs`), and now has callers: the band chooser
(`apps/party-tracker/lib/bandPlan.js`) and seam 2 both read the table.

Seam 2 is built — `apps/party-tracker/lib/mapView.js`, tested through a recording stand-in renderer
in `test/app/map-view.test.mjs`, with `apps/party-tracker/lib/mapViewMaplibre.js` as the MapLibre
adapter and `components/BandedWorldMap.jsx` as its first caller. The SVG map (`ParkMap.jsx`) has not
been ported behind it yet; that is the retirement slice, and until it happens the second adapter is
the design's, not the code's.

Seam 3 is designed here and not yet implemented.
