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
  const wiredInto = (rel, importer) => {
    // Both paths are checked before either is used. Short-circuiting on
    // has(rel) would leave a typo'd importer unvalidated whenever the module
    // is absent — and a probe with a bad importer path does not error, it
    // quietly returns false forever, which reads as "not built yet" and sends
    // session after session to rebuild something that is already there.
    at(rel);
    at(importer);
    return has(rel) && read(importer).includes(path.basename(rel, path.extname(rel)));
  };
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
    resolved: 'Owner, 2026-08-22: after the per-band knobs, not twice. h5 has landed, so the wait is already over.',
  },
  b: {
    question: 'Perf gate rows — how are they structured?',
    between: [
      'regression-only CI throttle (cheap, catches deltas not absolutes)',
      'absolute bar plus a pinned real device (expensive, catches "always slow")',
    ],
    also: 'whether zero-blank-tiles survives as a row, now that ADR-0021 removed its correctness rationale',
    source: 'ADR-0021 Open',
    resolved: 'Owner, 2026-08-22: NO performance restriction for now. Do not build a perf gate. '
      + 'Nothing measures frame rate, so a slow map ships unremarked until someone looks — accepted.',
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
    resolved: 'Owner, 2026-08-22: disputes stay BUILDER-SIDE and are NEVER shown to guests. '
      + 'The seven shipped Gap types stay frozen. NOTE: main already shipped an eighth type, '
      + '`path_disputed`, decided the other way before this answer — see slice i18.',
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
    resolved: 'Owner, 2026-08-22: do not trim at all — emit the full planned extent, so the plan '
      + 'and the picture are the same thing. NOTE: main still crops (cropModel is live), decided '
      + 'the other way before this answer — see slice h19.',
  },
});

/** A decision still withholds its slices until someone records an answer.
 *
 *  Unknown keys stay open so a synthetic board (and a newly named question)
 *  still gates; a recorded `resolved` is what lets the next session start. */
export function decisionIsOpen(key) {
  if (!key) return false;
  const recorded = DECISIONS[key];
  if (!recorded) return true;
  return !recorded.resolved;
}

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
    title: 'MapLibre renderer and overlay ported, behind the renderer switch',
    needs: ['h7'],
    probe: (t) =>
      t.read('apps/party-tracker/package.json').includes('maplibre')
      && t.read('apps/party-tracker/components/ParkMap.jsx').includes('overlayGeo')
      && t.has('apps/party-tracker/components/ParkMapGl.jsx')
      && t.read('apps/party-tracker/lib/mapLibreConfigured.js').includes('parkMapRenderer'),
  },
  {
    // Split out of h11, because h11's title bundled two jobs with different
    // gates and its probe could only see one of them. The port lands behind a
    // switch; the flip waits on h15's perf rows — the SVG adapter is the
    // escape hatch "until the MapLibre one passes the gate". A probe that
    // reported h11 built while parkMapRenderer() still answered 'svg' and a
    // 2,159-line ParkMapSvg.jsx still drew the shipped map would be the plan
    // telling the next session a lie. Nothing is excused by the split: this
    // slice is unbuilt and gated, exactly as the work is.
    id: 'h18',
    train: 'H',
    size: 'M',
    title: 'MapLibre becomes the shipped renderer; the SVG map retires',
    //  Carries a debt the port left: the two renderers open on different
    //  points — the SVG on the venue's declared centre, the port on the bbox
    //  centre, 77 m to 291 m apart across the shipped venues. Free while the
    //  SVG ships; a silent regression on every venue's first paint the day it
    //  does not. ParkMap.jsx's gap list has the measurements.
    needs: ['h11', 'h15'],
    //  A retirement is two negatives, and two negatives are true of a tree
    //  where nothing was ever built — the suite caught this probe reporting the
    //  SVG retired in an empty checkout. The positive clause anchors it: the
    //  replacement has to be there before its absence means anything.
    //  Matched on content, not on syntax. The first version of this clause
    //  grepped /PARK_MAP_RENDERERS\s*=\s*\[/ while the real file has always
    //  said `= Object.freeze([`, so it was false on every real tree and true
    //  only against the fixture written to satisfy it. A fixture proves a probe
    //  CAN move; it does not prove the probe describes the code. Asking whether
    //  'svg' is still spelled as a renderer needs no syntax at all.
    probe: (t) => {
      const switchFile = t.read('apps/party-tracker/lib/mapLibreConfigured.js');
      return (
        t.has('apps/party-tracker/components/ParkMapGl.jsx')
        && !t.has('apps/party-tracker/components/ParkMapSvg.jsx')
        && switchFile.includes('PARK_MAP_RENDERERS')
        && !/PARK_MAP_RENDERERS[^\n]*'svg'/.test(switchFile)
      );
    },
  },
  {
    id: 'h14',
    train: 'H',
    size: 'L',
    title: 'pixel-tycoon converts; iso retires; three Skins ship',
    needs: ['h5'],
    blocked: 'a',
    //  Three jobs in the title, so three clauses. The first version checked
    //  only that the kit file existed — satisfied by an empty {} — and would
    //  have reported the slice built with the Skin unregistered and the iso
    //  renderer still in the tree, which is two thirds of the work.
    probe: (t) =>
      t.read('packages/venue-builder/data/display/kits/pixel-tycoon.json').includes('palette')
      && t.read('packages/venue-builder/data/display/skins.json').includes('pixel-tycoon')
      && !t.read('packages/shared/isoWorld.js').includes('ISO_MAP_TEMPLATES'),
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

  {
    // Divergence, not new scope. main was built while `crop` was recorded the
    // other way: cropModel is still live, so a venue whose boundary leaves slack
    // plans one picture and emits a smaller one (big-kahunas plans 244x276,
    // bakes 157x191). The owner's answer is to stop trimming, which makes the
    // plan and the picture the same thing and deletes the reconciliation rather
    // than getting it right.
    //
    // Anchored on display-bands.mjs so this cannot read as built on a tree that
    // simply predates cropping: a removal is satisfied by any tree from before
    // the thing existed, which is the trap the baseline check exists to catch.
    id: 'h19',
    train: 'H',
    size: 'M',
    title: 'Stop trimming the bake — emit the full planned extent (owner decision: crop)',
    needs: ['h4'],
    probe: (t) =>
      t.has('packages/venue-builder/lib/display-bands.mjs')
      && !t.read('packages/venue-builder/lib/display-bake.mjs').includes('cropModel'),
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
  {
    // Divergence, not new scope. main shipped an eighth guest-facing Gap type,
    // `path_disputed`, while `c` was recorded as "extend SHIPPED_GAP_TYPES".
    // The owner's answer is the opposite: disputes stay builder-side and are
    // never shown to guests, and the seven stay frozen. Removing a shipped type
    // touches the phone's own vocabulary, so it is a slice rather than an edit.
    id: 'i18',
    train: 'I',
    size: 'M',
    title: 'Unship path_disputed — disputes stay builder-side (owner decision: c)',
    needs: ['i16'],
    probe: (t) =>
      t.has('packages/venue-builder/lib/imagery-claims.mjs')
      && t.read('packages/venue-builder/lib/ship-gaps.mjs').includes('SHIPPED_GAP_TYPES')
      && !t.read('packages/venue-builder/lib/ship-gaps.mjs').includes('path_disputed'),
  },
]);

