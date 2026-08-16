#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateClerkAppleProd,
  evaluateProdPatchFile,
} from '../../scripts/lib/clerk-apple-prod.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const spec = JSON.parse(
  readFileSync(join(root, 'scripts/lib/clerk-apple-prod-spec.json'), 'utf8'),
);

const goodPull = {
  connection_oauth_apple: {
    enabled: true,
    client_id: 'ai.kurat0r.parkbound.web',
    team_id: 'CDHJC4MH4G',
    key_id: 'ZZNS5TWZ74',
    bundle_id: 'ai.kurat0r.parkbound',
    client_secret: 'REDACTED',
  },
  auth_phone: {
    required_for_sign_up: false,
    used_for_sign_up: false,
    used_for_sign_in: false,
  },
  auth_email: {
    required_for_sign_up: false,
    used_for_sign_in: false,
  },
  auth_passkey: { used_for_sign_in: false },
  user_model: {
    first_name: { required: false },
    last_name: { required: false },
  },
};

assert.deepEqual(evaluateClerkAppleProd(goodPull, spec).violations, []);

const phoneRequired = structuredClone(goodPull);
phoneRequired.auth_phone.required_for_sign_up = true;
assert.match(
  evaluateClerkAppleProd(phoneRequired, spec).violations.join('\n'),
  /auth_phone\.required_for_sign_up/,
);

const wrongClient = structuredClone(goodPull);
wrongClient.connection_oauth_apple.client_id = 'com.Kurat0r.parkbound';
assert.match(
  evaluateClerkAppleProd(wrongClient, spec).violations.join('\n'),
  /client_id/,
);

const prodPatch = JSON.parse(
  readFileSync(join(root, 'scripts/lib/clerk-parkbound-config-prod.json'), 'utf8'),
);
assert.deepEqual(evaluateProdPatchFile(prodPatch, spec).violations, []);

const revertingPatch = structuredClone(prodPatch);
revertingPatch.user_model.first_name.required = true;
assert.match(
  evaluateProdPatchFile(revertingPatch, spec).violations.join('\n'),
  /user_model\.first_name\.required/,
);

console.log('clerk-apple-prod.test: ok');
