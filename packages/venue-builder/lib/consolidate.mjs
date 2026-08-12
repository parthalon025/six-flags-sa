/**
 * Batch consolidate (E0.5–E0.6) — graduate steward-accepted durable edits into
 * builder inputs under data/venues/<id>/, never into public/venues/*.
 *
 * Cadence (E0.6): recipe.json → consolidate.cadence = daily | weekly | manual
 * Default: weekly.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listVenuePackages, venueSidecar, readJson } from './venue-io.mjs';

export const CADENCES = Object.freeze(['daily', 'weekly', 'manual']);
export const DEFAULT_CADENCE = 'weekly';

/** Durations used only for “due today?” checks in the scheduler. */
const CADENCE_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  manual: Number.POSITIVE_INFINITY,
};

/**
 * @param {object | null} recipe
 * @returns {'daily'|'weekly'|'manual'}
 */
export function cadenceFromRecipe(recipe) {
  const raw = recipe?.consolidate?.cadence || recipe?.cadence || DEFAULT_CADENCE;
  const c = String(raw).toLowerCase();
  return CADENCES.includes(c) ? c : DEFAULT_CADENCE;
}

/**
 * @param {string} venueId
 * @returns {{ cadence: string, lastConsolidated: string | null, recipePath: string }}
 */
export function readVenueCadence(venueId) {
  const recipePath = venueSidecar(venueId, 'recipe.json');
  const recipe = readJson(recipePath, null);
  return {
    cadence: cadenceFromRecipe(recipe),
    lastConsolidated: recipe?.consolidate?.lastAt || null,
    recipePath,
  };
}

/**
 * Whether this venue should run on `now` given cadence + lastAt.
 * Manual venues are never due on a schedule (steward must pass --force).
 */
export function isDue({ cadence, lastConsolidated }, now = Date.now(), { force = false } = {}) {
  if (force) return true;
  if (cadence === 'manual') return false;
  if (!lastConsolidated) return true;
  const last = Date.parse(lastConsolidated);
  if (Number.isNaN(last)) return true;
  const window = CADENCE_MS[cadence] ?? CADENCE_MS.weekly;
  return now - last >= window;
}

/**
 * Accepted durable contribution → patch plan.
 * Supported kinds:
 *   - height_rule: payload { placeName|placeId, min?, alone?, max?, note? }
 *   - poi_patch:   payload { placeName, patch: { …poi fields } }
 *   - drop_place:  payload { placeName }
 * Ephemeral kinds (experience, queue_band, ride_status) are skipped.
 */
export function planContribution(contribution) {
  if (!contribution || contribution.status !== 'accepted') {
    return { action: 'skip', reason: 'not-accepted' };
  }
  const kind = contribution.kind;
  const venueId = contribution.venueId;
  if (!venueId) return { action: 'skip', reason: 'no-venue' };

  if (kind === 'height_rule') {
    const name = contribution.payload?.placeName || contribution.placeId;
    if (!name) return { action: 'skip', reason: 'no-place' };
    const h = {
      min: contribution.payload?.min ?? contribution.payload?.h?.min ?? null,
      alone: contribution.payload?.alone ?? contribution.payload?.h?.alone ?? null,
      max: contribution.payload?.max ?? contribution.payload?.h?.max ?? null,
    };
    return {
      action: 'heights',
      venueId,
      placeName: name,
      rule: {
        h,
        note: contribution.payload?.note || undefined,
        evidence: [
          {
            source: 'guest_confirm',
            date: (contribution.createdAt || new Date().toISOString()).slice(0, 10),
            note: `consolidated from ${contribution.id || 'contribution'}`,
          },
        ],
      },
      contributionId: contribution.id,
    };
  }

  if (kind === 'poi_patch') {
    const name = contribution.payload?.placeName || contribution.placeId;
    if (!name || !contribution.payload?.patch) return { action: 'skip', reason: 'bad-poi-patch' };
    return {
      action: 'overrides-pois',
      venueId,
      placeName: name,
      patch: contribution.payload.patch,
      contributionId: contribution.id,
    };
  }

  if (kind === 'drop_place') {
    const name = contribution.payload?.placeName || contribution.placeId;
    if (!name) return { action: 'skip', reason: 'no-place' };
    return { action: 'overrides-drop', venueId, placeName: name, contributionId: contribution.id };
  }

  return { action: 'skip', reason: `ephemeral-or-unknown:${kind}` };
}

function assertBuilderInputPath(filePath) {
  const norm = path.normalize(filePath);
  if (norm.includes(`${path.sep}public${path.sep}venues`) || /[/\\]public[/\\]venues[/\\]/.test(norm)) {
    throw new Error(`Consolidate must never write public/venues (refused: ${filePath})`);
  }
  if (!norm.includes(`${path.sep}data${path.sep}venues`) && !norm.includes('/data/venues/')) {
    throw new Error(`Consolidate writes only data/venues inputs (refused: ${filePath})`);
  }
}

