/**
 * hostService must evaluate at import time — Next prerenders /join through it.
 */
import assert from 'node:assert/strict';
import { createHostService } from '../../apps/party-tracker/lib/party/hostService.js';

assert.equal(typeof createHostService, 'function');
console.log('host-service-import: ok');
