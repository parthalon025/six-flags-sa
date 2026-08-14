#!/usr/bin/env node
/**
 * Generate the Android upload keystore and print what is still owed to Apple
 * and Google. Run from the repo root:
 *
 *   npm run store:prepare
 *
 * Does not need paid developer accounts. After you enroll, copy .env.example
 * → .env, drop Firebase plists into the native projects, set IOS_TEAM_ID and
 * ANDROID_CERT_SHA256 on Vercel, then Fastlane can upload.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secrets = join(root, 'secrets');
const keystore = join(secrets, 'parkbound-upload.keystore');
const shaFile = join(secrets, 'android-cert-sha256.txt');
const alias = process.env.ANDROID_KEY_ALIAS || 'parkbound';

function runKeytool(args) {
  try {
    return execFileSync('keytool', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}${err.message || ''}`;
    if (/not recognized|ENOENT/i.test(out) || err.code === 'ENOENT') {
      throw new Error('keytool not found. Install a JDK (Temurin 17+) and retry.');
    }
    return `${err.stdout || ''}${err.stderr || ''}`;
  }
}

function parseSha256(text) {
  const m = String(text).match(/SHA256:\s*([0-9A-Fa-f:]+)/);
  return m ? m[1].toUpperCase() : null;
}

mkdirSync(secrets, { recursive: true });

if (!existsSync(keystore)) {
  const password = process.env.ANDROID_KEYSTORE_PASSWORD || 'parkbound-dev';
  console.log('Generating upload keystore at secrets/parkbound-upload.keystore');
  runKeytool([
    '-genkeypair',
    '-v',
    '-keystore',
    keystore,
    '-alias',
    alias,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-storepass',
    password,
    '-keypass',
    password,
    '-dname',
    'CN=Park Bound, OU=Mobile, O=Park Bound, L=Unknown, ST=Unknown, C=US',
  ]);
  writeFileSync(
    join(secrets, 'keystore.password.txt'),
    `${password}\n`,
    'utf8',
  );
  console.log('Store password written to secrets/keystore.password.txt — back this up; losing it blocks Play updates.');
} else {
  console.log('Keystore already exists at secrets/parkbound-upload.keystore');
}

const listed = runKeytool([
  '-list',
  '-v',
  '-keystore',
  keystore,
  '-alias',
  alias,
  '-storepass',
  process.env.ANDROID_KEYSTORE_PASSWORD ||
    (existsSync(join(secrets, 'keystore.password.txt'))
      ? readFileSync(join(secrets, 'keystore.password.txt'), 'utf8').trim()
      : 'parkbound-dev'),
]);
const sha = parseSha256(listed);
if (!sha) {
  console.error(listed);
  throw new Error('Could not read SHA-256 fingerprint from keytool -list');
}
writeFileSync(shaFile, `${sha}\n`, 'utf8');

const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  const password =
    process.env.ANDROID_KEYSTORE_PASSWORD ||
    (existsSync(join(secrets, 'keystore.password.txt'))
      ? readFileSync(join(secrets, 'keystore.password.txt'), 'utf8').trim()
      : 'parkbound-dev');
  let text = readFileSync(join(root, '.env.example'), 'utf8');
  text = text.replace(/^ANDROID_CERT_SHA256=.*$/m, `ANDROID_CERT_SHA256=${sha}`);
  text = text.replace(/^ANDROID_KEYSTORE_PASSWORD=.*$/m, `ANDROID_KEYSTORE_PASSWORD=${password}`);
  text = text.replace(/^ANDROID_KEY_PASSWORD=.*$/m, `ANDROID_KEY_PASSWORD=${password}`);
  writeFileSync(envPath, text, 'utf8');
  console.log('Wrote .env from .env.example with keystore password + SHA-256 (gitignored).');
}

console.log(`
Android upload cert SHA-256:
  ${sha}
Wrote secrets/android-cert-sha256.txt

After Google Play ($25) and Apple Developer ($99):

  1. Copy .env.example → .env and fill team IDs, API keys, keystore password.
  2. Create a Firebase project for ai.kurat0r.parkbound, download:
       android/app/google-services.json
       ios/App/App/GoogleService-Info.plist
  3. Set Vercel env IOS_TEAM_ID and ANDROID_CERT_SHA256 (the fingerprint above)
     so /.well-known/apple-app-site-association and assetlinks.json go live.
  4. Android (this machine): bundle exec fastlane android beta
  5. iOS (Mac or macOS CI): bundle exec fastlane ios beta

secrets/ is gitignored. Keep the keystore and password off the laptop backup.
`);
