#!/usr/bin/env node
/**
 * Lakebase config seam — migration order + env parsing.
 *
 *   node test/scripts/lakebase-config.test.mjs
 */
import assert from 'node:assert/strict';
import {
  lakebaseFromEnv,
  migrationFiles,
  migrationPath,
} from '../../scripts/lib/lakebase-config.mjs';

const files = migrationFiles();
assert.ok(files.includes('001_profiles_contributions.sql'));
assert.ok(files.includes('004_postdb_factory_artifacts.sql'));
assert.equal(files[0], '001_profiles_contributions.sql');
assert.ok(migrationPath('001_profiles_contributions.sql').endsWith('db/migrations/001_profiles_contributions.sql'));

const parsed = lakebaseFromEnv({
  LAKEBASE_PG_HOST: 'ep-test.database.us-east-2.cloud.databricks.com',
  LAKEBASE_PG_USER: 'user@example.com',
  LAKEBASE_DATA_API_URL: 'https://example/rest/databricks_postgres',
  LAKEBASE_ENDPOINT: 'projects/p/branches/b/endpoints/e',
});
assert.equal(parsed.host, 'ep-test.database.us-east-2.cloud.databricks.com');
assert.equal(parsed.user, 'user@example.com');
assert.equal(parsed.database, 'databricks_postgres');
assert.equal(parsed.dataApiUrl, 'https://example/rest/databricks_postgres');
assert.equal(parsed.endpoint, 'projects/p/branches/b/endpoints/e');

console.log('lakebase-config.test.mjs: ok');
