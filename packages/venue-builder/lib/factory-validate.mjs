/**
 * Factory validation — walk a venue through the route catalog.
 *
 * Checks every Map factory and Visual factory output exists, passes freshness
 * gates (`basedOn` matches current truth per ADR-0018), and reports pass/fail
 * per stage. Operators run one command to know whether a World's factory
 * pipeline is complete and certifiable.
 *
 * Interface:
 *   validateVenue(id, opts) → { ok, venue, truthStamp, routes, summary }
 *   validateAll(opts) → validateVenue[] 
 *   renderValidationReport(doc) → markdown
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTES, resolveOutputPath } from './factory-types.mjs';
import { qaVenueRouting } from './venue-route-qa-core.mjs';
import { readSkinTemplates, tilesGatePasses } from './display-pack.mjs';
import { MONO_ROOT } from '../src/paths.mjs';

const readJsonFile = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** @typedef {'pass' | 'warn' | 'fail' | 'skip'} RouteStatus */

/**
 * Pure freshness pin check — mirrors scripts/lib/venue-freshness.mjs without
 * crossing the scripts↔venue-builder boundary.
 */
export function freshnessPin({ basedOn, current }) {
  if (!current) return { fresh: true, reason: 'venue not shipped' };
  if (!basedOn) return { fresh: false, reason: 'missing basedOn stamp' };
  if (basedOn !== current) return { fresh: false, reason: `stale: pinned ${basedOn}, current ${current}` };
  return { fresh: true, reason: 'pins current truth' };
}

function truthStampFor(venueId, root) {
  const manifest = readJsonFile(path.join(root, 'apps', 'party-tracker', 'public', 'venues', 'manifest.json'));
  const row = manifest?.venues?.find((v) => v.id === venueId);
  return row?.generated ?? null;
}

function activeSkinIds() {
  const templates = readSkinTemplates();
  return Object.keys(templates).filter((id) => templates[id].status === 'active');
}

/** Skins compiled for this venue — on-disk specs, not every globally active Skin. */
function skinsForVenue(venueId, root) {
  const displayDir = path.join(root, 'packages', 'venue-builder', 'data', 'venues', venueId, 'display');
  if (!existsSync(displayDir)) return activeSkinIds();
  const onDisk = readdirSync(displayDir)
    .filter((f) => f.endsWith('.visual.json'))
    .map((f) => f.slice(0, -'.visual.json'.length))
    .sort();
  return onDisk.length ? onDisk : activeSkinIds();
}

function skinsWithBakeKits() {
  const templates = readSkinTemplates();
  return Object.keys(templates).filter((id) => templates[id].bakeKit);
}

function skinsWithPublishedWorlds(venueId, root) {
  const pubDir = path.join(root, 'apps', 'party-tracker', 'public', 'venues', venueId, 'display');
  if (!existsSync(pubDir)) return [];
  return readdirSync(pubDir)
    .filter((f) => f.endsWith('.world.png'))
    .map((f) => f.slice(0, -'.world.png'.length));
}

function routeResult(route, partial) {
  return {
    id: route.id,
    factory: route.factory,
    requirement: route.requirement,
    ...partial,
  };
}

function finalizeStatus(route, { pass, warn, detail, outputs = [] }) {
  let status = /** @type {RouteStatus} */ ('pass');
  if (!pass) {
    status = route.requirement === 'required' ? 'fail' : route.requirement === 'warn' ? 'warn' : 'skip';
  } else if (warn) {
    status = 'warn';
  }
  return routeResult(route, { status, detail, outputs });
}

function validateMapTruth(venueId, route, root) {
  const outputs = route.outputs
    .filter((o) => o.kind !== 'stamp')
    .map((o) => {
      const file = resolveOutputPath(o, { venueId, root });
      return { id: o.id, path: file, exists: existsSync(file) };
    });
  const missing = outputs.filter((o) => !o.exists);
  const mapFile = resolveOutputPath(
    route.outputs.find((o) => o.id === 'map'),
    { venueId, root },
  );
  const map = readJsonFile(mapFile);
  const stamp = map?.meta?.generated ?? null;
  const pass = missing.length === 0 && Boolean(stamp);
  return finalizeStatus(route, {
    pass,
    detail: missing.length
      ? `missing: ${missing.map((m) => m.id).join(', ')}`
      : `truth stamp ${stamp}`,
    outputs: [...outputs, { id: 'truth-stamp', value: stamp }],
  });
}

