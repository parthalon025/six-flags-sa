#!/usr/bin/env node
/**
 * Stamp apps/party-tracker/package.json version into Capacitor native projects.
 * Same semver fastlane reads for IOS_APP_VERSION / versionName (see fastlane/Fastfile).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(repoRoot, 'apps/party-tracker/package.json');
const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`stamp-native-version: unexpected semver ${version}`);
  process.exit(1);
}

const [major, minor, patch] = version.split('.').map((n) => Number(n) || 0);
const versionCode = major * 10_000 + minor * 100 + patch;

const androidGradle = path.join(repoRoot, 'android/app/build.gradle');
let gradle = fs.readFileSync(androidGradle, 'utf8');
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
fs.writeFileSync(androidGradle, gradle);

const iosProject = path.join(repoRoot, 'ios/App/App.xcodeproj/project.pbxproj');
let pbx = fs.readFileSync(iosProject, 'utf8');
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
fs.writeFileSync(iosProject, pbx);

const storeIds = path.join(repoRoot, 'fastlane/store-identifiers.json');
const store = JSON.parse(fs.readFileSync(storeIds, 'utf8'));
store.ios.version = version;
fs.writeFileSync(storeIds, `${JSON.stringify(store, null, 2)}\n`);

console.log(`stamp-native-version: ${version} (android versionCode ${versionCode})`);
