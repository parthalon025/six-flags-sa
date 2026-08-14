/**
 * Apple Universal Links and Android App Links for Invite.
 *
 * The store shells open https://parkbound.kurat0r.ai/join… (ADR-0005). These
 * payloads are what that host must serve at /.well-known/ so iOS and Play
 * will hand the URL to ai.kurat0r.parkbound. Team ID and the upload-key
 * fingerprint are secrets you get after paying Apple / Google — until then
 * the routes 404 rather than publishing a broken association.
 */

export const STORE_BUNDLE_ID = 'ai.kurat0r.parkbound';
export const STORE_HOST = 'parkbound.kurat0r.ai';
export const INVITE_PATHS = ['/join', '/join/*'];

/**
 * @param {{ teamId?: string, bundleId?: string }} opts
 * @returns {object | null}
 */
export function appleAppSiteAssociation({ teamId, bundleId = STORE_BUNDLE_ID } = {}) {
  const team = typeof teamId === 'string' ? teamId.trim() : '';
  if (!team) return null;
  const appID = `${team}.${bundleId}`;
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID,
          appIDs: [appID],
          paths: [...INVITE_PATHS],
          components: INVITE_PATHS.map((path) => ({ '/': path })),
        },
      ],
    },
  };
}

/**
 * @param {{ packageName?: string, sha256Fingerprints?: string[] }} opts
 * @returns {object[] | null}
 */
export function androidAssetLinks({
  packageName = STORE_BUNDLE_ID,
  sha256Fingerprints = [],
} = {}) {
  const prints = (sha256Fingerprints || [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (!prints.length) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: prints,
      },
    },
  ];
}
