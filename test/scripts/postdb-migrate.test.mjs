#!/usr/bin/env node
/**
 * PostDB migrate seam — migration apply order (no database).
 *
 *   node test/scripts/postdb-migrate.test.mjs
 */
import assert from 'node:assert/strict';
import { orderedMigrationFiles } from '../../scripts/postdb-migrate.mjs';
import { migrationFiles } from '../../scripts/lib/lakebase-config.mjs';

const files = orderedMigrationFiles();
assert.deepEqual(files, migrationFiles());
assert.equal(files[0], '001_profiles_contributions.sql');
assert.ok(files.includes('004_postdb_factory_artifacts.sql'));
assert.ok(
  files.indexOf('004_postdb_factory_artifacts.sql') > files.indexOf('001_profiles_contributions.sql'),
  '004 runs after 001',
);

console.log('postdb-migrate.test.mjs: ok');
