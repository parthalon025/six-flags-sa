/**
 * NAIP — USDA aerial imagery (~0.6 m), fetched from Microsoft Planetary
 * Computer. https://planetarycomputer.microsoft.com/dataset/naip
 *
 * Access path is settled by ADR-0021 clause 9: STAC search against Planetary
 * Computer, asset read with an anonymous short-lived SAS token — NOT the AWS
 * Open Data NAIP buckets, which are Requester-Pays with no anonymous path, so
 * they need real credentials and cost money. ADR-0020 clause 2 makes NAIP a
 * derivation-licensed source: US federal public domain, credit requested
 * (USDA FPAC-BC-GEO), commercial derivation fine.
 *
 * What this adapter is: the fetch-and-cache half. It finds the right NAIP
 * tile for a venue's bbox, reads exactly that venue's pixel window out of the
 * remote COG, and writes the ADR-0020 clause 1 provenance row — source tile,
 * capture date, sha256, licence class. Extraction (trees, surfaces, water
 * edges) is a later lane and does not live here.
 *
 * Two traps this file is shaped around:
 *
 * 1. `readRasters({ bbox })`. Never. `lib/adapters/cog.mjs` and
 *    `esa-worldcover.mjs` paid for this one: geotiff resolves a bbox against
 *    the source's full pixel grid and fans one small request into hundreds of
 *    internal tile fetches that die under this environment's connection
 *    limits, while one large range request against the same file is fine.
 *    Compute the window in pixels and pass `{ window }`.
 *
 * 2. Degrees are not the COG's coordinates. A NAIP quarter-quad is a square
 *    in UTM metres, so `image.getOrigin()`/`getResolution()` are eastings and
 *    northings and the tile's WGS84 footprint is a *rotated* quadrilateral —
 *    up to ~2 degrees of meridian convergence in the middle of a zone. This
 *    repo has no projection library, and does not need one: the STAC item
 *    carries the footprint in WGS84 *and* the pixel shape, which is three
 *    corner correspondences — enough to solve the affine from degrees to
 *    pixels exactly. Interpolating across the item's axis-aligned *bounding
 *    box* instead throws the rotation away and lands hundreds of metres off.
 *    The affine is not the true curved transform; over one ~7 km quad the
 *    residual from convergence varying across the tile is a pixel or two, so
 *    the window is padded and the read over-covers rather than clips.
 */

import { createHash } from 'node:crypto';
import { fromUrl } from 'geotiff';
import { cachePath, readCache, writeCache, UA } from './_cache.mjs';

export const ID = 'naip-planetary';
export const LICENSE = 'public-domain';
export const ATTRIBUTION = 'USDA FPAC-BC-GEO NAIP via Microsoft Planetary Computer';
export const COLLECTION = 'naip';
export const STAC_SEARCH = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
export const SAS_TOKEN_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/naip';

/** Pixels of slack on each edge of the window — see trap 2 in the header. */
export const PAD = 8;

export const naipCacheFile = (id) => cachePath(id, 'naip-planetary');

const hasBounds = (b) =>
  Number.isFinite(b?.north) && Number.isFinite(b?.south) && Number.isFinite(b?.east) && Number.isFinite(b?.west);

/**
 * The STAC search URL for a venue bbox.
 *
 * STAC orders a bbox `[west, south, east, north]` — longitude first, the
 * south-west corner first. A latitude-first box is a different, plausible
 * place on earth, and the API answers it happily, so the order is pinned by
 * the suite rather than trusted to memory.
 */
export function searchUrl(bounds, { limit = 10, datetime } = {}) {
  for (const key of ['west', 'south', 'east', 'north']) {
    if (!Number.isFinite(bounds?.[key])) throw new Error(`naip search needs a finite bounds.${key}`);
  }
  const query = [
    `collections=${COLLECTION}`,
    `bbox=${[bounds.west, bounds.south, bounds.east, bounds.north].join(',')}`,
    `limit=${limit}`,
  ];
  if (datetime) query.push(`datetime=${encodeURIComponent(datetime)}`);
  return `${STAC_SEARCH}?${query.join('&')}`;
}

/** Every NAIP item intersecting the venue bbox, plus the URL that found them. */
export async function searchItems(bounds, { fetchFn = fetch, limit = 10, datetime } = {}) {
  const url = searchUrl(bounds, { limit, datetime });
  const res = await fetchFn(url, { headers: { Accept: 'application/geo+json', 'User-Agent': UA } });
  if (!res?.ok) throw new Error(`STAC search returned ${res?.status}`);
  const body = await res.json();
  return { url, items: Array.isArray(body?.features) ? body.features : [] };
}

/**
 * An anonymous, short-lived (~45 minute) SAS token for the naip container.
 * No account, no subscription key — a key only raises the signing rate limit.
 */
