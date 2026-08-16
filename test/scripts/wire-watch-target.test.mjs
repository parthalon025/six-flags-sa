import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/ios/wire-watch-target.mjs');
const pbx = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');

const check = spawnSync(process.execPath, [script, '--check'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(check.status, 0, check.stderr || check.stdout);

const text = fs.readFileSync(pbx, 'utf8');
assert.match(text, /ParkBoundWatch/);
assert.match(text, /Embed Watch Content/);
assert.match(text, /WatchCompassPlugin\.swift/);
assert.match(text, /ai\.kurat0r\.parkbound\.watchkitapp/);

console.log('ok wire-watch-target');
