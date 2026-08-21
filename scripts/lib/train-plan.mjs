/** Trains H and I as data, with doneness derived from the tree.
 *
 * Cloud sessions are ephemeral: the container is reclaimed, and the next
 * session starts knowing nothing. A hand-maintained checklist does not survive
 * that — it drifts the moment someone lands a slice and forgets to tick it, and
 * a plan that lies is worse than no plan because it sends the next session to
 * build something that already exists.
 *
 * So no slice here carries a `done` flag. Each carries a `probe`: a predicate
 * over a tree that answers "is this actually built?". `status()` runs them
 * against the checkout. The plan can be wrong about what a slice *is*, but it
 * cannot be wrong about whether the code is there.
 *
 * A probe reads the tree only through the reader it is handed, and that reader
 * takes repo-relative paths only. That is what makes the probes testable: the
 * suite hands each one a synthetic before/after pair and requires it to tell
 * them apart. A probe that cannot go false is the failure mode this whole
 * module exists to avoid, so it is the first thing the suite checks.
 *
 * Blocked slices name the owner decision that gates them, and those decisions
 * are recorded verbatim from ADR-0021's "Open" section — plus one this work
 * surfaced (`crop`). A session must not decide them; it works around them.
 *
 *   node scripts/train-plan.mjs status
 *   node scripts/train-plan.mjs next
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A read-only view of one checkout, addressed by repo-relative path.
 *
 *  Probes get this and nothing else. Two reasons: a probe cannot quietly
 *  consult the network, the clock or a sibling checkout and call the answer
 *  "the tree"; and a test can hand the same probe a directory it built, which
 *  is the only way to prove the probe discriminates. */
