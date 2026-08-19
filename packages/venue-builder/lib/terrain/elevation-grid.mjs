/**
 * A heightfield over a venue, and the four questions the display layer asks it.
 *
 * Truth never gains a Z. A ride's entrance is at the same latitude and
 * longitude whether the ground under it is flat or on a berm, so elevation is
 * not evidence and does not belong in `map.json`. What it changes is how the
 * ground is *drawn* — where the light falls, which patches are too steep to be
 * turf, and (once something can render it) where a mesh sits. That makes this
 * a display input, and it is why nothing here writes back to truth.
 *
 * Sampling is barycentric over the two triangles a cell splits into, not
 * bilinear. Bilinear is smoother and it disagrees with any mesh built from the
 * same grid — the render would shade one surface while the geometry described
 * another. Matching the triangles costs nothing and keeps the two honest.
 */

/** Metres per degree of latitude — good to ~0.1% over a park. */
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

export class ElevationGrid {
  /**
   * @param {{ cols: number, rows: number, cellSize: number, values: Float32Array|number[] }} init
   *   `cellSize` is metres per cell; `values` is row-major, north row first.
   */
  constructor({ cols, rows, cellSize, values }) {
    if (!(cols > 0 && rows > 0)) throw new Error('ElevationGrid needs positive cols/rows');
    if (values.length !== cols * rows) {
      throw new Error(`ElevationGrid: expected ${cols * rows} values, got ${values.length}`);
    }
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.values = values instanceof Float32Array ? values : Float32Array.from(values);
  }

  /** Elevation at integer cell coordinates, clamped at the edges (never wrapped). */
  at(col, row) {
    const c = Math.min(this.cols - 1, Math.max(0, col | 0));
    const r = Math.min(this.rows - 1, Math.max(0, row | 0));
    return this.values[r * this.cols + c];
  }

  /**
   * Elevation at continuous grid coordinates, interpolated across whichever
   * triangle the point falls in.
   * @param {number} x
   * @param {number} y
   * @returns {number} metres
   */
  elevationAt(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xf = x - x0;
    const yf = y - y0;
    const z00 = this.at(x0, y0);
    const z10 = this.at(x0 + 1, y0);
    const z01 = this.at(x0, y0 + 1);
    if (xf + yf <= 1) {
      // lower-left triangle: (0,0) (1,0) (0,1)
      return z00 + (z10 - z00) * xf + (z01 - z00) * yf;
    }
    // upper-right triangle: (1,1) (0,1) (1,0)
    const z11 = this.at(x0 + 1, y0 + 1);
    return z11 + (z01 - z11) * (1 - xf) + (z10 - z11) * (1 - yf);
  }

  /**
   * Five-tap average — the centre plus four diagonals. A DEM carries metre-scale
   * noise that a slope test will happily amplify into speckle; this is the
   * cheapest thing that stops it.
   * @param {number} x
   * @param {number} y
   * @param {number} [radius] in cells, default half a cell
   */
  around(x, y, radius = 0.5) {
    return (
      this.elevationAt(x, y)
      + this.elevationAt(x - radius, y - radius)
      + this.elevationAt(x + radius, y - radius)
      + this.elevationAt(x - radius, y + radius)
      + this.elevationAt(x + radius, y + radius)
    ) / 5;
  }

  /**
   * Unit normal of the triangle containing the point. Y increases southward,
   * matching the raster, so a north-facing slope has a negative Y component.
   * @returns {{ x: number, y: number, z: number }}
   */
  normalAt(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xf = x - x0;
    const yf = y - y0;
    let dzdx;
    let dzdy;
    if (xf + yf <= 1) {
      const z00 = this.at(x0, y0);
      dzdx = (this.at(x0 + 1, y0) - z00) / this.cellSize;
      dzdy = (this.at(x0, y0 + 1) - z00) / this.cellSize;
    } else {
      const z11 = this.at(x0 + 1, y0 + 1);
      dzdx = (z11 - this.at(x0, y0 + 1)) / this.cellSize;
      dzdy = (z11 - this.at(x0 + 1, y0)) / this.cellSize;
    }
    const len = Math.hypot(dzdx, dzdy, 1);
    return { x: -dzdx / len, y: -dzdy / len, z: 1 / len };
  }

  /**
   * Slope in degrees off horizontal.
   * @returns {number} 0 for flat, 90 for a cliff
   */
  slopeAt(x, y) {
    const n = this.normalAt(x, y);
    return (Math.atan2(Math.hypot(n.x, n.y), n.z) * 180) / Math.PI;
  }

  /** @returns {{ min: number, max: number }} */
  extent() {
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  }

  /**
   * Blend a value into a region with a soft edge — how a berm or a levelled
   * ride pad gets written without a hard step at its boundary.
   *
   * @param {(x: number, y: number) => number} weight 0..1 per cell; 0 leaves it alone
   * @param {(x: number, y: number, current: number) => number} value target elevation
   */
  stamp(weight, value) {
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const w = weight(col, row);
        if (!(w > 0)) continue;
        const i = row * this.cols + col;
        const current = this.values[i];
        const target = value(col, row, current);
        this.values[i] = current + (target - current) * Math.min(1, w);
      }
    }
  }
}

/**
 * Resample an arbitrary lat/lng elevation reader onto a venue-aligned grid.
 *
 * @param {object} opts
 * @param {{north:number,south:number,east:number,west:number}} opts.bounds
 * @param {number} opts.cols
 * @param {number} opts.rows
 * @param {(lat: number, lng: number) => number} opts.sample
 * @returns {ElevationGrid}
 */
export function gridFromBounds({ bounds, cols, rows, sample }) {
  const { north, south, east, west } = bounds;
  const midLat = (north + south) / 2;
  const widthM = (east - west) * M_PER_DEG_LNG * Math.cos((midLat * Math.PI) / 180);
  const heightM = (north - south) * M_PER_DEG_LAT;
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    // Sample cell centres, and north-first so the grid matches the raster.
    const lat = north - ((row + 0.5) / rows) * (north - south);
    for (let col = 0; col < cols; col += 1) {
      const lng = west + ((col + 0.5) / cols) * (east - west);
      const v = sample(lat, lng);
      values[row * cols + col] = Number.isFinite(v) ? v : 0;
    }
  }
  return new ElevationGrid({
    cols,
    rows,
    cellSize: (widthM / cols + heightM / rows) / 2,
    values,
  });
}
