#!/usr/bin/env node
/**
 * Prewritten visual-comparison matrix for the reference-inspired map Skins.
 *
 * These twenty park points are fixed before Skin implementation. Every new map
 * Skin must render the same locations so visual drift is compared at gates,
 * lands, ride clusters, dining, water, and the park spine rather than at one
 * convenient screenshot.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createProgress, grantShipSkins } from '../../apps/party-tracker/lib/world.js';
import { closeGate, launch, openPhone, until } from './browser.mjs';
import { SHIP_SKIN_IDS } from '../../apps/party-tracker/lib/mapVisual.js';

export const MAP_SKIN_VISUAL_POINTS = Object.freeze([
  { id: 'main-gate', name: 'Main gate', lat: 39.34413, lng: -84.26819 },
  { id: 'international-street', name: 'International Street', lat: 39.34370, lng: -84.26720 },
  { id: 'eiffel-tower', name: 'Eiffel Tower', lat: 39.34333, lng: -84.26698 },
  { id: 'festhaus', name: 'Festhaus', lat: 39.34362, lng: -84.26598 },
  { id: 'oktoberfest', name: 'Oktoberfest', lat: 39.34313, lng: -84.26560 },
  { id: 'coney-mall-west', name: 'Coney Mall west', lat: 39.34228, lng: -84.26703 },
  { id: 'coney-mall-center', name: 'Coney Mall center', lat: 39.34220, lng: -84.26420 },
  { id: 'the-zephyr', name: 'The Zephyr', lat: 39.34220, lng: -84.26473 },
  { id: 'flight-of-fear', name: 'Flight of Fear', lat: 39.34286, lng: -84.26343 },
  { id: 'area-72', name: 'Area 72', lat: 39.34306, lng: -84.26315 },
  { id: 'backlot', name: 'Backlot Stunt Coaster', lat: 39.34231, lng: -84.26245 },
  { id: 'action-zone', name: 'Action Zone', lat: 39.34372, lng: -84.26246 },
  { id: 'delirium', name: 'Delirium', lat: 39.34420, lng: -84.26314 },
  { id: 'rivertown-west', name: 'Rivertown west', lat: 39.34086, lng: -84.26330 },
  { id: 'mystic-timbers', name: 'Mystic Timbers', lat: 39.34088, lng: -84.26157 },
  { id: 'the-beast', name: 'The Beast', lat: 39.34015, lng: -84.26603 },
  { id: 'diamondback', name: 'Diamondback', lat: 39.33975, lng: -84.26178 },
  { id: 'planet-snoopy', name: 'Planet Snoopy', lat: 39.34121, lng: -84.27025 },
  { id: 'soak-city-edge', name: 'Soak City edge', lat: 39.34680, lng: -84.26720 },
  { id: 'park-spine', name: 'Park spine', lat: 39.34280, lng: -84.26620 },
]);

const SKINS = ['layered-atlas', 'watercolor-quest'];
const OUT = process.env.VISUAL_OUT || path.join('/tmp', 'parkbound-map-skin-visual');
let activeBrowser = null;
const REFERENCE_PROFILES = {
  'layered-atlas': {
    style: 'analytical',
    ground: '#C9D6C0',
    midway: '#3F6570',
    structure: '#C9B58D',
  },
  'watercolor-quest': {
    style: 'watercolor',
    ground: '#F4EFDF',
    midway: '#756276',
    structure: '#B8A68D',
  },
};

function signature(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let hash = 2166136261;
  for (let i = 0; i < png.data.length; i += 97) {
    hash ^= png.data[i];
    hash = Math.imul(hash, 16777619);
  }
  return `${png.width}x${png.height}:${hash >>> 0}`;
}

async function seedSkin(page, skin) {
  const progress = grantShipSkins({ ...createProgress(), wearSkin: skin }, { venueId: 'kings-island' });
  const snapshot = { progress, acceptedOffer: null };
  await page.evaluate(async (blob) => {
    localStorage.setItem('parkbound.world.v1', JSON.stringify(blob));
    localStorage.setItem('parkbound-demo-skins', '1');
    await new Promise((resolve) => {
      const request = indexedDB.open('parkbound-world', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put({ id: 'current', ...blob });
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      };
      request.onerror = resolve;
    });
  }, snapshot);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await closeGate(page);
  await until(
    async () => (await page.evaluate(() => document.documentElement.dataset.skin)) === skin,
    { timeout: 30000, label: `${skin} at ${skin}` },
  );
}

async function main() {
  for (const skin of SKINS) assert.ok(SHIP_SKIN_IDS.includes(skin), `${skin} is registered as a ship Skin`);
  assert.equal(MAP_SKIN_VISUAL_POINTS.length, 20, 'visual matrix has exactly twenty points');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  activeBrowser = await launch();
  const browser = activeBrowser;
  const first = MAP_SKIN_VISUAL_POINTS[0];
  const { page, context } = await openPhone(browser, {
    lat: first.lat,
    lng: first.lng,
    name: 'Visual',
    venue: 'kings-island',
    label: first.id,
  });
  const matrix = [];
  for (const point of MAP_SKIN_VISUAL_POINTS) {
    await context.setGeolocation({ latitude: point.lat, longitude: point.lng });
    const row = { point: point.id, name: point.name, skins: {} };
    for (const skin of SKINS) {
      await seedSkin(page, skin);
      const metrics = await page.evaluate(() => ({
        skin: document.documentElement.dataset.skin,
        mapSkin: document.documentElement.dataset.skinMap,
        mapStyle: document.documentElement.dataset.skinMapStyle,
        ground: document.documentElement.style.getPropertyValue('--ground').trim(),
        midway: document.documentElement.style.getPropertyValue('--midway').trim(),
        structure: document.documentElement.style.getPropertyValue('--structure').trim(),
        isoLayers: document.querySelectorAll('.lyr-iso-map').length,
        buildings: document.querySelectorAll('.isoBuilding').length,
        coasters: document.querySelectorAll('.isoCoaster').length,
        paths: document.querySelectorAll('.mapSvg path').length,
      }));
      assert.equal(metrics.skin, skin, `${skin} is worn at ${point.id}`);
      assert.equal(metrics.mapSkin, skin, `${skin} map adapter is active at ${point.id}`);
      const profile = REFERENCE_PROFILES[skin];
      assert.equal(metrics.mapStyle, profile.style, `${skin} matches its reference visual language at ${point.id}`);
      assert.equal(metrics.ground, profile.ground, `${skin} matches reference ground tone at ${point.id}`);
      assert.equal(metrics.midway, profile.midway, `${skin} matches reference road tone at ${point.id}`);
      assert.equal(metrics.structure, profile.structure, `${skin} matches reference structure tone at ${point.id}`);
      assert.equal(metrics.isoLayers, 1, `${skin} has one Iso layer at ${point.id}`);
      assert.ok(metrics.paths > 100, `${skin} draws venue geometry at ${point.id}`);
      assert.ok(metrics.buildings > 0, `${skin} draws buildings at ${point.id}`);
      assert.ok(metrics.coasters > 0, `${skin} draws coasters at ${point.id}`);
      const file = path.join(OUT, `${skin}-${point.id}.png`);
      await page.locator('.mapWrap').screenshot({ path: file });
      row.skins[skin] = { ...metrics, file, signature: signature(file) };
    }
    assert.notEqual(
      row.skins[SKINS[0]].signature,
      row.skins[SKINS[1]].signature,
      `reference Skins differ visually at ${point.id}`,
    );
    matrix.push(row);
  }
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(matrix, null, 2));
  console.log(`map-skin-visual-points: ${matrix.length} points × ${SKINS.length} Skins: ok`);
  console.log(`screenshots: ${OUT}`);
}

main().catch((error) => {
  Promise.resolve(activeBrowser?.close())
    .finally(() => {
      console.error(error);
      process.exitCode = 1;
    });
});
