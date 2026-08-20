/**
 * Attribution/credits generator — pure decision logic.
 *
 * Single source of truth: scripts/lib/credits-registry.json (`sources`, every
 * content/data source actually wired into shipped output, plus `vendorLedgers`
 * describing how to group the Display-factory vendor asset files under one of
 * those sources).
 *
 * Generated outputs (scripts/credits-build.mjs writes these; never hand-edit):
 *   - NOTICE.md (repo root)
 *   - apps/party-tracker/data/credits.json
 *
 * Scripts-over-instructions: this module is the policy. AGENTS.md/CLAUDE.md
 * hold none of this logic — see docs/agents/policies/scripts-over-instructions.md.
 */

export const ROLE_ORDER = ['map data', 'imagery & terrain', 'art & materials', 'software'];

export const ROLE_LABELS = {
  'map data': 'Map data',
  'imagery & terrain': 'Imagery & terrain',
  'art & materials': 'Art & materials',
  software: 'Software',
};

const ATTRIBUTION_MODES = new Set(['none', 'credits-screen', 'on-map']);

/**
 * Parse an `attribution` field into { mode, placement }.
 * `placed-link:<where>` splits into mode "placed-link" and that placement
 * string; the three bare modes carry a null placement.
 * @param {string} raw
 * @param {string} rowId
 */
export function parseAttributionMode(raw, rowId = '(unknown)') {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`credits: registry row "${rowId}" is missing an attribution mode`);
  }
  if (raw.startsWith('placed-link:')) {
    const placement = raw.slice('placed-link:'.length).trim();
    if (!placement) {
      throw new Error(`credits: registry row "${rowId}" has "placed-link:" with no placement`);
    }
    return { mode: 'placed-link', placement };
  }
  if (!ATTRIBUTION_MODES.has(raw)) {
    throw new Error(
      `credits: registry row "${rowId}" has unknown attribution mode "${raw}" — expected one of ` +
        `none, credits-screen, on-map, or placed-link:<where>`,
    );
  }
  return { mode: raw, placement: null };
}

/**
 * Group Display-factory vendor asset files into ledger summaries, per the
 * registry's `vendorLedgers` match specs.
 *
 * @param {Array<{sourceId:string,file:string,match:object}>} vendorLedgers
 * @param {Record<string, any>} files - map of `file` path (as named in each
 *   vendorLedgers entry) to the parsed JSON content of that file.
 * @returns {Array<{sourceId:string,count:number,kindLabel:string}>}
 */
export function computeVendorLedgers(vendorLedgers = [], files = {}) {
  const ledgers = [];
  for (const spec of vendorLedgers) {
    const data = files[spec.file];
    if (!data) continue; // file not supplied — caller may be testing a subset
    const { field, kind, urlIncludes, sourceIncludes, isArray } = spec.match;
    const collection = data[field];
    const rows = isArray ? collection || [] : Object.values(collection || {});
    const matched = rows.filter((row) => {
      if (row.license === 'original') return false;
      if (kind && row.kind !== kind) return false;
      if (urlIncludes && !String(row?.source?.url || '').includes(urlIncludes)) return false;
      if (sourceIncludes && !String(row?.source || '').includes(sourceIncludes)) return false;
      return true;
    });
    if (!matched.length) continue;
    const kindLabel = kind === 'tilesheet' ? 'tilesheet packs' : 'material sets';
    ledgers.push({ sourceId: spec.sourceId, count: matched.length, kindLabel });
  }
  return ledgers;
}

function groupByRole(rows) {
  const byRole = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      throw new Error('credits: registry row must be an object');
    }
    if (!row.id || !row.name) {
      throw new Error(`credits: registry row is missing id or name (got ${JSON.stringify(row)})`);
    }
    if (!ROLE_ORDER.includes(row.role)) {
      throw new Error(
        `credits: registry row "${row.id}" has unknown role "${row.role}" — expected one of ${ROLE_ORDER.join(', ')}`,
      );
    }
    const { mode, placement } = parseAttributionMode(row.attribution, row.id);
    const list = byRole.get(row.role) || [];
    list.push({ ...row, attributionMode: mode, placement });
    byRole.set(row.role, list);
  }
  return byRole;
}

/**
 * Merge the registry with computed vendor ledgers into the two generated
 * artifacts: NOTICE.md text and the app's credits.json shape.
 *
 * @param {{registry: object[], ledgers?: object[], overarchingNote?: string}} args
 */
export function buildCredits({ registry, ledgers = [], overarchingNote } = {}) {
  if (!Array.isArray(registry) || !registry.length) {
    throw new Error('credits: registry must be a non-empty array');
  }
  const byRole = groupByRole(registry);
  const byId = new Map(registry.map((r) => [r.id, r]));

  for (const ledger of ledgers) {
    if (!byId.has(ledger.sourceId)) {
      throw new Error(
        `credits: vendor ledger references unknown registry id "${ledger.sourceId}"`,
      );
    }
  }
  const ledgerById = new Map(ledgers.map((l) => [l.sourceId, l]));

  const groups = [];
  for (const role of ROLE_ORDER) {
    const rows = byRole.get(role);
    if (!rows || !rows.length) continue;
    const items = rows.map((row) => {
      const ledger = ledgerById.get(row.id);
      const item = {
        id: row.id,
        name: row.name,
        license: row.license,
        url: row.url,
        attribution: row.attributionMode,
      };
      if (row.placement) item.placement = row.placement;
      if (row.credit) item.credit = row.credit;
      if (row.note) item.note = row.note;
      if (ledger) item.detail = `${ledger.count} ${ledger.kindLabel} (${row.license})`;
      return item;
    });
    groups.push({ role, label: ROLE_LABELS[role], items });
  }

  const note =
    overarchingNote || 'Portions of this app derive from third-party sources under their own licenses.';

  const appCredits = {
    generatedBy: 'npm run credits:build — scripts/credits-build.mjs',
    overarchingNote: note,
    groups,
  };

  const noticeLines = [
    '# NOTICE',
    '',
    'This file is generated by `npm run credits:build` (`scripts/credits-build.mjs`,',
    'from `scripts/lib/credits-registry.json`). Do not hand-edit it — edit the',
    'registry and rebuild.',
    '',
    note,
    '',
  ];
  for (const group of groups) {
    noticeLines.push(`## ${group.label}`, '');
    for (const item of group.items) {
      const bits = [`- **${item.name}** — ${item.license}`];
      if (item.detail) bits.push(`(${item.detail})`);
      bits.push(`— ${item.url}`);
      noticeLines.push(bits.join(' '));
      if (item.credit) noticeLines.push(`  Credit line: "${item.credit}"`);
    }
    noticeLines.push('');
  }
  const notice = `${noticeLines.join('\n').trimEnd()}\n`;

  return { notice, appCredits };
}