export function treeAt(root) {
  const at = (rel) => {
    if (typeof rel !== 'string' || rel.length === 0) {
      throw new Error('probe paths must be non-empty strings');
    }
    if (path.isAbsolute(rel) || rel.split('/').includes('..')) {
      throw new Error(`probe paths must be repo-relative and inside the tree: ${rel}`);
    }
    return path.join(root, rel);
  };
  const read = (rel) => {
    try {
      return readFileSync(at(rel), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') return '';
      throw err;
    }
  };
  const has = (rel) => existsSync(at(rel));
  /** A file exists AND some other file refers to it — the difference between a
   *  module being written and a module being reachable, which is the
   *  difference this plan most often has to make. */
  const wiredInto = (rel, importer) =>
    has(rel) && read(importer).includes(path.basename(rel, path.extname(rel)));
  return Object.freeze({ root, read, has, wiredInto });
}

/** The owner decisions that gate slices. Recorded, never guessed at.
 *  a/b/c are ADR-0021's own "Open" section; `crop` came out of building. */
export const DECISIONS = Object.freeze({
  a: {
    question: 'Train H build order — pixel-tycoon now or after per-band knobs?',
    between: [
      "author the kit against today's single-band schema and re-author after slice h5",
      'hold it until h5 lands, leaving the three-Skin distinctness gate unrunnable until then',
    ],
    source: 'ADR-0021 Open',
  },
  b: {
    question: 'Perf gate rows — how are they structured?',
    between: [
      'regression-only CI throttle (cheap, catches deltas not absolutes)',
      'absolute bar plus a pinned real device (expensive, catches "always slow")',
    ],
    also: 'whether zero-blank-tiles survives as a row, now that ADR-0021 removed its correctness rationale',
    source: 'ADR-0021 Open',
  },
  c: {
    question: 'Train I evidence lane — how does a disputed path position reach a guest?',
    between: [
      'extend the frozen seven SHIPPED_GAP_TYPES',
      'route disputes through the existing path/queue types',
      'keep them builder-side and never ship them',
    ],
    also: 'the steward review budget, Mapillary share-alike reach, and the OSM write-back path',
    source: 'ADR-0021 Open',
  },
  crop: {
    question: 'Does a band plan describe the World, or the cropped PNG?',
    between: [
      'the plan describes the World; the pyramid georeferences against the crop',
      'the plan describes what is emitted; bandBakePlan learns about cropModel',
    ],
    why: 'cropModel trims to the boundary ring plus a 6-cell margin. big-kahunas plans '
      + '244x276 and bakes 157x191; kings-island matches only because its boundary fills '
      + 'its bbox. Becomes a correctness bug the moment tiles are georeferenced.',
    source: 'surfaced while building slice h1',
  },
});

/** The slices. `needs` is dependency, `blocked` names a DECISIONS key.
 *  Each `probe` is handed a tree reader and must answer from it alone. */
export const SLICES = Object.freeze([
  // ---- Train H
  {
    id: 'h0',
    train: 'H',
    size: 'S',
    title: 'Close-band blockers: spread cap and scatter cost',
    probe: (t) =>
      !t.read('packages/venue-builder/lib/display-bake.mjs').includes('treeCells.wood.push(...')
      && t.has('test/builder/display-scatter.mjs'),
  },
  {
    id: 'h1',
    train: 'H',
    size: 'M',
    title: 'Band-addressed bake: plans, span owner, --band flag',
    needs: ['h0'],
    probe: (t) =>
      t.has('packages/venue-builder/lib/display-bands.mjs')
      && t.read('packages/venue-builder/bin/display-bake.mjs').includes("'--band'"),
  },
  {
    id: 'h2',
    train: 'H',
    size: 'S',
    title: 'Alignment budget in ground metres (ADR-0021 clause 3)',
    needs: ['h1'],
    probe: (t) =>
      /budget.*met(re|er)|met(re|er).*budget/i.test(
        t.read('packages/venue-builder/lib/display-style-contract.mjs'),
      ),
  },
  {
    id: 'h4',
    train: 'H',
    size: 'M',
    title: 'Raster pyramid writer wired into the pack',
    needs: ['h1'],
    blocked: 'crop',
    probe: (t) =>
      t.wiredInto(
        'packages/venue-builder/lib/display-pyramid.mjs',
        'packages/venue-builder/lib/display-pack.mjs',
      ),
  },
  {
    id: 'h5',
    train: 'H',
    size: 'L',
    title: 'Per-band generalization and band-aware style rows',
    needs: ['h1'],
    probe: (t) =>
      /band/i.test(t.read('packages/venue-builder/lib/display-style-contract.mjs'))
      && t.read('packages/venue-builder/lib/display-bake.mjs').includes('bandGeneralization'),
  },
  {
    id: 'h6',
    train: 'H',
    size: 'M',
    title: 'Clause-1 no-baked-text certification rows',
    probe: (t) =>
      t.read('packages/venue-builder/lib/display-style-contract.mjs').includes('style_no_baked_text'),
  },
  {
    id: 'h7',
    train: 'H',
    size: 'M',
    title: 'mapView seam over the band chooser',
    needs: ['h1'],
    probe: (t) => t.has('apps/party-tracker/lib/mapView.js'),
  },
  {
    id: 'h9',
    train: 'H',
    size: 'M',
    title: 'Bands stream by viewport with a parent placeholder',
    needs: ['h4', 'h7'],
    probe: (t) => t.read('apps/party-tracker/components/BandedWorldMap.jsx').includes('pmtiles'),
  },
  {
    id: 'h11',
    train: 'H',
    size: 'L',
    title: 'MapLibre as the one renderer; overlay ported; SVG map retires',
    needs: ['h7'],
    probe: (t) =>
      t.read('apps/party-tracker/package.json').includes('maplibre')
      && t.read('apps/party-tracker/components/ParkMap.jsx').includes('overlayGeo'),
  },
  {
    id: 'h14',
    train: 'H',
    size: 'L',
    title: 'pixel-tycoon converts; iso retires; three Skins ship',
    needs: ['h5'],
    blocked: 'a',
    probe: (t) => t.has('packages/venue-builder/data/display/kits/pixel-tycoon.json'),
  },
  {
    id: 'h15',
    train: 'H',
    size: 'M',
    title: 'Perf gate and the G-5 zoom sweep',
    needs: ['h9'],
    blocked: 'b',
    probe: (t) => /fps|throttle/i.test(t.read('scripts/ci/pre-merge-vertical.mjs')),
  },

  // ---- Train I
  {
    id: 'i3',
    train: 'I',
    size: 'S',
    title: 'Aerial claims reach the evidence graph',
    probe: (t) => t.read('packages/venue-builder/lib/external-claims.mjs').includes('worldcover'),
  },
  {
    id: 'i8',
    train: 'I',
    size: 'M',
    title: 'NAIP via Planetary Computer, reachable by the pipeline',
    probe: (t) =>
      t.read('packages/venue-builder/lib/adapters/registry.mjs').includes('naip-planetary'),
  },
  {
    id: 'i10',
    train: 'I',
    size: 'M',
    title: 'Imagery ledger gates certification',
    needs: ['i8'],
    probe: (t) =>
      t.wiredInto(
        'packages/venue-builder/lib/imagery-ledger.mjs',
        'packages/venue-builder/lib/venue-certify.mjs',
      ),
  },
  {
    id: 'i12',
    train: 'I',
    size: 'L',
    title: 'Grounding harvest into reference profiles (Visual factory half)',
    needs: ['i8'],
    probe: (t) => t.read('packages/venue-builder/lib/display-references.mjs').includes('grounding'),
  },
  {
    id: 'i16',
    train: 'I',
    size: 'L',
    title: 'Extraction lanes and the claims/Gap wall',
    needs: ['i10'],
    blocked: 'c',
    probe: (t) => t.has('packages/venue-builder/lib/imagery-claims.mjs'),
  },
  {
    id: 'i17',
    train: 'I',
    size: 'M',
    title: 'Google corroboration and OSM write-back',
    needs: ['i16'],
    blocked: 'c',
    probe: (t) =>
      t.read('packages/venue-builder/lib/adapters/registry.mjs').includes('google-places'),
  },
]);

/** Every slice with its doneness read off a tree.
 *
 *  A probe that throws counts as not-done rather than crashing the run: a
 *  session that cannot read one file should still learn about the other
 *  sixteen slices. The thrown message rides along so the failure is visible
 *  rather than silently indistinguishable from "not built yet". */
export function status(tree = treeAt(REPO)) {
  return SLICES.map((s) => {
    let done = false;
    let probeError = null;
    try {
      done = s.probe(tree) === true;
    } catch (err) {
      probeError = err?.message ?? String(err);
    }
    return {
      id: s.id,
      train: s.train,
      size: s.size,
      title: s.title,
      needs: s.needs ?? [],
      blocked: s.blocked ?? null,
      done,
      probeError,
    };
  });
}

/** Slices a session can start today: not done, dependencies done, unblocked. */
export function next(rows = status()) {
  const doneIds = new Set(rows.filter((r) => r.done).map((r) => r.id));
  return rows.filter((r) => !r.done && !r.blocked && r.needs.every((n) => doneIds.has(n)));
}

/** Slices that are only waiting on a person. */
export function blocked(rows = status()) {
  return rows.filter((r) => !r.done && r.blocked);
}

/** Slices waiting on other slices rather than on a decision. */
export function waiting(rows = status()) {
  const doneIds = new Set(rows.filter((r) => r.done).map((r) => r.id));
  return rows.filter((r) => !r.done && !r.blocked && !r.needs.every((n) => doneIds.has(n)));
}

/** How far the two trains are, as counts a session can print in one line. */
export function progress(rows = status()) {
  const per = (train) => {
    const of = rows.filter((r) => r.train === train);
    return { train, done: of.filter((r) => r.done).length, total: of.length };
  };
  return {
    total: rows.length,
    done: rows.filter((r) => r.done).length,
    trains: [per('H'), per('I')],
  };
}
