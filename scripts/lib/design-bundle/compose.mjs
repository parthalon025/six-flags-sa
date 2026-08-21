/**
 * Compose the generated design-system bundle.
 *
 * Sources of truth: apps/party-tracker/app/globals.css, lib/world.js,
 * lib/sheet.js, components/Icon.jsx, CONTEXT.md.
 * Generated output: docs/design/system/*.html + _ds_manifest.json
 *
 * Same shape as scripts/lib/agent-docs/compose.mjs — compose to a
 * Map<relPath, contents>, then write it or diff it — so `design:check`
 * behaves the way `agent-docs:check` already does.
 *
 * Interface:
 *   composeDesignBundle()  → Map<relPath, contents>
 *   writeDesignBundle()    → relPaths written
 *   checkDesignBundle()    → [{ path, reason }]  (empty when fresh)
 *   collectFindings()      → the cross-check notes, for the CLI to echo
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from '../git-env.mjs';
import {
  root,
  SOURCES,
  readTokens,
  readSkins,
  readIcons,
  readVocabulary,
  readScreenMap,
  crossCheckIconMaps,
  contrast,
  CONTRAST_PAIRS,
} from './sources.mjs';
import { renderPages, PAGES } from './render.mjs';

export const OUT_DIR = 'docs/design/system';

/* Deliberately NOT stamped with a commit.
 *
 * An earlier version put `git rev-parse --short HEAD` in every page footer,
 * which quietly made the bundle unfreshenable: committing it moves HEAD, so
 * the pages that were correct a second ago now disagree with the generator and
 * `design:check` fails — on the very commit that lands them, and on every
 * commit after. CI would have been red permanently.
 *
 * Freshness here is a function of the SOURCES, not of the repository's
 * position. Provenance is a git question and git already answers it:
 * `git log -- docs/design/system/`.
 */

const BLURBS = {
  'tokens-color.html': 'Every custom property in both palettes, with the contrast the app is read at.',
  'tokens-type.html': 'The Dynamic Type scale, the two families, and the section-heading rule.',
  'tokens-spacing.html': 'The sheet stops and the measured budget they are the sum of.',
  'tokens-radius.html': 'Every radius, drawn at its own value — and when to use which shape.',
  'map-skins.html': 'What each Skin paints, from mapPaint() rather than a hex table.',
  'icons.html': 'The whole glyph set, plus the Kit and Mark maps that name them.',
  'vocabulary.html': 'The words a screen has to get right, from CONTEXT.md.',
  'screen-map.html': 'Which repo files each screen stands on, every path verified.',
};

const DERIVED_FROM = {
  'index.html': [SOURCES.css],
  'tokens-color.html': [SOURCES.css],
  'tokens-type.html': [SOURCES.css],
  'tokens-spacing.html': [SOURCES.css, 'apps/party-tracker/lib/sheet.js'],
  'tokens-radius.html': [SOURCES.css],
  'map-skins.html': [SOURCES.world],
  'icons.html': [SOURCES.icon, SOURCES.world],
  'vocabulary.html': [SOURCES.context],
  'screen-map.html': ['(working tree)'],
};

