#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  authUiRequiresClerkE2e,
  clerkE2eBlockReason,
  clerkPublishableKeyPresent,
} from '../../scripts/lib/clerk-e2e.mjs';

assert.equal(authUiRequiresClerkE2e(['docs/agents/ci.md']), false);
assert.equal(authUiRequiresClerkE2e(['apps/party-tracker/components/OAuthButtons.jsx']), true);
assert.equal(authUiRequiresClerkE2e(['apps/party-tracker/app/sign-in/sso-callback/page.jsx']), true);

assert.equal(clerkPublishableKeyPresent({}), false);
assert.equal(clerkPublishableKeyPresent({ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x' }), true);

assert.equal(
  clerkE2eBlockReason({ files: ['apps/party-tracker/lib/core/state.js'], env: {}, skipBrowser: true }),
  null,
);
assert.match(
  clerkE2eBlockReason({
    files: ['apps/party-tracker/components/AuthGate.jsx'],
    env: {},
    skipBrowser: true,
  }),
  /do not --skip-browser/,
);
assert.match(
  clerkE2eBlockReason({
    files: ['apps/party-tracker/components/AuthGate.jsx'],
    env: {},
    skipBrowser: false,
  }),
  /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/,
);
assert.equal(
  clerkE2eBlockReason({
    files: ['apps/party-tracker/components/AuthGate.jsx'],
    env: { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x' },
    skipBrowser: false,
  }),
  null,
);

console.log('clerk-e2e.test: ok');
