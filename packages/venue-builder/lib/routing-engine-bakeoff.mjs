/**
 * Shared routing-engine bake-off report — pairs GraphHopper (#407) with Valhalla (#277).
 *
 * Builder-side only: compares an external engine against the shipped client A* baseline.
 */

/** Shared JSON schema version for cross-engine comparison reports. */
export const ROUTING_BAKEOFF_SCHEMA = 'routing-engine-bakeoff/1';

/** Routes within this metre delta count as agreeing. */
export const AGREEMENT_LENGTH_M = 50;

/** Routes within this percent delta count as agreeing. */
export const AGREEMENT_LENGTH_PCT = 15;

/**
 * @param {{ ok?: boolean, metres?: number|null, seconds?: number|null, ms?: number|null, error?: string }} baseline
 * @param {{ ok?: boolean, metres?: number|null, seconds?: number|null, ms?: number|null, error?: string }} engine
 */
export function compareRoutePair(baseline, engine) {
  const baseOk = Boolean(baseline?.ok && Number.isFinite(baseline.metres));
  const engineOk = Boolean(engine?.ok && Number.isFinite(engine.metres));
  if (!baseOk || !engineOk) {
    return {
      agrees: false,
      lengthDeltaM: null,
      lengthDeltaPct: null,
      baselineOk: baseOk,
      engineOk,
    };
  }
  const lengthDeltaM = Math.round((engine.metres ?? 0) - (baseline.metres ?? 0));
  const baseMetres = baseline.metres ?? 0;
  const lengthDeltaPct = baseMetres > 0
    ? Math.round((lengthDeltaM / baseMetres) * 1000) / 10
    : null;
  const agrees = Math.abs(lengthDeltaM) <= AGREEMENT_LENGTH_M
    || (lengthDeltaPct != null && Math.abs(lengthDeltaPct) <= AGREEMENT_LENGTH_PCT);
  return {
    agrees,
    lengthDeltaM,
    lengthDeltaPct,
    baselineOk: true,
    engineOk: true,
  };
}

function mean(nums) {
  const vals = nums.filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/**
 * @param {object} opts
 * @param {string} opts.venue
 * @param {string} opts.engine
 * @param {Array<{ label: string, from: { lat: number, lng: number }, to: { lat: number, lng: number } }>} opts.pairs
 * @param {Array<object>} opts.baselineRoutes
 * @param {Array<object>} opts.engineRoutes
 * @param {boolean} [opts.gap]
 * @param {string} [opts.error]
 * @param {string} [opts.fetched]
 */
export function shapeBakeoffReport({
  venue,
  engine,
  pairs = [],
  baselineRoutes = [],
  engineRoutes = [],
  gap = false,
  error,
  fetched,
} = {}) {
  const byLabel = (rows) => new Map((rows || []).map((r) => [r.label, r]));
  const baselineBy = byLabel(baselineRoutes);
  const engineBy = byLabel(engineRoutes);

  const compared = pairs.map((pair) => {
    const baseline = baselineBy.get(pair.label) || { ok: false, error: 'missing_baseline' };
    const engineRow = engineBy.get(pair.label) || { ok: false, error: 'missing_engine' };
    const agreement = compareRoutePair(baseline, engineRow);
    return {
      label: pair.label,
      from: pair.from,
      to: pair.to,
      baseline: {
        ok: Boolean(baseline.ok),
        metres: baseline.metres ?? null,
        seconds: baseline.seconds ?? null,
        ms: baseline.ms ?? null,
        error: baseline.error,
      },
      engine: {
        ok: Boolean(engineRow.ok),
        metres: engineRow.metres ?? null,
        seconds: engineRow.seconds ?? null,
        ms: engineRow.ms ?? null,
        error: engineRow.error,
      },
      agreement,
    };
  });

  const comparable = compared.filter((p) => p.agreement.baselineOk && p.agreement.engineOk);
  const agreed = comparable.filter((p) => p.agreement.agrees);
  const deltasM = comparable.map((p) => p.agreement.lengthDeltaM).filter(Number.isFinite);
  const deltasPct = comparable.map((p) => p.agreement.lengthDeltaPct).filter(Number.isFinite);

  return {
    schema: ROUTING_BAKEOFF_SCHEMA,
    venue,
    engine,
    baseline: 'client-astar',
    fetched: fetched || new Date().toISOString().slice(0, 19),
    gap: Boolean(gap),
    error: error || undefined,
    summary: {
      pairs: pairs.length,
      comparable: comparable.length,
      agreed: agreed.length,
      agreementPct: comparable.length
        ? Math.round((agreed.length / comparable.length) * 1000) / 10
        : null,
      meanLengthDeltaM: mean(deltasM),
      meanLengthDeltaPct: mean(deltasPct),
      baselineMeanMs: mean(baselineRoutes.map((r) => r.ms)),
      engineMeanMs: mean(engineRoutes.map((r) => r.ms)),
    },
    pairs: compared,
  };
}

export function renderBakeoffMarkdown(report) {
  const lines = [
    '# Routing engine bake-off',
    '',
    `- Venue: \`${report.venue}\``,
    `- Engine: **${report.engine}** vs **${report.baseline}**`,
    `- Schema: \`${report.schema}\``,
    `- Fetched: ${report.fetched}`,
  ];
  if (report.gap) {
    lines.push(`- Gap: ${report.error || 'engine unavailable'}`);
  } else {
    const s = report.summary || {};
    lines.push(
      '',
      '## Summary',
      '',
      `- Pairs: ${s.pairs ?? 0} (${s.comparable ?? 0} comparable)`,
      `- Route agreement: ${s.agreementPct ?? '—'}% (${s.agreed ?? 0}/${s.comparable ?? 0})`,
      `- Mean length delta: ${s.meanLengthDeltaM ?? '—'} m (${s.meanLengthDeltaPct ?? '—'}%)`,
      `- Mean compute: baseline ${s.baselineMeanMs ?? '—'} ms · engine ${s.engineMeanMs ?? '—'} ms`,
    );
    if (report.pairs?.length) {
      lines.push('', '| To | baseline m | engine m | Δ m | agrees | baseline ms | engine ms |', '| --- | ---: | ---: | ---: | --- | ---: | ---: |');
      for (const p of report.pairs) {
        lines.push(
          `| ${p.label} | ${p.baseline.metres ?? '—'} | ${p.engine.metres ?? '—'} | ${p.agreement.lengthDeltaM ?? '—'} | ${p.agreement.agrees ? 'yes' : 'no'} | ${p.baseline.ms ?? '—'} | ${p.engine.ms ?? '—'} |`,
        );
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}
