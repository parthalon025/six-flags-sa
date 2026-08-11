#!/usr/bin/env node
/**
 * Discover ThemeParks.wiki entity ids for the top-100 catalog.
 *
 *   npm run venues:discover-parks-api
 */

import { writeEntityMapFile } from '../lib/parks-api-entities.mjs';

async function main() {
  const doc = await writeEntityMapFile();
  console.log(`Matched ${doc.matched}/100 parks (${doc.unmatched} unmatched, ${doc.apiParkCount} API parks scanned)`);
  if (doc.failures?.length) {
    console.log('\nUnmatched:');
    for (const f of doc.failures.slice(0, 20)) {
      console.log(`  ${f.id}: ${f.name} (best: ${f.best?.name || '—'} @ ${f.best?.score?.toFixed(2) || '—'})`);
    }
    if (doc.failures.length > 20) console.log(`  … and ${doc.failures.length - 20} more`);
  }
  process.exit(doc.unmatched > 10 ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