export async function sasToken(fetchFn = fetch) {
  const res = await fetchFn(SAS_TOKEN_URL, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res?.ok) throw new Error(`SAS token request returned ${res?.status}`);
  const body = await res.json();
  if (!body?.token) throw new Error('SAS token response carried no token');
  return { token: body.token, expiry: body['msft:expiry'] || null };
}

/** Planetary Computer signs a blob by appending the token as a query string. */
export const signHref = (href, token) => `${href}${href.includes('?') ? '&' : '?'}${token}`;

/** Does this failure look like a SAS token that has aged out mid-build? */
export function isExpiredSignature(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (status === 403) return true;
  return /\b403\b|forbidden|AuthenticationFailed|AuthorizationPermissionMismatch/i.test(String(err?.message || ''));
}

/**
 * Open a Planetary Computer blob with a freshly signed href, re-signing
 * exactly once if the first attempt comes back 403. Tokens expire in about 45
 * minutes and a bake outlives that; a second 403 is a real problem (the
 * container moved, the collection changed) and is surfaced, not retried.
 */
export async function openSignedAsset(href, { openTiff = fromUrl, fetchFn = fetch } = {}) {
  let signings = 0;
  const open = async () => {
    const { token } = await sasToken(fetchFn);
    signings += 1;
    return openTiff(signHref(href, token));
  };
  try {
    return { tiff: await open(), signings };
  } catch (err) {
    if (!isExpiredSignature(err)) throw err;
    return { tiff: await open(), signings };
  }
}

/** A STAC item's outer ring, closing point dropped. */
function outerRing(item) {
  const ring = item?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) throw new Error('item has no usable footprint ring');
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = last?.[0] === first?.[0] && last?.[1] === first?.[1];
  return (closed ? ring.slice(0, -1) : ring).filter(
    (p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]),
  );
}

/**
 * The four corners of a footprint, by position rather than ring order — STAC
 * does not promise an order, and PC's own items are not consistent about it.
 * Normalising to the ring's own half-extents first makes the diagonal test
 * independent of the quad's aspect ratio; it holds for any rotation under 45
 * degrees, and a NAIP quad's is a couple of degrees.
 */
export function quadCorners(ring) {
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const cy = (Math.min(...lats) + Math.max(...lats)) / 2;
  const hx = (Math.max(...lngs) - Math.min(...lngs)) / 2 || 1;
  const hy = (Math.max(...lats) - Math.min(...lats)) / 2 || 1;
  const pick = (score) => {
    let best = ring[0];
    let bestScore = -Infinity;
    for (const point of ring) {
      const s = score((point[0] - cx) / hx, (point[1] - cy) / hy);
      if (s > bestScore) {
        bestScore = s;
        best = point;
      }
    }
    return best;
  };
  return {
    nw: pick((x, y) => y - x),
    ne: pick((x, y) => y + x),
    se: pick((x, y) => x - y),
    sw: pick((x, y) => -x - y),
  };
}

/**
 * Solve the item's degrees → pixels affine from three corner
 * correspondences: NW → (0, 0), NE → (width, 0), SW → (0, height).
 */
export function geographicToPixel(item) {
  const shape = item?.properties?.['proj:shape'];
  if (!Array.isArray(shape) || shape.length < 2) throw new Error('item has no proj:shape');
  const [height, width] = shape; // proj:shape is [rows, columns]
  const { nw, ne, sw } = quadCorners(outerRing(item));

  const u1 = ne[0] - nw[0];
  const v1 = ne[1] - nw[1];
  const u2 = sw[0] - nw[0];
  const v2 = sw[1] - nw[1];
  const det = u1 * v2 - u2 * v1;
  if (!det) throw new Error('degenerate footprint — corners are collinear');

  const a = (width * v2) / det;
  const b = (-width * u2) / det;
  const c = (-height * v1) / det;
  const d = (height * u1) / det;

  const toPixel = (lng, lat) => {
    const du = lng - nw[0];
    const dv = lat - nw[1];
    return [a * du + b * dv, c * du + d * dv];
  };
  return { toPixel, width, height, a, b, c, d, nw, ne, sw };
}

/**
 * The pixel window covering a venue bbox inside one NAIP item.
 *
 * All four corners are transformed, not just two: under rotation the venue's
 * north-west corner is not the window's left edge. `complete` is false when
 * the venue runs off this tile — a real case for a park on a quad boundary,
 * and one the caller should raise as a Gap rather than silently half-read.
 */
