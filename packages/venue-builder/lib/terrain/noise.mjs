/**
 * Seeded 2D value-gradient noise — organic clumping without a clock.
 *
 * Written here rather than pulled from a package because the bake is
 * certified byte-identical across reruns (`style_bake_deterministic`), and a
 * dependency that reseeds itself, or seeds from `Math.random`, silently fails
 * that gate. Sixty lines is cheaper than owning that risk.
 *
 * Classic Perlin: a permutation table shuffled from an integer seed, four
 * corner gradients, quintic fade. Output is roughly -1..1.
 */

/**
 * Deterministic xorshift32. Same seed, same stream, on every machine.
 * @param {number} seed
 * @returns {() => number} next float in [0, 1)
 */
export function makeRng(seed = 1) {
  let s = Math.trunc(seed) | 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);

/* Four axis-diagonal gradients. Cheaper than a dot product and, at the
 * frequencies this is sampled at, indistinguishable from the 8-gradient form. */
function grad(hash, x, y) {
  switch (hash & 3) {
    case 0: return x + y;
    case 1: return y - x;
    case 2: return x - y;
    default: return -x - y;
  }
}

/**
 * @param {number} seed
 * @returns {(x: number, y: number) => number} noise in ~[-1, 1]
 */
export function makeNoise2D(seed = 1) {
  const rng = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  // Fisher-Yates from the seeded stream — never Math.random, never Random.Shared.
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];

  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}
