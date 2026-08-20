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

**Deletion test.** Delete this module and the band table reappears in the baker, the tiler, the
map view, and the certification rows — four copies that drift.

---

## 2. Map view — `apps/party-tracker/lib/mapView.js` + one component

**The seam is already real.** Two adapters exist today: `ParkMap.jsx` draws the world as SVG, and
`DisplayMap.jsx` draws it through MapLibre behind `mapLibreDisplayEnabled()` (the #527 spike).
That is the two-adapters test passing on its own, before Train H adds anything. ADR-0013 item 4's
real-time PBR tier is the third adapter this seam is being shaped for.

**Interface.** What a caller must know, and no more:

- `mount(container, { venue, skin, palette })` → a view handle.
- `setCamera({ center, zoom, pitch, bearing })` and an eased variant.
- `setOverlay(model)` — party dots, route, quest nodes as *data*, never draw calls.
- `hitTest(point)` → the Place at a screen point, or null.
- `destroy()`.

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

Seam 1 is built and tested (`test/app/zoom-bands.test.mjs`). Seams 2 and 3 are designed here and
not yet implemented — they are the next slices of #563.
