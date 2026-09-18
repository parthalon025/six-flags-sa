/**
 * Summarize fleet-wide external source sync JSON for CI and operators.
 *
 * @param {Record<string, Record<string, { ok?: boolean, error?: string }>>} results
 * @returns {{ exitCode: number, markdown: string, perAdapter: Record<string, { ok: number, fail: number }> }}
 */
export function summarizeSyncResults(results) {
  const perAdapter = {};
  const venueIds = Object.keys(results || {});

  for (const venueId of venueIds) {
    for (const [adapterId, result] of Object.entries(results[venueId] || {})) {
      if (!perAdapter[adapterId]) perAdapter[adapterId] = { ok: 0, fail: 0 };
      if (result?.ok) perAdapter[adapterId].ok += 1;
      else perAdapter[adapterId].fail += 1;
    }
  }

  const adapterIds = Object.keys(perAdapter);
  const lines = ['## External source sync', ''];

  if (!venueIds.length) {
    lines.push('No venues were synced — the run is unusable.');
    return { exitCode: 1, markdown: lines.join('\n'), perAdapter };
  }

  for (const adapterId of adapterIds.sort()) {
    const { ok, fail } = perAdapter[adapterId];
    const status = ok > 0 ? 'ok' : 'fail';
    const detail = fail > 0 ? ` (${ok} ok, ${fail} fail)` : ` (${ok} ok)`;
    lines.push(`- **${adapterId}**: ${status}${detail}`);
  }

  const anySuccess = adapterIds.some((id) => perAdapter[id].ok > 0);
  const unusable = !anySuccess;
  if (unusable) {
    lines.push('', '_Every adapter failed across the fleet — sync unusable._');
  }

  return {
    exitCode: unusable ? 1 : 0,
    markdown: lines.join('\n'),
    perAdapter,
  };
}