/** Split the type tokens into the `size / leading / tracking` triples they were written as. */
function typeModel(tokens) {
  const by = (prefix) =>
    new Map(
      tokens.rows
        .filter((t) => t.name.startsWith(prefix))
        .map((t) => [t.name.slice(prefix.length), t.value]),
    );
  const sizes = by('--fs-');
  const leadings = by('--lh-');
  const trackings = by('--tr-');

  const scale = [...sizes].map(([key, size]) => ({
    name: key.replace(/-/g, ' '),
    size,
    leading: leadings.get(key) ?? '',
    tracking: trackings.get(key) ?? '',
  }));

  const stacks = tokens.rows
    .filter((t) => ['--display', '--ui', '--mono'].includes(t.name))
    .map((t) => ({ name: t.name, value: t.value }));

  /* The display/interface split is written on the `---- type ----` banner, so
     it belongs to the group rather than to any one token — reading it off
     `--display` finds nothing, because the banner already consumed it.

     The long note about the tracking column changing sign rides on the first
     scale token instead, and is the more useful half: it is the paragraph that
     stops someone "fixing" Large Title's positive tracking. */
  const note = [
    tokens.groups.find((g) => g.name === 'type')?.note,
    tokens.rows.find((t) => t.name.startsWith('--fs-'))?.note,
  ]
    .filter(Boolean)
    .join('\n\n');

  /* `.label`'s comment is the load-bearing one for headings, and it lives on a
     rule rather than on a token — so it is read out of the stylesheet by the
     text around it rather than by the token walker. */
  const css = readFileSync(join(root, SOURCES.css), 'utf8');
  const labelAt = css.indexOf('\n.label {');
  const before = css.slice(Math.max(0, labelAt - 400), labelAt);
  const inside = css.slice(labelAt, css.indexOf('}', labelAt));
  const comments = [...`${before}${inside}`.matchAll(/\/\*([\s\S]*?)\*\//g)].map((m) =>
    m[1]
      .split('\n')
      .map((l) => l.trim())
      .join(' ')
      .trim(),
  );
  const labelNote = comments.find((c) => /outdoor glare/i.test(c)) || comments.join(' ');

  return { scale, stacks, note, labelNote };
}

/** The lengths that are about layout rather than type or radius. */
function spacingModel(tokens, sheet) {
  const lengths = tokens.rows.filter((t) => ['--peek', '--shut'].includes(t.name));

  const budget = [
    'SHEET_CHROME_PX',
    'SHEET_SEARCH_PX',
    'SHEET_BRAND_PX',
    'SHEET_HINT_PX',
    'SHEET_LOCATE_PX',
    'SHEET_LIST_PX',
    'SHEET_SHUT_PX',
    'SHEET_PEEK_PX',
    'SHEET_LIST_AT_PX',
    'SHEET_PLACE_PX',
  ].map((name) => ({ name, value: sheet[name] }));

  /* The stylesheet's first-paint stops against the ladder the sheet settles
     to. Nothing in the app asserts these agree, so this is the assertion. */
  const checks = [
    { css: '--peek', js: 'SHEET_PEEK_PX' },
    { css: '--shut', js: 'SHEET_SHUT_PX' },
  ].map(({ css, js }) => {
    const cssValue = tokens.rows.find((t) => t.name === css)?.value ?? '';
    const jsValue = sheet[js];
    return { css, cssValue, js, jsValue, ok: parseFloat(cssValue) === jsValue };
  });

  return { lengths, budget, checks };
}

export async function buildModel() {
  const tokens = readTokens();
  const paletteNames = { night: 'Park Midnight', day: 'Trail' };
  const skins = await readSkins(paletteNames);
  const icons = readIcons();
  const vocabulary = readVocabulary();
  const screenMap = readScreenMap();
  const sheet = await import(join(root, 'apps/party-tracker/lib/sheet.js'));

  const night = new Map(tokens.rows.map((t) => [t.name, t.resolved]));
  const day = new Map(tokens.rows.map((t) => [t.name, t.dayResolved ?? t.resolved]));
  const at = (map, ref) => (ref.startsWith('--') ? map.get(ref) : ref);

  const contrastRows = CONTRAST_PAIRS.map((p) => ({
    ...p,
    night: contrast(at(night, p.fg), at(night, p.bg)),
    day: contrast(at(day, p.fg), at(day, p.bg)),
  }));
  const contrastShipFails = contrastRows.filter(
    (c) => c.status === 'ships' && [c.night, c.day].some((r) => r !== null && r < c.floor),
  );

  const iconGaps = crossCheckIconMaps(icons.icons, skins.world);
  const spacing = spacingModel(tokens, sheet);

  const findings = [];
  for (const g of iconGaps) {
    findings.push(
      `<code>${g.map}.${g.key}</code> names glyph <code>${g.glyph}</code>, which is not in ` +
        `<code>GLYPHS</code> — <code>Icon</code> renders nothing for it.`,
    );
  }
  for (const c of spacing.checks.filter((c) => !c.ok)) {
    findings.push(
      `<code>${c.css}</code> is <code>${c.cssValue}</code> in the stylesheet but ` +
        `<code>${c.js}</code> computes <code>${c.jsValue}px</code> — the first paint and the ` +
        `settled sheet disagree.`,
    );
  }
  for (const c of contrastShipFails) {
    findings.push(
      `<code>${c.fg}</code> on <code>${c.bg}</code> (<code>${c.where}</code>) measures ` +
        `${Math.min(...[c.night, c.day].filter((r) => r !== null)).toFixed(2)}:1, under its ` +
        `${c.floor}:1 floor.`,
    );
  }

  return {
    tokens,
    skins,
    icons,
    iconGaps,
    vocabulary,
    screenMap,
    world: skins.world,
    contrast: contrastRows,
    contrastShipFails,
    type: typeModel(tokens),
    spacing,
    /* The stylesheet groups its own radii under a `---- radii ----` banner, so
       the page's contents are the group's membership rather than a list kept
       here — a radius added there appears here without this file changing. */
    radii: tokens.rows.filter((t) => t.group === 'radii'),
    blurbs: BLURBS,
    derivedFrom: DERIVED_FROM,
    findings,
  };
}

export async function composeDesignBundle() {
  const model = await buildModel();
  const pages = renderPages(model);
  const out = new Map();
  for (const [name, contents] of pages) out.set(`${OUT_DIR}/${name}`, contents);
  return { outputs: out, model };
}

export async function writeDesignBundle() {
  const { outputs, model } = await composeDesignBundle();
  const dir = join(root, OUT_DIR);
  mkdirSync(dir, { recursive: true });

  /* Sweep pages a previous build wrote and this one no longer emits. Without
     it a renamed page lingers in the bundle and in the pushed card index, which
     is drift of exactly the kind this script exists to stop. */
  const expected = new Set([...outputs.keys()].map((p) => p.slice(OUT_DIR.length + 1)));
  for (const name of readdirSync(dir)) {
    if (!expected.has(name) && /\.(html|json)$/.test(name)) unlinkSync(join(dir, name));
  }

  for (const [rel, contents] of outputs) writeFileSync(join(root, rel), contents, 'utf8');
  return { written: [...outputs.keys()], model };
}

export async function checkDesignBundle() {
  const { outputs, model } = await composeDesignBundle();
  const drift = [];
  const normalize = (s) => s.replace(/\r\n/g, '\n');

  for (const [rel, expected] of outputs) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      drift.push({ path: rel, reason: 'missing' });
      continue;
    }
    if (normalize(readFileSync(abs, 'utf8')) !== normalize(expected)) {
      drift.push({ path: rel, reason: 'content drift' });
    }
  }

  const dir = join(root, OUT_DIR);
  if (existsSync(dir)) {
    const expectedNames = new Set([...outputs.keys()].map((p) => p.slice(OUT_DIR.length + 1)));
    for (const name of readdirSync(dir)) {
      if (/\.(html|json)$/.test(name) && !expectedNames.has(name)) {
        drift.push({ path: `${OUT_DIR}/${name}`, reason: 'not generated by this build' });
      }
    }
  }

  return { drift, model };
}

export { PAGES };
