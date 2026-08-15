#!/usr/bin/env node
/**
 * Ensure App Store / Play metadata files from fastlane/metadata/ios/SECTIONS.md exist.
 * Identifier fields always sync from fastlane/store-identifiers.json.
 * Prose fields are created only when missing — never overwritten.
 *
 *   npm run store:scaffold-metadata
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeRoutingCoverage } from './lib/routing-app-coverage.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const metaIos = path.join(repoRoot, 'fastlane/metadata/ios');
const metaAndroid = path.join(repoRoot, 'fastlane/metadata/android/en-US');
const storePath = path.join(repoRoot, 'fastlane/store-identifiers.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${String(text).replace(/\s+$/, '')}\n`);
}

function ensureText(file, text) {
  if (fs.existsSync(file)) return false;
  writeText(file, text);
  return true;
}

const store = readJson(storePath);
const { ios, android, urls } = store;
const manifestPath = path.join(repoRoot, 'apps/party-tracker/public/venues/manifest.json');
const venues = readJson(manifestPath).venues ?? [];
writeRoutingCoverage(repoRoot, venues);

function categoryEnum(name) {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

const synced = [
  [path.join(metaIos, 'en-US/name.txt'), ios.appStoreName],
  [path.join(metaIos, 'en-US/subtitle.txt'), ios.subtitle],
  [path.join(metaIos, 'primary_category.txt'), categoryEnum(ios.primaryCategory)],
  [path.join(metaIos, 'secondary_category.txt'), categoryEnum(ios.secondaryCategory)],
  [path.join(metaIos, 'copyright.txt'), ios.copyright],
  [path.join(metaIos, 'en-US/marketing_url.txt'), urls.marketing],
  [path.join(metaIos, 'en-US/support_url.txt'), urls.support],
  [path.join(metaIos, 'en-US/privacy_url.txt'), urls.privacy],
  [path.join(metaAndroid, 'title.txt'), android.playStoreTitle],
];

for (const [file, value] of synced) {
  writeText(file, value);
}

const created = [];

if (
  ensureText(
    path.join(metaIos, 'en-US/promotional_text.txt'),
    'Drawn park maps, live Party when you split up, and on-the-ground checks that keep the map honest. Explore more. Stress less.',
  )
) {
  created.push('en-US/promotional_text.txt');
}

if (
  ensureText(
    path.join(metaIos, 'en-US/description.txt'),
    `Park Bound is a drawn map of the park you're standing in — not a generic street map with a pin dropped on the gate.

Pick a Venue. Toilets, food, and rides are Places you can open and walk to on guest paths. Height rules show who in your group can ride. After the first visit, the map and a lot of the day still work offline.

Start a Party when the family wants to stick together. Share an Invite — QR, link, or six-character code. Everyone on the roster sees Location while you're inside the park.

Explore more. Stress less.`,
  )
) {
  created.push('en-US/description.txt');
}

if (
  ensureText(
    path.join(metaIos, 'en-US/keywords.txt'),
    'theme park,map,party,navigation,family,offline,kings island,cedar point,height,restroom',
  )
) {
  created.push('en-US/keywords.txt');
}

if (
  ensureText(
    path.join(metaIos, 'en-US/release_notes.txt'),
    `First release on the App Store.

Drawn park maps for Kings Island, Six Flags Fiesta Texas, Cedar Point, and Big Kahuna's — walk guest paths, check height rules, and keep working offline after your first visit.

Explore more. Stress less.`,
  )
) {
  created.push('en-US/release_notes.txt');
}

const reviewDefaults = {
  'review_information/first_name.txt': 'Justin',
  'review_information/last_name.txt': 'McFarland',
  'review_information/email_address.txt': 'parthalon025@gmail.com',
  'review_information/notes.txt': `Park Bound loads the live web app from ${urls.marketing} inside the native Capacitor shell.

SIGN-IN: Sign-in is not required. Leave "Sign-in required" unchecked. There is no email/password account.
Guest review: tap Continue as guest → allow Location → pick Kings Island (or any shipped Venue) → walk guest paths.
Profile (optional): Sign in with Apple or Google from the startup gate or Me tab. Reviewers may use their own Apple ID.

PARTY: create or join with a six-character code, or Invite (QR/link) from Me. Location is required to finish joining.

ROUTING: in-park walking directions at shipped US venues only. Upload routing_app_coverage.geojson (one MultiPolygon).

ENCRYPTION: HTTPS/TLS only — exempt. Do not upload CCATS / export-compliance documentation.

IAP: Download is Free. Do not attach parkbound_profile_annual to this version (StoreKit Profile IAP is not in this binary). Guest map and Party-by-name stay free.

RELEASE: Manually release this version after approval.

Third-party content: drawn maps and Place data from public park sources and Contributions; we have rights to our rendered Venue outputs.

Contact parthalon025@gmail.com if anything is unclear.`,
};

for (const [rel, text] of Object.entries(reviewDefaults)) {
  if (ensureText(path.join(metaIos, rel), text)) created.push(rel);
}

const ageRatingPath = path.join(metaIos, 'age_rating.json');
if (!fs.existsSync(ageRatingPath)) {
  fs.mkdirSync(path.dirname(ageRatingPath), { recursive: true });
  fs.writeFileSync(
    ageRatingPath,
    `${JSON.stringify(
      {
        alcoholTobaccoOrDrugUseOrReferences: 'NONE',
        contests: 'NONE',
        gamblingSimulated: 'NONE',
        gunsOrOtherWeapons: 'NONE',
        horrorOrFearThemes: 'NONE',
        matureOrSuggestiveThemes: 'NONE',
        medicalOrTreatmentInformation: 'NONE',
        profanityOrCrudeHumor: 'NONE',
        sexualContentGraphicAndNudity: 'NONE',
        sexualContentOrNudity: 'NONE',
        violenceCartoonOrFantasy: 'NONE',
        violenceRealistic: 'NONE',
        violenceRealisticProlongedGraphicOrSadistic: 'NONE',
        advertising: false,
        ageAssurance: false,
        gambling: false,
        healthOrWellnessTopics: false,
        lootBox: false,
        messagingAndChat: false,
        parentalControls: false,
        unrestrictedWebAccess: true,
        userGeneratedContent: true,
        ageRatingOverrideV2: 'NONE',
        koreaAgeRatingOverride: 'NONE',
        kidsAgeBand: null,
        developerAgeRatingInfoUrl: null,
      },
      null,
      2,
    )}\n`,
  );
  created.push('age_rating.json');
}

for (const dir of [
  path.join(repoRoot, 'fastlane/screenshots/ios'),
  path.join(repoRoot, 'fastlane/screenshots/android'),
]) {
  fs.mkdirSync(dir, { recursive: true });
  const keep = path.join(dir, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
}

console.log(`store-scaffold-metadata: wrote routing coverage for ${venues.length} venue(s)`);
console.log(`store-scaffold-metadata: synced ${synced.length} identifier files from store-identifiers.json`);
if (created.length) {
  console.log(`store-scaffold-metadata: created ${created.length} missing prose/template file(s): ${created.join(', ')}`);
} else {
  console.log('store-scaffold-metadata: prose files already present (left unchanged)');
}