function validateMapCertify(venueId, route, root) {
  const certOut = route.outputs[0];
  const file = resolveOutputPath(certOut, { venueId, root });
  const doc = readJsonFile(file);
  if (!doc) {
    return finalizeStatus(route, { pass: false, detail: 'certification.json missing', outputs: [{ id: certOut.id, path: file, exists: false }] });
  }
  const failed = (doc.checks || []).filter((c) => !c.pass).map((c) => c.key);
  const pass = doc.certified === true;
  return finalizeStatus(route, {
    pass,
    warn: !pass && failed.length > 0,
    detail: pass
      ? 'certified'
      : `not certified (${failed.slice(0, 4).join(', ')}${failed.length > 4 ? '…' : ''})`,
    outputs: [{ id: certOut.id, path: file, exists: true, certified: doc.certified }],
  });
}

function validateMapRouteQa(venueId, route) {
  const qa = qaVenueRouting(venueId);
  return finalizeStatus(route, {
    pass: qa.pass,
    detail: `${qa.components} component(s), ${qa.ridesFarFromNetwork} ride(s) >35 m from network`,
    outputs: [{ id: 'route-qa', pass: qa.pass }],
  });
}

function validateVisualTerrain(venueId, route, root) {
  const out = route.outputs[0];
  const file = resolveOutputPath(out, { venueId, root });
  const exists = existsSync(file);
  return finalizeStatus(route, {
    pass: true,
    warn: !exists,
    detail: exists ? 'hillshade on disk' : 'no DEM coverage — venue renders flat (recorded)',
    outputs: [{ id: out.id, path: file, exists }],
  });
}

function validateVisualDisplayPack(venueId, route, root, truthStamp) {
  const skins = skinsForVenue(venueId, root);
  const outputs = [];
  const stale = [];
  for (const skinId of skins) {
    for (const template of route.outputs) {
      const file = resolveOutputPath(template, { venueId, skinId, root });
      const exists = existsSync(file);
      outputs.push({ id: `${skinId}.${template.id}`, path: file, exists });
      if (template.id === 'visual-spec' && exists) {
        const spec = readJsonFile(file);
        const pin = freshnessPin({ basedOn: spec?.basedOn?.map ?? null, current: truthStamp });
        if (!pin.fresh) stale.push({ skinId, ...pin });
      }
    }
  }
  const missing = outputs.filter((o) => !o.exists);
  const pass = missing.length === 0 && stale.length === 0;
  let detail = `${skins.length} active skin(s)`;
  if (missing.length) detail += `; missing ${missing.length} file(s)`;
  if (stale.length) detail += `; stale basedOn: ${stale.map((s) => s.skinId).join(', ')}`;
  return finalizeStatus(route, {
    pass,
    detail,
    outputs,
  });
}

function validateVisualTiles(venueId, route, root) {
  const out = route.outputs[0];
  const file = resolveOutputPath(out, { venueId, root });
  const exists = existsSync(file);
  const certFile = path.join(root, 'packages', 'venue-builder', 'data', 'venues', venueId, 'display', 'display-certification.json');
  const cert = readJsonFile(certFile);
  const tilesCheck = (cert?.checks || []).find((c) => c.key === 'tiles');
  const gapOk = Boolean(tilesCheck?.pass) === false
    && typeof tilesCheck?.evidence === 'string'
    && /gap|not installed|not found|recorded/i.test(tilesCheck.evidence);
  const sizeKb = exists ? Math.round(readFileSync(file).length / 1024) : 0;
  const pass = tilesGatePasses({ ok: exists, gap: gapOk, sizeKb });
  return finalizeStatus(route, {
    pass,
    warn: !exists && gapOk,
    detail: exists
      ? `base.pmtiles ${sizeKb} KB`
      : gapOk
        ? `recorded gap: ${tilesCheck?.evidence || 'tiler absent'}`
        : 'base.pmtiles missing with no recorded gap',
    outputs: [{ id: out.id, path: file, exists }],
  });
}

function validateVisualBake(venueId, route, root) {
  const bakeSkins = skinsWithBakeKits();
  if (!bakeSkins.length) {
    return finalizeStatus(route, { pass: true, detail: 'no active skins claim a bake kit', outputs: [] });
  }
  const outputs = bakeSkins.map((skinId) => {
    const file = resolveOutputPath(route.outputs[0], { venueId, skinId, root });
    return { id: skinId, path: file, exists: existsSync(file) };
  });
  const built = outputs.filter((o) => o.exists);
  const pass = built.length > 0;
  return finalizeStatus(route, {
    pass,
    warn: built.length < bakeSkins.length,
    detail: `${built.length}/${bakeSkins.length} bake-kit skin(s) have world images`,
    outputs,
  });
}

function validateVisualDisplayCertify(venueId, route, root) {
  const out = route.outputs[0];
  const file = resolveOutputPath(out, { venueId, root });
  const doc = readJsonFile(file);
  if (!doc) {
    return finalizeStatus(route, { pass: false, detail: 'display-certification.json missing', outputs: [{ id: out.id, exists: false }] });
  }
  return finalizeStatus(route, {
    pass: doc.certified === true,
    detail: doc.certified ? 'display certified' : 'display certification failed',
    outputs: [{ id: out.id, path: file, exists: true, certified: doc.certified }],
  });
}