/**
 * Apply planned ops into in-memory override/heights docs.
 * @returns {{ heightsTouched: Set<string>, overridesTouched: Set<string>, applied: object[] }}
 */
export function mergePlans(plans, { readHeights, readOverrides }) {
  const heightsCache = new Map();
  const overridesCache = new Map();
  const heightsTouched = new Set();
  const overridesTouched = new Set();
  const applied = [];

  for (const plan of plans) {
    if (!plan || plan.action === 'skip') continue;
    const { venueId } = plan;

    if (plan.action === 'heights') {
      if (!heightsCache.has(venueId)) {
        heightsCache.set(
          venueId,
          readHeights(venueId) || {
            version: 1,
            venue: venueId,
            publish_at: 'moderate',
            rules: {},
          },
        );
      }
      const doc = heightsCache.get(venueId);
      doc.rules = doc.rules || {};
      const prev = doc.rules[plan.placeName] || {};
      doc.rules[plan.placeName] = {
        ...prev,
        h: { ...(prev.h || {}), ...plan.rule.h },
        ...(plan.rule.note ? { note: plan.rule.note } : {}),
        evidence: [...(prev.evidence || []), ...(plan.rule.evidence || [])],
      };
      heightsTouched.add(venueId);
      applied.push(plan);
      continue;
    }

    if (plan.action === 'overrides-pois' || plan.action === 'overrides-drop') {
      if (!overridesCache.has(venueId)) {
        overridesCache.set(venueId, readOverrides(venueId) || { pois: {}, drop: [] });
      }
      const doc = overridesCache.get(venueId);
      if (plan.action === 'overrides-pois') {
        doc.pois = doc.pois || {};
        doc.pois[plan.placeName] = { ...(doc.pois[plan.placeName] || {}), ...plan.patch };
      } else {
        doc.drop = Array.from(new Set([...(doc.drop || []), plan.placeName]));
      }
      overridesTouched.add(venueId);
      applied.push(plan);
    }
  }

  return { heightsCache, overridesCache, heightsTouched, overridesTouched, applied };
}

/**
 * Run consolidate for a queue of contributions.
 */
export function consolidate({
  contributions = [],
  venueIds = null,
  now = Date.now(),
  force = false,
  apply = false,
  writeFile = writeFileSync,
  readHeights = (id) => readJson(venueSidecar(id, 'heights.json'), null),
  readOverrides = (id) => readJson(venueSidecar(id, 'overrides.json'), null),
  readRecipe = (id) => readJson(venueSidecar(id, 'recipe.json'), null),
} = {}) {
  const packages = venueIds || listVenuePackages();
  const due = [];
  const skippedCadence = [];

  for (const id of packages) {
    const meta = {
      cadence: cadenceFromRecipe(readRecipe(id)),
      lastConsolidated: readRecipe(id)?.consolidate?.lastAt || null,
    };
    if (isDue(meta, now, { force })) due.push({ id, ...meta });
    else skippedCadence.push({ id, ...meta });
  }

  const dueSet = new Set(due.map((d) => d.id));
  const plans = contributions
    .map(planContribution)
    .filter((p) => p.action !== 'skip' && dueSet.has(p.venueId));

  const skipped = contributions
    .map(planContribution)
    .filter((p) => p.action === 'skip' || !dueSet.has(p.venueId));

  const merged = mergePlans(plans, { readHeights, readOverrides });
  const writes = [];

  if (apply) {
    for (const id of merged.heightsTouched) {
      const file = venueSidecar(id, 'heights.json');
      assertBuilderInputPath(file);
      const doc = merged.heightsCache.get(id);
      doc.generated = new Date(now).toISOString().slice(0, 10);
      writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
      writes.push(file);
    }
    for (const id of merged.overridesTouched) {
      const file = venueSidecar(id, 'overrides.json');
      assertBuilderInputPath(file);
      writeFile(file, `${JSON.stringify(merged.overridesCache.get(id), null, 2)}\n`);
      writes.push(file);
    }
    for (const id of new Set([...merged.heightsTouched, ...merged.overridesTouched])) {
      const recipePath = venueSidecar(id, 'recipe.json');
      assertBuilderInputPath(recipePath);
      const recipe = readRecipe(id) || { id };
      recipe.consolidate = {
        ...(recipe.consolidate || {}),
        cadence: cadenceFromRecipe(recipe),
        lastAt: new Date(now).toISOString(),
      };
      writeFile(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
      writes.push(recipePath);
    }
  }

  return {
    apply,
    due: due.map((d) => d.id),
    skippedCadence: skippedCadence.map((s) => s.id),
    applied: merged.applied,
    skipped,
    writes,
    next: apply && merged.applied.length
      ? ['npm run venues:overrides -- <id>', 'Never hand-edit public/venues']
      : [],
  };
}

export function loadContributionQueue(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.contributions)) return raw.contributions;
  return [];
}

/** Ensure a directory exists for steward drop queues. */
export function ensureQueueDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}
