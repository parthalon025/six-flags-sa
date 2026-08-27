/**
 * Operating stack — owner canon for PostDB + Delivery vendors (2026-08-25).
 *
 * Narrative: docs/research/2026-08-25-free-tier-databricks-vs-postgres.md
 * ADR: docs/adr/0024-postdb-factory-bus.md
 * Epic: .scratch/factories-to-app/
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SPEC = join(dirname(fileURLToPath(import.meta.url)), 'operating-stack.json');

/**
 * @param {string} [specPath]
 * @returns {typeof import('./operating-stack.json')}
 */
export function loadOperatingStack(specPath = DEFAULT_SPEC) {
  return JSON.parse(readFileSync(specPath, 'utf8'));
}

/** @param {ReturnType<typeof loadOperatingStack>} [spec] */
export function factoryEpicNow(spec = loadOperatingStack()) {
  return spec.epic.now;
}

/** @param {ReturnType<typeof loadOperatingStack>} [spec] */
export function parkedIds(spec = loadOperatingStack()) {
  return spec.park.map((row) => row.id);
}

/** @param {ReturnType<typeof loadOperatingStack>} [spec] */
export function doNotAddIds(spec = loadOperatingStack()) {
  return [...spec.doNotAdd];
}

/** One line for workflow:next / session brief. */
export function epicNowLine(spec = loadOperatingStack()) {
  const now = factoryEpicNow(spec);
  if (!now.then?.length) {
    const merge = now.mergePending?.length ? ` Merge ${now.mergePending.join(' → ')}.` : '';
    return (
      `**Epic NOW:** ticket ${now.ticket} (${now.title}). Tickets 16–21 resolved.${merge} Do not start Trains H/I.`
    );
  }
  const then = now.then.join(', then ');
  return (
    `**Epic NOW:** ticket ${now.ticket} (${now.title}), stacked on ${now.stackedOn}. `
    + `Then ${then}. Do not start Trains H/I.`
  );
}

/**
 * Print the factory epic NOW when this is that effort, or when no effort is
 * active (scratch is gitignored — cloud sessions often have none).
 * @param {string | null | undefined} slug
 * @param {ReturnType<typeof loadOperatingStack>} [spec]
 */
export function shouldPrintEpicNow(slug, spec = loadOperatingStack()) {
  return !slug || slug === spec.effort;
}

/** Flat two-line banner for `npm run workflow:next`. */
export function epicNowCli(spec = loadOperatingStack()) {
  const now = factoryEpicNow(spec);
  if (!now.then?.length) {
    const merge = now.mergePending?.length ? ` Merge ${now.mergePending.join(' → ')}.` : '';
    return [
      `epic:    ticket ${now.ticket} (${now.title}). Tickets 16–21 resolved.${merge} Do not start Trains H/I.`,
      'stack:   scripts/lib/operating-stack.json',
    ].join('\n');
  }
  const then = now.then.join(', then ');
  return [
    `epic:    ticket ${now.ticket} (${now.title}), stacked on ${now.stackedOn}. Then ${then}. Do not start Trains H/I.`,
    'stack:   scripts/lib/operating-stack.json',
  ].join('\n');
}