/** Every slice with its doneness read off a tree.
 *
 *  `slices` is injectable for one reason: the suite has to prove that a
 *  throwing probe does not take the run down, and it cannot do that without
 *  putting a throwing probe in the list. Re-implementing this loop in the test
 *  to get one would assert nothing about this function — deleting the catch
 *  below would leave that test green.
 *
 *  A probe that throws counts as not-done rather than crashing the run: a
 *  session that cannot read one file should still learn about the other
 *  sixteen slices. The thrown message rides along so the failure is visible
 *  rather than silently indistinguishable from "not built yet". */
export function status(tree = treeAt(REPO), slices = SLICES) {
  return slices.map((s) => {
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
  return rows.filter((r) => !r.done && !decisionIsOpen(r.blocked) && r.needs.every((n) => doneIds.has(n)));
}

/** Slices that are only waiting on a person. */
export function blocked(rows = status()) {
  return rows.filter((r) => !r.done && decisionIsOpen(r.blocked));
}

/** Slices waiting on other slices rather than on a decision.
 *
 *  "Rather than" is transitive, and it has to be: h9 is not itself blocked and
 *  its unmet dependency is h4, which is. Excluding only directly-blocked slices
 *  lists h9 as merely waiting AND as gated, so it appears twice in the same
 *  report and is counted twice by anything summing the buckets. */
export function waiting(rows = status()) {
  const doneIds = new Set(rows.filter((r) => r.done).map((r) => r.id));
  return rows.filter(
    (r) => !r.done && !gatedBy(r.id, rows) && !r.needs.every((n) => doneIds.has(n)),
  );
}

/** Which decision, if any, stands between a slice and being buildable — its
 *  own, or one gating anything in its dependency closure.
 *
 *  This is the number that actually matters for planning. A slice can be
 *  unblocked itself and still be unreachable because something it needs is
 *  waiting on a person: h9 is not blocked, but it needs h4, and h4 waits on
 *  `crop`. Counting only the directly-blocked slices flatters the plan and
 *  makes a chain of sessions look like it can finish when it cannot. */
export function gatedBy(id, rows = status()) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const walk = (at, seen) => {
    const r = byId.get(at);
    if (!r || r.done || seen.has(at)) return null;
    if (decisionIsOpen(r.blocked)) return r.blocked;
    seen.add(at);
    for (const need of r.needs) {
      const found = walk(need, seen);
      if (found) return found;
    }
    return null;
  };
  return walk(id, new Set());
}

/** Unbuilt slices that no amount of session time can reach. */
export function decisionGated(rows = status()) {
  return rows
    .filter((r) => !r.done)
    .map((r) => ({ ...r, gatedBy: gatedBy(r.id, rows) }))
    .filter((r) => r.gatedBy);
}

/** Unbuilt slices a chain of sessions can reach on its own, in some order. */
export function reachable(rows = status()) {
  return rows.filter((r) => !r.done && !gatedBy(r.id, rows));
}

/** How far the two trains are, as counts a session can print in one line.
 *
 *  `ceiling` is what the work can reach unattended - built plus reachable. The
 *  gap between it and `total` is the owner's to close, not a session's. */
export function progress(rows = status()) {
  const per = (train) => {
    const of = rows.filter((r) => r.train === train);
    return { train, done: of.filter((r) => r.done).length, total: of.length };
  };
  const done = rows.filter((r) => r.done).length;
  return {
    total: rows.length,
    done,
    ceiling: done + reachable(rows).length,
    gated: decisionGated(rows).length,
    trains: [per('H'), per('I')],
  };
}
