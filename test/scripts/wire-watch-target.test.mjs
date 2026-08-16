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
assert.match(
  text,
  /9592DBEFFC6D2A0C8D5DEB22 \/\* \[CP\] Embed Pods Frameworks \*\/,\s+A7WATCH00000000000000014 \/\* Embed Watch Content \*\//,
);
assert.match(text, /dependencies = \(\s+A7WATCH00000000000000017 \/\* PBXTargetDependency \*\//);
assert.match(
  text,
  /targets = \(\s+504EC3031FED79650016851F \/\* App \*\/,\s+A7WATCH00000000000000002 \/\* ParkBoundWatch \*\//,
);
console.log('ok wire-watch-target');
