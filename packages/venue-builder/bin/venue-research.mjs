#!/usr/bin/env node
/**
 * Research assistant for the universal venue builder.
 *
 *   node scripts/venue-research.mjs big-kahunas
 *   node scripts/venue-research.mjs big-kahunas --json
 *   node scripts/venue-research.mjs big-kahunas --ai
 *
 * Reads what is on disk — bundle, overrides, source catalogue, recipe — and
 * prints judgement hints (name pairings, OSM gaps) plus a sourcing plan.
 * With --ai and VENUE_LLM_API_KEY set, asks a model to review the packet.
 * With --fetch, pulls the park's official website from URLs in sources.json.
 *
 * This never writes venue files and never runs during a build.
 */

import path from 'node:path';
import { readJson, VENUE_DIR, OVERRIDE_DIR } from '../lib/venue-io.mjs';
import { requests, renderBrief, briefJson } from '../lib/venue-requests.mjs';
import { readSources } from '../lib/venue-sources.mjs';
import { judgements, sourcingPlan } from '../lib/venue-judge.mjs';
import { llmConfig, reviewResearch } from '../lib/venue-llm.mjs';
import {
  compareOfficialToBundle,
  loadOfficialData,
  officialUrls,
  parseAttractionListing,
  enrichOfficialFromSidecar,
} from '../lib/venue-official-site.mjs';

const USAGE = `
Research assistant for venue builds — judgement, sourcing, optional AI review.

  node scripts/venue-research.mjs <venue id> [options]
  node scripts/venue-research.mjs --all

  --json        structured output instead of markdown
  --ai          ask VENUE_LLM_API_KEY (OpenAI-compatible) to review the packet
  --fetch       fetch official park website data (cached to data/venues/<id>.official-cache.json)
  --fetch-details  also fetch each attraction page for height prose (slower)
  --offline     use only the on-disk official cache; do not hit the network
  --no-brief    skip the venues:ask brief; only judgements and sourcing
`;

function parseArgs(argv) {
  const out = {
    _: [],
    all: false,
    json: false,
    ai: false,
    brief: true,
    fetch: false,
    fetchDetails: false,
    offline: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--ai') out.ai = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--fetch-details') out.fetchDetails = true;
    else if (a === '--offline') out.offline = true;
    else if (a === '--no-brief') out.brief = false;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

async function loadVenue(id, opts = {}) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const venue = manifest.venues.find((v) => v.id === id);
  if (!venue) throw new Error(`No venue called "${id}" in the manifest.`);

  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), {});
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  const overrides = readJson(path.join(OVERRIDE_DIR, `${id}.overrides.json`), null);
  const heightsSidecar = readJson(path.join(OVERRIDE_DIR, `${id}.heights.json`), null);
  const recipe = readJson(path.join(OVERRIDE_DIR, `${id}.recipe.json`), null);
  const { data: catalog } = readSources(id, recipe?.flags?.sources || null);

  const layers = {
    coaster: map.coaster || [],
    slide: map.slide || [],
    path: map.path || [],
    lands: map.lands || [],
  };

  const reqs = requests({ venue, map, pois, overrides });
  const judge = judgements({ pois, layers, overrides });
  const sourcing = sourcingPlan({ catalog, pois, layers, requests: reqs, judgements: judge });
  const officialRaw = enrichOfficialFromSidecar(
    await loadOfficialData(id, catalog, {
      fetch: opts.fetch,
      offline: opts.offline,
      details: opts.fetchDetails,
    }),
    heightsSidecar,
    catalog,
  );
  const official = compareOfficialToBundle({ official: officialRaw, pois, heightsSidecar });
  if (officialRaw?.fallback) official.fallback = officialRaw.fallback;

  return {
    venue,
    map,
    pois,
    overrides,
    heightsSidecar,
    recipe,
    catalog,
    requests: reqs,
    judgements: judge,
    sourcing,
    official,
  };
}

function renderSourcing(sourcing) {
  const lines = ['## Sourcing plan', ''];
  if (!sourcing.catalogued.length) {
    lines.push('No `data/venues/<id>.sources.json` on disk — consider cataloguing orthophoto, park map, and official site URLs before hand-editing geometry.', '');
  } else {
    lines.push(`Catalogued kinds: ${sourcing.catalogued.join(', ')}`, '');
    for (const s of sourcing.sources) {
      const bits = [s.kind, s.provider || s.id].filter(Boolean).join(' — ');
      lines.push(`- **${bits}**${s.used_for ? `: ${s.used_for}` : ''}`);
    }
    lines.push('');
  }
  if (!sourcing.needs.length) {
    lines.push('No obvious sourcing gaps from what is on disk.', '');
    return lines.join('\n');
  }
  lines.push('**Gaps and what to add**', '');
  for (const need of sourcing.needs) {
    lines.push(`### ${need.gap.replace(/-/g, ' ')}`);
    if (need.count != null) lines.push(`${need.count} item(s).`);
    if (need.have?.length) lines.push(`Already have: ${need.have.join(', ')}.`);
    if (need.wants?.length) lines.push(`Still useful: ${need.wants.join(', ')}.`);
    if (need.datasets?.length) lines.push(`Wired datasets: ${need.datasets.join(', ')}.`);
    if (need.note) lines.push(need.note);
    lines.push('');
  }
  return lines.join('\n');
}

