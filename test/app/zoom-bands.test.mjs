#!/usr/bin/env node
/* Zoom bands (ADR-0019 clause 1, ADR-0021 clause 2). The band table is the one
   place the builder and the phone agree on what a band is — see
   docs/train-h-seams.md seam 1. Expected values here come from the ADR and from
   the venue bounds in apps/party-tracker/public/venues, never from re-running
   the module's own arithmetic. */
import assert from 'node:assert/strict';
import { BANDS, bandForZoom, bandPixels, bandResolution, parentOf } from '../../packages/shared/zoomBands.js';

// The table is ordered coarsest first, and names the three bands ADR-0019 ships.
assert.deepEqual(
  BANDS.map((b) => b.id),
  ['overview', 'mid', 'close'],
);

// Playbook row 5's placeholder upscales from the next coarser band, so every
// band except the coarsest has a parent to fall back to.
assert.equal(parentOf('close'), 'mid');
assert.equal(parentOf('mid'), 'overview');
assert.equal(parentOf('overview'), null);

// An unknown band is a caller bug, not a silent null.
assert.throws(() => parentOf('nope'), /unknown band/i);

// Resolution is the table, in metres per pixel (ADR-0021 clause 2).
assert.equal(bandResolution('overview'), 2.4);
assert.equal(bandResolution('mid'), 0.6);
assert.equal(bandResolution('close'), 0.15);

// A worked example, chosen so the arithmetic is checkable by hand: a World
// spanning 1500 m east-west by 1200 m north-south.
const span = { spanXMetres: 1500, spanYMetres: 1200 };
assert.deepEqual(bandPixels('overview', span), { width: 625, height: 500 });
assert.deepEqual(bandPixels('mid', span), { width: 2500, height: 2000 });
assert.deepEqual(bandPixels('close', span), { width: 10000, height: 8000 });

// A World whose span is NOT a round multiple of any band resolution. Rounding
// each band independently would break the chain here -- 1000 / 2.4 rounds to
// 417 and 1000 / 0.6 rounds to 1667, but 417 * 4 is 1668 -- so the finer bands
// are derived from the coarsest instead of rounded on their own.
const awkward = { spanXMetres: 1000, spanYMetres: 1000 };
assert.deepEqual(bandPixels('overview', awkward), { width: 417, height: 417 });
assert.deepEqual(bandPixels('mid', awkward), { width: 1668, height: 1668 });
assert.deepEqual(bandPixels('close', awkward), { width: 6672, height: 6672 });

// The power-of-two chain, stated as the invariant it is: each band is exactly
// 4x its parent in each dimension, for any World. The tiler's parent-band
// placeholder upscales pixel-for-pixel, so "about 4x" would not do.
for (const world of [span, awkward]) {
  for (const band of BANDS) {
    const parent = parentOf(band.id);
    if (!parent) continue;
    const here = bandPixels(band.id, world);
    const up = bandPixels(parent, world);
    assert.equal(here.width, up.width * 4, `${band.id} width is 4x ${parent}`);
    assert.equal(here.height, up.height * 4, `${band.id} height is 4x ${parent}`);
  }
}

// Band selection follows mip selection: take the coarsest band that is not
// coarser than the screen, so a band is never magnified while a sharper one
// would have fit. MapLibre zoom counts 512 px tiles, so the ground resolution
// at zoom z and latitude f is 156543.034 * cos(f) / 2^(z+1) metres per pixel.
//
// At the equator that gives, to four figures:
//   z 14 -> 4.777 m/px   coarser than overview's 2.4, so overview
//   z 16 -> 1.194 m/px   finer than overview, coarser than mid's 0.6, so mid
//   z 18 -> 0.2986 m/px  finer than mid, coarser than close's 0.15, so close
//   z 22 -> 0.01866 m/px finer than every band: clamp to close and magnify
assert.equal(bandForZoom(14, { latitude: 0 }), 'overview');
assert.equal(bandForZoom(16, { latitude: 0 }), 'mid');
assert.equal(bandForZoom(18, { latitude: 0 }), 'close');
assert.equal(bandForZoom(22, { latitude: 0 }), 'close');

// Latitude is not decoration: Mercator pixels cover less ground away from the
// equator, so the same zoom selects a finer band. At 60 degrees cos is exactly
// 0.5, so z 14 halves to 2.389 m/px -- just finer than overview, so mid.
assert.equal(bandForZoom(14, { latitude: 60 }), 'mid');

// Latitude defaults to the equator rather than throwing, so a caller that has
// not wired up a camera position still gets a usable band.
assert.equal(bandForZoom(14), 'overview');

console.log('zoom-bands: ok');
