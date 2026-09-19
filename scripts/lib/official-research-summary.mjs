/**
 * Summarize fleet-wide official site research JSON for CI and operators.
 *
 * @param {Array<{ venue?: { id?: string }, official?: { siteCount?: number, errors?: string[], pages?: Array<{ via?: string }> } }>} packets
 * @returns {{ exitCode: number, markdown: string, perVenue: Record<string, { ok: boolean, browser: boolean }> }}
 */
export function summarizeOfficialResearchResults(packets) {
  const rows = Array.isArray(packets) ? packets : [];
  const perVenue = {};
  const lines = ['## Official site research', ''];

  if (!rows.length) {
    lines.push('No venues were researched — the run is unusable.');
    return { exitCode: 1, markdown: lines.join('\n'), perVenue };
  }

  for (const packet of rows) {
    const id = packet?.venue?.id || 'unknown';
    const official = packet?.official || {};
    const siteCount = official.siteCount ?? 0;
    const errors = official.errors?.length ?? 0;
    const browser = (official.pages || []).some((p) => p.via === 'browser');
    const ok = siteCount > 0;
    perVenue[id] = { ok, browser };

    const status = ok ? 'ok' : 'fail';
    const detail = [
      siteCount ? `${siteCount} listing(s)` : 'no listings',
      browser ? 'browser' : 'fetch only',
      errors ? `${errors} error(s)` : null,
    ].filter(Boolean).join(', ');
    lines.push(`- **${id}**: ${status} (${detail})`);
  }

  const anySuccess = Object.values(perVenue).some((v) => v.ok);
  const browserUsed = Object.values(perVenue).some((v) => v.browser);
  if (browserUsed) {
    lines.push('', '_Playwright browser fetch was used for at least one venue._');
  } else if (anySuccess) {
    lines.push('', '_No venue used Playwright browser fetch — all listings were fetch-only._');
  }

  if (!anySuccess) {
    lines.push('', '_Every venue failed to fetch official listings — research unusable._');
  }

  return {
    exitCode: anySuccess ? 0 : 1,
    markdown: lines.join('\n'),
    perVenue,
  };
}