function validateVisualPublish(venueId, route, root) {
  const published = skinsWithPublishedWorlds(venueId, root);
  const displayDir = path.join(root, 'packages', 'venue-builder', 'data', 'venues', venueId, 'display');
  const builderWorlds = existsSync(displayDir)
    ? readdirSync(displayDir).filter((f) => f.endsWith('.world.png')).map((f) => f.slice(0, -'.world.png'.length))
    : [];
  if (!builderWorlds.length) {
    return finalizeStatus(route, { pass: true, detail: 'no baked worlds in the pack yet', outputs: [] });
  }
  const missing = builderWorlds.filter((id) => !published.includes(id));
  const pass = missing.length === 0;
  return finalizeStatus(route, {
    pass,
    warn: missing.length > 0,
    detail: published.length
      ? `${published.length}/${builderWorlds.length} pack world(s) published (${published.join(', ')})`
      : 'no worlds published yet',
    outputs: builderWorlds.map((id) => ({ id, published: published.includes(id) })),
  });
}

function validateDeliveryBundle(venueId, route, root, truthStamp) {
  const out = route.outputs[0];
  const file = resolveOutputPath(out, { venueId, root });
  const doc = readJsonFile(file);
  if (!doc) {
    return finalizeStatus(route, { pass: false, detail: 'bundle manifest missing', outputs: [{ id: out.id, exists: false }] });
  }
  const pin = freshnessPin({ basedOn: doc?.basedOn?.map ?? null, current: truthStamp });
  return finalizeStatus(route, {
    pass: pin.fresh,
    detail: pin.reason,
    outputs: [{ id: out.id, path: file, exists: true, basedOn: doc?.basedOn?.map ?? null }],
  });
}

const VALIDATORS = {
  'map.truth': validateMapTruth,
  'map.certify': validateMapCertify,
  'map.route-qa': validateMapRouteQa,
  'visual.terrain': validateVisualTerrain,
  'visual.display-pack': validateVisualDisplayPack,
  'visual.tiles': validateVisualTiles,
  'visual.bake': validateVisualBake,
  'visual.display-certify': validateVisualDisplayCertify,
  'visual.publish': validateVisualPublish,
  'delivery.bundle': validateDeliveryBundle,
};

/**
 * Validate one venue against every factory route.
 *
 * @param {string} venueId
 * @param {{ root?: string, routes?: import('./factory-types.mjs').RouteEntry[] }} [opts]
 */
export function validateVenue(venueId, opts = {}) {
  const root = opts.root || MONO_ROOT;
  const truthStamp = truthStampFor(venueId, root);
  const routes = (opts.routes || ROUTES).map((route) => {
    const fn = VALIDATORS[route.id];
    if (!fn) {
      return routeResult(route, { status: 'skip', detail: 'no validator wired' });
    }
    if (route.id === 'map.route-qa') return fn(venueId, route);
    if (route.id === 'visual.display-pack' || route.id === 'delivery.bundle') {
      return fn(venueId, route, root, truthStamp);
    }
    return fn(venueId, route, root);
  });

  const summary = {
    pass: routes.filter((r) => r.status === 'pass').length,
    warn: routes.filter((r) => r.status === 'warn').length,
    fail: routes.filter((r) => r.status === 'fail').length,
    skip: routes.filter((r) => r.status === 'skip').length,
  };
  const ok = summary.fail === 0;

  return { ok, venue: venueId, truthStamp, routes, summary };
}

/** Validate every venue in the shipped manifest. */
export function validateAll(opts = {}) {
  const root = opts.root || MONO_ROOT;
  const manifest = readJsonFile(path.join(root, 'apps', 'party-tracker', 'public', 'venues', 'manifest.json'));
  return (manifest?.venues || []).map((v) => validateVenue(v.id, { ...opts, root }));
}

export function renderValidationReport(doc) {
  const lines = [
    `# Factory validation — ${doc.venue}`,
    '',
    doc.ok ? '**Pass** (no required-stage failures)' : '**Fail**',
    `Truth stamp: \`${doc.truthStamp ?? '—'}\``,
    '',
    '| Route | Factory | Status | Detail |',
    '| --- | --- | :-: | --- |',
  ];
  for (const r of doc.routes) {
    const mark = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : r.status === 'fail' ? '❌' : '⏭';
    lines.push(`| ${r.id} | ${r.factory} | ${mark} | ${r.detail} |`);
  }
  lines.push('', `==== ${doc.summary.pass} pass, ${doc.summary.warn} warn, ${doc.summary.fail} fail ====`);
  return lines.join('\n');
}
