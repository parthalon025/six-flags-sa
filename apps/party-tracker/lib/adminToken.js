/**
 * Token gate for operator routes (/api/metrics, traces export, consolidate export).
 * Same pattern as metrics — 404 when unconfigured in production.
 */

const TOKEN = process.env.GUEST_TRACES_TOKEN || process.env.METRICS_TOKEN;

/** @param {Request} request */
export function adminPermitted(request) {
  if (!TOKEN) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const query = new URL(request.url).searchParams.get('token') || '';
  return bearer === TOKEN || query === TOKEN;
}

export function adminTokenConfigured() {
  return Boolean(TOKEN);
}