export function windowFor(item, bounds, { pad = PAD } = {}) {
  if (!hasBounds(bounds)) throw new Error('naip window needs north/south/east/west');
  const { toPixel, width: imageWidth, height: imageHeight } = geographicToPixel(item);
  const corners = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
  ].map(([lng, lat]) => toPixel(lng, lat));

  const cols = corners.map((p) => p[0]);
  const rows = corners.map((p) => p[1]);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const complete = minCol >= 0 && minRow >= 0 && maxCol <= imageWidth && maxRow <= imageHeight;

  const left = Math.max(0, Math.floor(minCol) - pad);
  const right = Math.min(imageWidth, Math.ceil(maxCol) + pad);
  const top = Math.max(0, Math.floor(minRow) - pad);
  const bottom = Math.min(imageHeight, Math.ceil(maxRow) + pad);
  if (!(right > left && bottom > top)) throw new Error('venue bounds fall outside this NAIP tile');

  return { left, top, right, bottom, width: right - left, height: bottom - top, complete };
}

/**
 * Read one venue's window out of an item's four-band COG.
 * Returns the bands as geotiff hands them over — one typed array per band.
 */
export async function readNaipWindow(item, bounds, { openTiff = fromUrl, fetchFn = fetch, pad = PAD } = {}) {
  const href = item?.assets?.image?.href;
  if (!href) throw new Error('STAC item has no `image` asset');
  const win = windowFor(item, bounds, { pad });

  const { tiff, signings } = await openSignedAsset(href, { openTiff, fetchFn });
  const image = await tiff.getImage();
  const [shapeHeight, shapeWidth] = item.properties['proj:shape'];
  if (image.getWidth() !== shapeWidth || image.getHeight() !== shapeHeight) {
    // The window came from the item's footprint-to-shape mapping. If the COG
    // is a different size (an overview, a re-tiled vintage), that mapping is
    // pointing at the wrong pixels — refuse rather than read the wrong ground.
    throw new Error(
      `COG is ${image.getWidth()}x${image.getHeight()} but item ${item.id} claims ${shapeWidth}x${shapeHeight}`,
    );
  }

  // `{ window }`, never `{ bbox }` — see trap 1 in the header.
  const bands = await image.readRasters({ window: [win.left, win.top, win.right, win.bottom] });
  return { bands, window: win, signings, href };
}

/** sha256 over the raster bytes actually ingested, band by band, in order. */
export function sha256OfRaster(bands) {
  const hash = createHash('sha256');
  for (const band of bands || []) {
    hash.update(
      ArrayBuffer.isView(band)
        ? Buffer.from(band.buffer, band.byteOffset, band.byteLength)
        : Buffer.from(band),
    );
  }
  return hash.digest('hex');
}

/**
 * ADR-0020 clause 1's provenance row for one item: source tile, capture date,
 * licence class. The href pinned is the *unsigned* one — a SAS token is a
 * credential with a 45-minute life, so it belongs in neither a cache nor a
 * ledger.
 */
export function provenanceFor(item) {
  const props = item?.properties || {};
  const datetime = props.datetime || props.start_datetime || null;
  return {
    source: 'planetary-computer:naip',
    tile: item?.id || null,
    href: item?.assets?.image?.href || null,
    captured: datetime ? String(datetime).slice(0, 10) : null,
    gsd: Number.isFinite(props.gsd) ? props.gsd : null,
    license: LICENSE,
    attribution: ATTRIBUTION,
    epsg: props['proj:epsg'] ?? null,
  };
}

/**
 * Every usable frame over this venue, best first: one that fully covers it
 * ahead of one that does not, then most recent capture. Coverage outranks
 * recency because half a park from this year is worth less than the whole park
 * from two years ago.
 *
 * The whole ranked shelf rather than only its head, because the best frame is
 * sometimes empty: big-kahunas' 2022 quarter-quad is nodata over the entire
 * park while its 2019 one reads fine, and a caller that never saw past the top
 * of the ranking would call that park unreadable.
 */
export function rankItems(items, bounds) {
  const scored = [];
  for (const item of items || []) {
    if (!item?.assets?.image?.href) continue;
    if (!Array.isArray(item?.properties?.['proj:shape'])) continue;
    let complete = false;
    try {
      complete = windowFor(item, bounds).complete;
    } catch {
      continue; // the venue is not on this tile at all
    }
    scored.push({ item, complete, captured: String(item.properties?.datetime || '') });
  }
  scored.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (a.captured === b.captured) return 0;
    return a.captured < b.captured ? 1 : -1;
  });
  return scored;
}

/** The one frame to read — the head of `rankItems`, or null when none fits. */
export function pickItem(items, bounds) {
  return rankItems(items, bounds)[0] || null;
}

/** One venue-level `aerial` claim recording which frame this venue was read from. */
export function naipClaims(record, center) {
  if (!record?.sha256 || !center) return [];
  const coverage = record.complete ? 'covers' : 'partially covers';
  return [
    {
      source: 'aerial',
      kind: 'metadata',
      at: { lat: center.lat, lng: center.lng },
      date: record.captured || record.fetched,
      note: `NAIP ${record.tile} (${record.gsd} m GSD, captured ${record.captured}) ${coverage} this venue.`,
    },
  ];
}

