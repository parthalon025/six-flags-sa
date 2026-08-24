#!/usr/bin/env node
/**
 * Databricks auth seam.
 *
 *   node test/scripts/databricks-auth.test.mjs
 */
import assert from 'node:assert/strict';
import { authStatus, cliInstalled } from '../../scripts/lib/databricks-auth.mjs';

assert.equal(typeof cliInstalled(), 'boolean');

const noHost = authStatus();
if (!process.env.DATABRICKS_HOST) {
  assert.equal(noHost.ok, false);
} else {
  assert.equal(typeof noHost.ok, 'boolean');
}

console.log('databricks-auth.test.mjs: ok');
