/**
 * Export the heightfield as a textured mesh (Wavefront OBJ + MTL).
 *
 * Stated plainly: nothing in this repo renders it yet. The phone draws SVG,
 * the display factory bakes a top-down raster, and neither has a third
 * dimension. This exists because the moment an isometric or 3D tier appears,
 * the question "where does the ground come from" should already be answered,
 * and because an OBJ is the cheapest way to look at a heightfield in any tool
 * and confirm it is not nonsense.
 *
 * The mesh is deliberately the same triangles `ElevationGrid.elevationAt`
 * interpolates over, so what a renderer draws and what the builder measured
 * are the same surface.
 *
 * UVs map the baked ground image across the mesh 1:1, so the existing bake is
 * the texture with no re-projection.
 */

/**
 * @param {import('./elevation-grid.mjs').ElevationGrid} grid
 * @param {object} [opts]
 * @param {string} [opts.name]
 * @param {string} [opts.texture] filename referenced by the .mtl
 * @param {number} [opts.exaggeration] vertical scale, 1 = true to life
 * @returns {{ obj: string, mtl: string }}
 */
export function meshFromGrid(grid, opts = {}) {
  const name = opts.name || 'venue-terrain';
  const texture = opts.texture || 'ground.png';
  const exaggeration = opts.exaggeration ?? 1;
  const { cols, rows, cellSize } = grid;
  const { min } = grid.extent();

  // Centre on the origin and rest the lowest point on zero, so the mesh drops
  // into any scene without a transform.
  const halfW = (cols - 1) * cellSize / 2;
  const halfH = (rows - 1) * cellSize / 2;

  const out = [];
  out.push(`# ${name} — terrain mesh from the display heightfield`);
  out.push(`# ${cols}x${rows} vertices, ${cellSize.toFixed(3)} m per cell`);
  out.push(`mtllib ${name}.mtl`);
  out.push(`o ${name}`);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * cellSize - halfW;
      // Y up, Z south — the usual OBJ convention, so north is -Z.
      const z = row * cellSize - halfH;
      const y = (grid.at(col, row) - min) * exaggeration;
      out.push(`v ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      out.push(`vt ${(col / (cols - 1)).toFixed(6)} ${(1 - row / (rows - 1)).toFixed(6)}`);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const n = grid.normalAt(col + 0.5, row + 0.5);
      // Grid Y runs south; OBJ Z runs south too, so the sign carries over.
      out.push(`vn ${n.x.toFixed(4)} ${n.z.toFixed(4)} ${n.y.toFixed(4)}`);
    }
  }

  out.push(`usemtl ${name}`);
  const idx = (col, row) => row * cols + col + 1;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = idx(col, row);
      const b = idx(col + 1, row);
      const c = idx(col, row + 1);
      const d = idx(col + 1, row + 1);
      // Split matching ElevationGrid's lower-left / upper-right triangles.
      out.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${b}/${b}/${b}`);
      out.push(`f ${b}/${b}/${b} ${c}/${c}/${c} ${d}/${d}/${d}`);
    }
  }

  const mtl = [
    `# ${name}`,
    `newmtl ${name}`,
    'Ka 1.000 1.000 1.000',
    'Kd 1.000 1.000 1.000',
    'Ks 0.000 0.000 0.000',
    'd 1.0',
    'illum 1',
    `map_Kd ${texture}`,
    '',
  ].join('\n');

  return { obj: `${out.join('\n')}\n`, mtl };
}
