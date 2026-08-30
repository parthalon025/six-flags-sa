#!/usr/bin/env node
/**
 * Reference profiles — the bake's output contract resolves, validates,
 * and pins its images.
 *
 *   node test/builder/display-references.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync } from 'node:fs';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\nreference profiles\n');

const {
  readReferenceProfiles, profileForKit, validateProfile,
  readReferenceImageLedger, verifyReferenceImages,
} = await import('../../packages/venue-builder/lib/display-references.mjs');

const KITS_DIR = new URL('../../packages/venue-builder/data/display/kits/', import.meta.url);

await check('every kit on disk has a profile; every profile names a real kit', () => {
  const profiles = readReferenceProfiles();
  const kits = readdirSync(KITS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  for (const kit of kits) {
    assert.ok(profileForKit(kit, profiles), `kit "${kit}" ships without an output contract`);
  }
  for (const p of Object.values(profiles)) {
    assert.ok(kits.includes(p.kit), `profile "${p.id}" names unknown kit "${p.kit}"`);
  }
  return true;
});

await check('every profile validates against the schema and image ledger', () => {
  const profiles = readReferenceProfiles();
  assert.ok(Object.keys(profiles).length >= 3, 'expected the three committed profiles');
  for (const p of Object.values(profiles)) {
    assert.deepEqual(validateProfile(p), [], `${p.id} has schema problems`);
  }
  return true;
});

await check('schema rejections fail loudly', () => {
  const base = profileForKit('rpg-overworld');
  const clone = () => JSON.parse(JSON.stringify(base));
  let p = clone();
  p.colorFamilies.lava = { anchor: '#F00', deltaE: 10 };
  assert.ok(validateProfile(p).some((x) => /unknown color family/.test(x)));
  p = clone();
  p.colorFamilies.ground.deltaE = 99;
  assert.ok(validateProfile(p).some((x) => /out of range/.test(x)));
  p = clone();
  p.structures.buildingStyle = 'hologram';
  assert.ok(validateProfile(p).some((x) => /unknown buildingStyle/.test(x)));
  p = clone();
  p.inspiration.images = ['ref-not-a-thing'];
  assert.ok(validateProfile(p).some((x) => /not in the reference-image ledger/.test(x)));
  p = clone();
  p.agentReview = [];
  assert.ok(validateProfile(p).some((x) => /agentReview/.test(x)));
  return true;
});

console.log('\nreference images\n');

await check('committed pins verify; drift is refused; hand-vendored absence reports', () => {
  const ledger = readReferenceImageLedger();
  assert.ok(ledger['ref-big-kahunas-2026']?.committed, 'the operator map is the committed anchor');
  const { problems } = verifyReferenceImages(ledger);
  assert.deepEqual(problems, [], 'no drift on any present reference');
  const tampered = JSON.parse(JSON.stringify(ledger));
  tampered['ref-big-kahunas-2026'].sha256 = '0'.repeat(64);
  assert.ok(verifyReferenceImages(tampered).problems.some((x) => /drift/.test(x)));
  const missing = {
    'ref-ghost': {
      id: 'ref-ghost', path: 'assets/reference/nope.png', sha256: '0'.repeat(64), committed: false,
    },
  };
  const r = verifyReferenceImages(missing);
  assert.deepEqual(r.problems, [], 'absent hand-vendored bytes never throw');
  assert.ok(r.reports.some((x) => /place the bytes by hand/.test(x)));
  const missingCommitted = { 'ref-ghost': { ...missing['ref-ghost'], committed: true } };
  assert.ok(verifyReferenceImages(missingCommitted).problems.some((x) => /missing/.test(x)));
  return true;
});

await check('profiles bind kits to their pinned inspirations', () => {
  const island = profileForKit('island-brochure');
  assert.ok(island.inspiration.images.includes('ref-big-kahunas-2026'));
  const rpg = profileForKit('rpg-overworld');
  assert.ok(rpg.inspiration.images.includes('ref-rpg-overworld'));
  return true;
});

await check('bands block validates overlay keys and withdrawChecks', () => {
  const base = profileForKit('rpg-overworld');
  const clone = () => JSON.parse(JSON.stringify(base));
  let p = clone();
  p.bands = { overview: { colorFamilies: { lava: { anchor: '#F00', deltaE: 10 } } } };
  assert.ok(validateProfile(p).some((x) => /unknown color family/.test(x)));
  p = clone();
  p.bands = { overview: { withdrawChecks: ['style_not_a_check'] } };
  assert.ok(validateProfile(p).some((x) => /withdrawChecks names unknown/.test(x)));
  p = clone();
  p.bands = { overview: { colorFamilies: { grass: { anchor: '#8CBE74', deltaE: 14 } } } };
  assert.deepEqual(validateProfile(p), [], 'valid overview overlay passes');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