const centerOf = (bounds) => ({
  lat: (bounds.north + bounds.south) / 2,
  lng: (bounds.east + bounds.west) / 2,
});

export async function run(ctx = {}, { openTiff = fromUrl, fetchFn = fetch } = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: ID, ok: false, error: 'venueId_required' };

  const cached = readCache(id, 'naip-planetary');
  if (ctx.offline) {
    return {
      adapterId: ID,
      ok: Boolean(cached?.sha256),
      claims: cached?.bounds ? naipClaims(cached, centerOf(cached.bounds)) : [],
      data: cached,
    };
  }

  const bounds = ctx.bounds;
  if (!hasBounds(bounds)) {
    const stub = cached || {
      sha256: null,
      error: 'Set ctx.bounds — a venue bbox is what picks the NAIP tile and the window.',
      gap: true,
    };
    writeCache(id, 'naip-planetary', stub);
    return { adapterId: ID, ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
  }

  try {
    const { items } = await searchItems(bounds, { fetchFn, limit: ctx.limit ?? 10 });
    const best = pickItem(items, bounds);
    if (!best) {
      const stub = {
        sha256: null,
        bounds,
        itemCount: items.length,
        error: 'no NAIP item covers this venue',
        gap: true,
      };
      writeCache(id, 'naip-planetary', stub);
      return { adapterId: ID, ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
    }

    const read = await readNaipWindow(best.item, bounds, { openTiff, fetchFn });
    const out = {
      fetched: new Date().toISOString().slice(0, 10),
      ...provenanceFor(best.item),
      sha256: sha256OfRaster(read.bands),
      bandCount: read.bands.length,
      window: {
        left: read.window.left,
        top: read.window.top,
        width: read.window.width,
        height: read.window.height,
      },
      complete: read.window.complete,
      itemCount: items.length,
      bounds,
    };
    writeCache(id, 'naip-planetary', out);

    // The pixels stay in memory on purpose: the ledger row is what ADR-0020
    // clause 1 asks a fetch to leave behind, and how a harvest wants the
    // raster persisted is the harvest's decision, not this adapter's.
    return {
      adapterId: ID,
      ok: true,
      claims: naipClaims(out, ctx.center || centerOf(bounds)),
      meta: { tile: out.tile, captured: out.captured, gsd: out.gsd, complete: out.complete },
      artifacts: [naipCacheFile(id)],
      data: out,
    };
  } catch (err) {
    return { adapterId: ID, ok: false, error: err.message };
  }
}

/**
 * A probe over one NAIP window, addressed in degrees.
 *
 * Reading pixels is not extraction and not persistence — both of which this
 * adapter deliberately leaves to its callers — it is *addressing*, in the one
 * coordinate system only this file understands. The affine comes from the
 * item's own footprint (`geographicToPixel`), never from its bounding box:
 * trap 2 in this file's header, from the reading side — a rotated quadrilateral
 * interpolated as a bbox lands hundreds of metres off, which for a caller
 * sampling ground means reading the neighbouring field and calling it the
 * midway.
 *
 * Zero across every channel this probe returns is NAIP's nodata, and it reads
 * as nothing rather than as black. A quarter-quad is rotated in WGS84, so the
 * axis-aligned image has zero-filled corners, and a venue can sit in that
 * collar while `windowFor` still calls the read `complete` — the footprint
 * does contain it; the pixels are simply absent. Big Kahuna's best-covering
 * frame is nodata over the whole park. Handing those zeros back as a colour is
 * how a harvest comes to report six classes of pure black and call itself
 * certified. One non-zero channel is a reading: aerial imagery has no true
 * black, but it does have very dark ground.
 *
 * The guard spans exactly the channels the reading spans. NAIP ships four
 * bands and this probe returns three, so a guard over all four would let
 * R=G=B=0 with NIR=120 through as `[0, 0, 0]` — pure black handed to the
 * harvest as a genuine reading, the same failure through a narrower door.
 */
export function naipProbe({ item, window, bands, channels = [0, 1, 2] }) {
  const { toPixel } = geographicToPixel(item);
  const { left, top, width, height } = window;
  return {
    at(lng, lat) {
      const [fx, fy] = toPixel(lng, lat);
      const x = Math.floor(fx) - left;
      const y = Math.floor(fy) - top;
      if (!(x >= 0 && y >= 0 && x < width && y < height)) return null;
      const i = y * width + x;
      const rgb = channels.map((c) => bands?.[c]?.[i]);
      if (!rgb.every((v) => Number.isFinite(v))) return null;
      if (rgb.every((v) => v === 0)) return null;
      return rgb;
    },
  };
}
