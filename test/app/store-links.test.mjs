#!/usr/bin/env node
/**
 * Invite Universal Links / App Links payloads (ADR-0005).
 *
 *   node test/app/store-links.test.mjs
 */
import assert from 'node:assert/strict';
import {
  androidAssetLinks,
  appleAppSiteAssociation,
} from '../../apps/party-tracker/lib/storeLinks.js';

assert.equal(appleAppSiteAssociation({ teamId: '' }), null);
assert.equal(appleAppSiteAssociation({}), null);

assert.deepEqual(
  appleAppSiteAssociation({ teamId: 'ABCD123456', bundleId: 'com.parkbound.app' }),
  {
    applinks: {
      apps: [],
      details: [
        {
          appID: 'ABCD123456.com.parkbound.app',
          appIDs: ['ABCD123456.com.parkbound.app'],
          paths: ['/join', '/join/*'],
          components: [{ '/': '/join' }, { '/': '/join/*' }],
        },
      ],
    },
  },
);

assert.equal(androidAssetLinks({ sha256Fingerprints: [] }), null);
assert.equal(androidAssetLinks({}), null);

assert.deepEqual(
  androidAssetLinks({
    packageName: 'com.parkbound.app',
    sha256Fingerprints: ['AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'],
  }),
  [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.parkbound.app',
        sha256_cert_fingerprints: [
          'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
        ],
      },
    },
  ],
);

{
  const { default: nextConfig } = await import('../../apps/party-tracker/next.config.mjs');
  const rows = await nextConfig.headers();
  const policy = rows
    .flatMap((row) => row.headers)
    .find((h) => h.key === 'Permissions-Policy')?.value;
  assert.equal(
    policy,
    'geolocation=(self), camera=(self), microphone=(), payment=()',
  );
}

console.log('store-links.test.mjs ok');
