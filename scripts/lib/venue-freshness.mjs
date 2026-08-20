/**
 * Venue freshness gate — shipped packs pin the truth they were built on.
 *
 * Factories communicate by artifact contract (ADR-0018): a display pack's
 * `basedOn.map` and a published bundle manifest's `basedOn.map` each pin the
 * venue truth stamp (`map.meta.generated`) they were compiled against. This
 * module is the CI-side check that every shipped pack still names its
 * venue's *current* truth — a truth rebuild that ships without its display
 * rebuild is exactly the drift the pin exists to catch.
 *
 * Two decisions, both pure:
 *   freshnessDecision   — basedOn stamps vs current truth stamps
 *   bundleDriftDecision — a bundle manifest's sha256 pins vs the bytes the
 *                         origin will actually serve (catches edits that do
 *                         not move `generated`, e.g. a hand-fixed POI name)
 *
 * IO collectors read the repo's JSON directly — deliberately no import from
 * packages/venue-builder (scripts stay outside package internals; the
 * boundary rules enforce it).
 *
 * Interface:
 *   freshnessDecision({ truth, packs })
 *   bundleDriftDecision(bundle, hashByPath)
 *   collectTruthStamps(root) / collectShippedPacks(root) / collectBundles(root)
 *   checkVenueFreshness(root)
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), '../..');
const VENUES_PUBLIC = join('apps', 'party-tracker', 'public', 'venues');
const VENUES_BUILDER = join('packages', 'venue-builder', 'data', 'venues');

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Pure. `truth` rows are `{ venue, generated }`; `packs` rows are
 * `{ venue, kind, skin?, basedOn }` where `basedOn` is the pack's pinned
 * truth stamp. A pack for a venue the app does not ship is reported but
 * never fails the gate — it is not shipped, so it cannot mislead a phone.
 */
export function freshnessDecision({ truth, packs }) {
  const current = new Map(truth.map((t) => [t.venue, t.generated]));
  const stale = [];
  const unstamped = [];
  const unshipped = [];
  for (const pack of packs) {
    const want = current.get(pack.venue);
    if (want === undefined) {
      unshipped.push(pack);
      continue;
    }
    if (!pack.basedOn) {
      unstamped.push(pack);
      continue;
    }
    if (pack.basedOn !== want) stale.push({ ...pack, current: want });
  }
  return { fresh: stale.length === 0 && unstamped.length === 0, stale, unstamped, unshipped };
}

/**
 * Pure. Does a bundle manifest still describe the bytes beside it?
 * `hashByPath` maps each manifest path to the sha256 of the file the origin
 * would serve, or null when the file is gone.
 */
export function bundleDriftDecision(bundle, hashByPath) {
  const missing = [];
  const drifted = [];
  for (const entry of bundle?.files || []) {
    const actual = hashByPath.get(entry.path) ?? null;
    if (actual === null) missing.push(entry.path);
    else if (actual !== entry.sha256) drifted.push(entry.path);
  }
  return { clean: missing.length === 0 && drifted.length === 0, missing, drifted };
}

/** Current truth stamps, from the app's shipped venue manifest. */
export function collectTruthStamps(root = repoRoot()) {
  const manifest = readJson(join(root, VENUES_PUBLIC, 'manifest.json'));
  return (manifest?.venues || []).map((v) => ({ venue: v.id, generated: v.generated ?? null }));
}

/**
 * Every shipped pack that pins a truth stamp: the builder's per-Skin visual
 * specs and the app's published bundle manifests.
 */
export function collectShippedPacks(root = repoRoot()) {
  const packs = [];
  const builderDir = join(root, VENUES_BUILDER);
  if (existsSync(builderDir)) {
    for (const venue of readdirSync(builderDir).sort()) {
      const displayDir = join(builderDir, venue, 'display');
      if (!existsSync(displayDir)) continue;
      for (const file of readdirSync(displayDir).sort()) {
        if (!file.endsWith('.visual.json')) continue;
        const spec = readJson(join(displayDir, file));
        packs.push({
          venue,
          kind: 'visual',
          skin: file.slice(0, -'.visual.json'.length),
          basedOn: spec?.basedOn?.map ?? null,
        });
      }
    }
  }
  const publicDir = join(root, VENUES_PUBLIC);
  if (existsSync(publicDir)) {
    for (const file of readdirSync(publicDir).sort()) {
      if (!file.endsWith('.bundle.json')) continue;
      const bundle = readJson(join(publicDir, file));
      packs.push({
        venue: file.slice(0, -'.bundle.json'.length),
        kind: 'bundle',
        basedOn: bundle?.basedOn?.map ?? null,
      });
    }
  }
  return packs;
}

/** Published bundle manifests plus the hashes of the bytes beside them. */
export function collectBundles(root = repoRoot()) {
  const publicDir = join(root, VENUES_PUBLIC);
  if (!existsSync(publicDir)) return [];
  const bundles = [];
  for (const file of readdirSync(publicDir).sort()) {
    if (!file.endsWith('.bundle.json')) continue;
    const bundle = readJson(join(publicDir, file));
    const hashByPath = new Map();
    for (const entry of bundle?.files || []) {
      const onDisk = join(publicDir, entry.path.replace(/^\/venues\//, ''));
      hashByPath.set(
        entry.path,
        existsSync(onDisk) ? createHash('sha256').update(readFileSync(onDisk)).digest('hex') : null,
      );
    }
    bundles.push({ venue: file.slice(0, -'.bundle.json'.length), bundle, hashByPath });
  }
  return bundles;
}

/**
 * The whole gate in one call: basedOn freshness over every shipped pack,
 * plus hash drift over every published bundle. `ok` is what CI asserts;
 * the rest is the explanation a failing run prints.
 */
export function checkVenueFreshness(root = repoRoot()) {
  const decision = freshnessDecision({
    truth: collectTruthStamps(root),
    packs: collectShippedPacks(root),
  });
  const drift = collectBundles(root).map(({ venue, bundle, hashByPath }) => ({
    venue,
    ...bundleDriftDecision(bundle, hashByPath),
  }));
  return {
    ok: decision.fresh && drift.every((d) => d.clean),
    decision,
    drift,
  };
}