function renderJudgements(judge) {
  if (!judge.length) {
    return '## Judgement\n\nNo name or track ambiguities flagged.\n';
  }
  const lines = ['## Judgement', ''];
  for (const j of judge) {
    lines.push(`### ${j.need} (${j.count})`, '');
    if (j.targets?.length) {
      lines.push('**Names**', '');
      j.targets.forEach((t) => lines.push(`- ${t}`));
      lines.push('');
    }
    if (j.hints?.length) {
      lines.push('**Hints**', '');
      j.hints.forEach((h) => lines.push(`- ${h}`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderOfficial(official, catalog) {
  const urls = officialUrls(catalog);
  const lines = ['## Official park website', ''];
  if (!urls.site.length && !urls.map.length) {
    lines.push('No `official_site` or `official_map` URL in the source catalogue.', '');
    return lines.join('\n');
  }
  for (const p of official.pages || []) {
    const extra = p.image ? ` (map image: \`${p.image}\`)` : '';
    lines.push(`- [${p.kind}](${p.url})${extra}`);
  }
  lines.push('');
  if (official.fetched) {
    const note = official.fallback === 'heights_sidecar'
      ? ' (heights sidecar — official site is JS-rendered)'
      : '';
    lines.push(`Data date: ${official.fetched}${note}. Live listing: \`npm run venues:research -- <id> --fetch\`.`, '');
  }
  if (official.errors?.length) {
    lines.push('**Fetch errors**', '');
    official.errors.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }
  if (!official.siteCount) {
    lines.push('No attractions parsed yet — run with `--fetch` to pull the park listing.', '');
    return lines.join('\n');
  }
  lines.push(
    `${official.siteCount} attraction(s) on the official site; `
      + `${official.matched} matched to bundle rides; `
      + `${official.bundleRideCount} ride(s) in the bundle.`,
    '',
  );
  if (official.onlyOnSite.length) {
    lines.push('**On the park site but not in the bundle** (may need imagery or overrides):', '');
    official.onlyOnSite.forEach((n) => lines.push(`- ${n}`));
    lines.push('');
  }
  if (official.onlyInBundle.length) {
    lines.push('**In the bundle but not on the park listing** (check naming or retired rides):', '');
    official.onlyInBundle.forEach((n) => lines.push(`- ${n}`));
    lines.push('');
  }
  if (official.heightMismatches.length) {
    lines.push('**Height rule mismatches** (bundle vs official site category/prose):', '');
    for (const m of official.heightMismatches) {
      lines.push(`- ${m.name}: bundle min ${m.bundleMin}\" vs site ${m.siteMin}\"${m.url ? ` — ${m.url}` : ''}`);
    }
    lines.push('');
  }
  const withHeights = (official.attractions || []).filter((a) => a.height?.min != null);
  if (withHeights.length) {
    lines.push('**Published height categories** (from listing cards):', '');
    lines.push('| Attraction | Site says | URL |');
    lines.push('| --- | --- | --- |');
    for (const a of withHeights) {
      const label = a.height.label || `min ${a.height.min}\"`;
      const link = a.url ? `[page](${a.url})` : '—';
      lines.push(`| ${a.name} | ${label} | ${link} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderMarkdown(packet, aiText = null) {
  const { venue, requests: reqs } = packet;
  const parts = [
    `# ${venue.name} — research packet`,
    '',
    `Venue id: \`${venue.id}\`. Judgement, official site data, and sourcing are computed from the built bundle on disk.`,
    '',
    '```bash',
    `npm run venues:rebuild -- ${venue.id}`,
    `npm run venues:overrides -- ${venue.id}`,
    `npm run venues:research -- ${venue.id} --fetch`,
    '```',
    '',
    renderOfficial(packet.official, packet.catalog),
    renderJudgements(packet.judgements),
    renderSourcing(packet.sourcing),
  ];
  if (reqs.length) {
    parts.push('---', '', renderBrief(venue, reqs));
  } else {
    parts.push('---', '', '_No outstanding venues:ask items — OpenStreetMap and overrides cover what the build needs._', '');
  }
  if (aiText) {
    parts.push('---', '', '## AI review', '', aiText, '');
  }
  return parts.join('\n');
}

function packetJson(packet, aiText = null) {
  const { venue, judgements: judge, sourcing, requests: reqs, official } = packet;
  return {
    venue: {
      id: venue.id,
      name: venue.name,
      locality: venue.locality || null,
    },
    official,
    judgements: judge,
    sourcing,
    brief: briefJson(venue, reqs),
    llm: aiText ? { review: aiText } : null,
    llmConfig: { ready: llmConfig().ready, model: llmConfig().model },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.all
    ? readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] }).venues.map((v) => v.id)
    : args._;

  if (!ids.length) {
    console.error(USAGE.trim());
    process.exit(1);
  }

  const packets = [];
  for (const id of ids) {
    packets.push(await loadVenue(id, {
      fetch: args.fetch,
      offline: args.offline,
      fetchDetails: args.fetchDetails,
    }));
  }

  if (args.ai) {
    if (!llmConfig().ready) {
      throw new Error('Set VENUE_LLM_API_KEY (or OPENAI_API_KEY) to use --ai.');
    }
    for (const packet of packets) {
      packet.aiReview = await reviewResearch(packetJson(packet));
    }
  }

  if (args.json) {
    const out = packets.map((p) => packetJson(p, p.aiReview || null));
    console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
    return;
  }

  const sections = packets.map((p) => {
    const showBrief = args.brief;
    const slice = { ...p };
    if (!showBrief) slice.requests = [];
    return renderMarkdown(slice, p.aiReview || null);
  });
  console.log(sections.join('\n\n---\n\n'));
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
