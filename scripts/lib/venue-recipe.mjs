/**
 * How a venue was built, written down, so it can be built that way again.
 *
 * A venue is two generated files and a manifest row, and everything about how
 * they came to look the way they do lived in one place: whatever somebody typed
 * that afternoon. The bounding box, how far it was padded, how hard the geometry
 * was simplified, which datasets were merged in — none of it survived the
 * terminal it was typed into. The best record we had was the pull request body,
 * in prose, and prose is not something a runner can re-run.
 *
 * That is not a filing problem, it is a correctness one. Three of them, all of
 * which have actually happened here:
 *
 *   · The manifest keeps `bounds`, but those are the *padded* bounds. There is
 *     no `--pad` you can pass with them that reproduces the build — pad them
 *     again and the box grows, pass `--pad 0` and it does not match the venue
 *     that was built with 120. Kings Island was built with a pad of 0 and Cedar
 *     Point was not, and nothing on disk says so.
 *   · A tag rule improves and every venue built before it is stale. When water
 *     slides started supplying rides, Fiesta Texas stood to gain eighteen of
 *     them "on its next rebuild" — a rebuild nobody could run without first
 *     reconstructing the arguments from a merged pull request.
 *   · `--center` had to be invented because a rebuild silently moved the map.
 *     That is the same bug wearing a hat: an input that shaped the build was
 *     not recorded, so the build could not be repeated.
 *
 * So each build drops a recipe beside its overrides file, and `--rebuild` reads
 * it back. The split that matters is between the flags that shape *what comes
 * out* — the box, the pad, the tolerance, the merges — and the ones that shape
 * *how the run goes* — `--dry-run`, `--dump`, `--endpoint`. Only the first kind
 * is a fact about the venue, so only the first kind is written down.
 *
 * The box is recorded as it stood *before* `--pad` was applied, which is what
 * makes one field serve all three ways of asking for a venue: a `--place` that
 * was resolved, a `--bbox` that was typed, and an `--around` that was expanded
 * all arrive at the same place, and replaying it as a box with its pad gives
 * back the identical bounds. The place name is kept too, but as provenance
 * rather than as the input — a geocoder is free to change its mind about where
 * "Cedar Point" is, and a repeatable build is one that does not.
 */

import path from 'node:path';
import { readdirSync } from 'node:fs';
import { OVERRIDE_DIR, ROOT, readJson, writeJson } from './venue-io.mjs';

export const RECIPE_VERSION = 1;

/**
 * The flags that change what a build produces, as against how the run goes.
 *
 * Adding a flag to the builder that shapes its output means adding it here, or
 * a rebuild quietly stops reproducing the thing it was asked to reproduce. That
 * is the one maintenance cost of this file and it is worth stating plainly.
 */
export const SHAPING_FLAGS = [
  'name',
  'id',
  'locality',
  'kind',
  'credits',
  'center',
  'overrides',
  'pad',
  'tolerance',
  'dedupe',
  'merge',
  'merge-metres',
  'trace',
  'keep-offsite',
  'allow-no-heights',
  'default',
];

/* The other half of the split needs no list. `--dry-run`, `--dump`,
   `--from-dump`, `--endpoint` and the rest shape how a run goes rather than
   what it produces, and they stay out of a recipe because only the flags above
   are ever written into one — not because anything remembers to remove them. */

export const recipeFile = (id) => path.join(OVERRIDE_DIR, `${id}.recipe.json`);

/** Paths go in relative to the repo, or a recipe only works on the laptop that wrote it. */
const relativise = (value) => {
  const rel = path.relative(ROOT, path.resolve(String(value)));
  return rel.startsWith('..') ? String(value) : rel;
};

const PATH_FLAGS = new Set(['overrides', 'merge', 'trace']);

/**
 * The recipe for a build that just happened.
 *
 * @param args    the parsed flags, as typed
 * @param id      the venue id, which is its identity and never taken from `args`
 * @param box     the bounds *before* `--pad`, so replay can pad them again
 * @param place   the resolved geocoder hit, when `--place` was how it was asked for
 * @param counts  what the build produced, for a human reading the file
 */
export function recipeFrom({ args, id, name, box, place = null, counts = null, built = null, expect = null }) {
  const options = {};
  for (const flag of SHAPING_FLAGS) {
    if (!(flag in args)) continue;
    // The id is the venue's identity and lives at the top level; carrying it in
    // both places is how the two get to disagree.
    if (flag === 'id') continue;
    const value = args[flag];
    if (value == null) continue;
    options[flag] = PATH_FLAGS.has(flag)
      ? Array.isArray(value) ? value.map(relativise) : relativise(value)
      : value;
  }

  return {
    version: RECIPE_VERSION,
    _comment:
      'How this venue was built, so it can be built again. Written by scripts/build-venue.mjs on '
      + `every build; replayed with "npm run venues:rebuild -- ${id}". "box" is the bounding box `
      + 'before "pad" was applied to it, which is why a venue asked for by place name, by box or '
      + 'by a point and a radius all record the same field. Edit it by hand if you like — a '
      + 'rebuild reads whatever is here.',
    id,
    name,
    /* Kept because it is how somebody asked, and because it is the thing to
       re-resolve when a park moves or a boundary is redrawn in OSM. Not kept as
       the input: a geocoder that changes its mind would change the venue under
       a rebuild that was supposed to reproduce it. `--refresh-place` is the way
       to ask for the new answer, on purpose. */
    place: place ? { query: String(args.place), resolved: place.display || null } : null,
    box: box
      ? {
          south: Number(box.south.toFixed(6)),
          west: Number(box.west.toFixed(6)),
          north: Number(box.north.toFixed(6)),
          east: Number(box.east.toFixed(6)),
        }
      : null,
    options,
    built: built || (counts ? { at: new Date().toISOString().slice(0, 10), counts } : null),
    ...(expect ? { expect } : {}),
  };
}

/**
 * A recipe as the flags that would produce it.
 *
 * Returned in the shape `parseArgs` hands back rather than as an argv, because
 * a round trip through the command line is a round trip through quoting, and a
 * park called `Big Kahuna's` is exactly the sort of thing that does not survive
 * one.
 */
export function argsFromRecipe(recipe) {
  if (!recipe?.box && !recipe?.place?.query) {
    throw new Error(`The recipe for "${recipe?.id ?? 'that venue'}" has neither a box nor a place to build from.`);
  }
  const out = { ...(recipe.options || {}) };
  // The id is the identity of the venue being rebuilt. Taking it from the name
  // instead would rebuild "Big Kahuna's" as `big-kahunas` only by luck.
  out.id = recipe.id;
  if (recipe.name && !out.name) out.name = recipe.name;
  if (recipe.box) {
    const b = recipe.box;
    out.bbox = `${b.south},${b.west},${b.north},${b.east}`;
  } else {
    out.place = recipe.place.query;
  }
  return out;
}

export function readRecipe(idOrFile) {
  const file = String(idOrFile).endsWith('.json') ? String(idOrFile) : recipeFile(idOrFile);
  const data = readJson(file);
  return data ? { file, data } : { file: null, data: null };
}

export function writeRecipe(id, recipe) {
  const file = recipeFile(id);
  writeJson(file, recipe, true);
  return file;
}

/** Every venue on disk that knows how it was built, in a stable order. */
export function listRecipes() {
  try {
    return readdirSync(OVERRIDE_DIR)
      .filter((f) => f.endsWith('.recipe.json'))
      .map((f) => f.slice(0, -'.recipe.json'.length))
      .sort();
  } catch {
    return [];
  }
}
