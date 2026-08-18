/**
 * Dual-grid autotiling — soft terrain edges from real tile art.
 *
 * The display grid is offset half a cell from the logical grid: each
 * display vertex samples its four surrounding logical cells and gets a
 * 4-bit mask (NW=1, NE=2, SW=4, SE=8) saying which corners hold the
 * terrain. 16 corner combinations per terrain — the compositor cuts them
 * from one seamless full tile, so shores and tree lines curve instead of
 * stepping. Projection-agnostic: the iso tier reuses the same masks.
 */

/**
 * 4-corner bitmask per display-grid vertex for one terrain.
 *
 * @param {number[]} cells logical terrain grid, row-major
 * @param {number} cols logical grid width
 * @param {number} rows logical grid height
 * @param {number} terrainId terrain to mask
 * @returns {Uint8Array} (cols+1) × (rows+1) masks, row-major
 */
export function dualGridIndices(cells, cols, rows, terrainId) {
  const out = new Uint8Array((cols + 1) * (rows + 1));
  const has = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows
    && cells[y * cols + x] === terrainId;
  for (let vy = 0; vy <= rows; vy += 1) {
    for (let vx = 0; vx <= cols; vx += 1) {
      let mask = 0;
      if (has(vx - 1, vy - 1)) mask |= 1; // NW
      if (has(vx, vy - 1)) mask |= 2; // NE
      if (has(vx - 1, vy)) mask |= 4; // SW
      if (has(vx, vy)) mask |= 8; // SE
      out[vy * (cols + 1) + vx] = mask;
    }
  }
  return out;
}
