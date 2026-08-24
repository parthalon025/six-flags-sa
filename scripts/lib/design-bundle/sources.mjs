/**
 * Read the design system out of the app, rather than off a mock.
 *
 * Every export here answers one question — what are the tokens, what do the
 * Skins paint, which glyphs exist, what do the words mean — by reading the
 * file that already owns the answer. Nothing in this module carries a second
 * copy of a value the app ships, because a second copy is how the imported
 * twin ended up with `--cat-*` colours the repo never had.
 *
 * The one thing that IS written down here is *which* things a designer needs:
 * the vocabulary term list and the contrast pairs are curation, not data. They
 * are named, and looking each one up fails loudly if the app moved it.
 *
 * Interface:
 *   readTokens()      → { night, day, groups }  from app/globals.css
 *   readSkins()       → skin rows               from lib/world.js mapPaint()
 *   readIcons()       → glyph name + SVG body   from components/Icon.jsx
 *   readVocabulary()  → term + definition       from CONTEXT.md
 *   readScreenMap()   → screen → repo paths, each checked to exist
 *   contrast(a, b)    → WCAG ratio between two resolved colours
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = dirname(fileURLToPath(import.meta.url));
export const root = join(libDir, '../../..');
const app = join(root, 'apps/party-tracker');

const read = (rel) => readFileSync(join(root, rel), 'utf8');

/* Paths we read FROM. Named once so a moved file is one edit and a loud
   failure, not seven silent empty sections. */
export const SOURCES = {
  css: 'apps/party-tracker/app/globals.css',
  world: 'apps/party-tracker/lib/world.js',
  icon: 'apps/party-tracker/components/Icon.jsx',
  context: 'CONTEXT.md',
  page: 'apps/party-tracker/app/page.js',
};

function must(rel) {
  if (!existsSync(join(root, rel))) {
    throw new Error(`design-bundle: source moved or missing — ${rel}`);
  }
  return read(rel);
}

/* ============================================================
   Tokens — apps/party-tracker/app/globals.css
   ============================================================ */

/**
 * The two palette blocks, and only those two.
 *
 * `:root` also appears indented inside `@supports not (backdrop-filter…)` and
 * inside the reduced-transparency / increased-contrast media queries, where it
 * overrides a handful of tokens for one environment. Those are not the
 * palette, so the match is anchored to column 0 — a selector at the start of a
 * line is a top-level rule by this stylesheet's own formatting.
 */
const PALETTE_BLOCKS = [
  { key: 'night', selector: ':root {', label: 'Park Midnight', theme: null },
  { key: 'day', selector: ":root[data-theme='day'] {", label: 'Trail', theme: 'day' },
];

/* The palette's own names, keyed the way every other reader keys a palette.
   These blocks are the only place the pair is written down; a page heading, a
   toggle button and a test that each retyped "Park Midnight" would be three
   more chances to disagree with the stylesheet, which is the drift this whole
   module exists to prevent. */
export const PALETTE_LABELS = Object.fromEntries(
  PALETTE_BLOCKS.map((b) => [b.key, b.label]),
);

/** Pull one brace-balanced block starting at a column-0 selector. */
function blockAt(css, selector) {
  const at = css.indexOf(`\n${selector}`);
  if (at === -1) throw new Error(`design-bundle: no top-level "${selector}" in ${SOURCES.css}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`design-bundle: unbalanced braces after "${selector}"`);
}

/* Strip a block comment back to its prose: leading `*` gutters, and the
   `=====` rules globals.css draws its section banners with — those are
   typography for someone reading the stylesheet, and they are noise once the
   text is set as paragraphs. */
const tidyComment = (raw) =>
  raw
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trimEnd())
    .filter((line) => !/^[=-]{4,}$/.test(line.trim()))
    .join('\n')
    .trim();

/**
 * Walk a palette block, keeping declarations and the comments above them.
 *
 * The comments are the point. `globals.css` explains why `--peek` is 308px and
 * why the first-run gate stays opaque; a swatch sheet that drops that prose
 * turns a reasoned number back into a magic one, which is the state the twin
 * was in. A `---- name ----` banner opens a group; any other comment attaches
 * as a note to the declarations that follow it.
 */
function parseBlock(body) {
  const tokens = [];
  const groups = [];
  let group = { name: 'Base', note: '' };
  let pending = '';
  let i = 0;

  while (i < body.length) {
    const commentAt = body.indexOf('/*', i);
    const semiAt = body.indexOf(';', i);

    if (commentAt !== -1 && (semiAt === -1 || commentAt < semiAt)) {
      const end = body.indexOf('*/', commentAt);
      if (end === -1) break;
      const text = tidyComment(body.slice(commentAt + 2, end));
      const banner = text.match(/^-{2,}\s*(.+?)\s*-{2,}$/m);
      if (banner) {
        group = { name: banner[1], note: text.replace(banner[0], '').trim() };
        if (!groups.some((g) => g.name === group.name)) groups.push(group);
        pending = '';
      } else {
        pending = text;
      }
      i = end + 2;
      continue;
    }
    if (semiAt === -1) break;

    const decl = body.slice(i, semiAt).trim();
    const m = decl.match(/^(--[A-Za-z0-9-]+)\s*:\s*([\s\S]+)$/);
    if (m) {
      if (!groups.some((g) => g.name === group.name)) groups.push(group);
      tokens.push({
        name: m[1],
        value: m[2].replace(/\s+/g, ' ').trim(),
        group: group.name,
        note: pending,
      });
      pending = '';
    }
    i = semiAt + 1;
  }
  return { tokens, groups };
}

/** Follow `var(--x)` chains inside one palette to the value that actually paints. */
function resolve(value, byName, seen = new Set()) {
  const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(value);
  if (!m || seen.has(m[1])) return value;
  const next = byName.get(m[1]);
  if (!next) return value;
  seen.add(m[1]);
  return resolve(next, byName, seen);
}

const COLOUR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|color-mix\(|white$|black$|transparent$)/;

/** What kind of preview a token wants. Derived from the value's own shape. */
function kindOf(name, value) {
  if (/^(blur|opacity)\(|\bblur\(/.test(value)) return 'filter';
  if (/(^|\s)(inset\s)?-?\d+px\s+-?[\d.]+px/.test(value) && value.includes('rgba')) return 'shadow';
  if (COLOUR_RE.test(value)) return 'colour';
  if (/^-?[\d.]+px$/.test(value)) return 'length';
  if (/^cubic-bezier\(/.test(value)) return 'easing';
  if (/^[\d.]+s$/.test(value)) return 'duration';
  if (/sans-serif|monospace|'/.test(value) && name !== '--barred') return 'font';
  if (/^env\(/.test(value)) return 'env';
  return 'other';
}

export function readTokens() {
  const css = must(SOURCES.css);
  const header = tidyComment(css.slice(css.indexOf('/*') + 2, css.indexOf('*/')));
  const palettes = {};
  let groupOrder = [];

  for (const block of PALETTE_BLOCKS) {
    const { tokens, groups } = parseBlock(blockAt(css, block.selector));
    const byName = new Map(tokens.map((t) => [t.name, t.value]));
    for (const t of tokens) {
      t.resolved = resolve(t.value, byName);
      t.alias = t.resolved !== t.value ? t.value : null;
      t.kind = kindOf(t.name, t.resolved);
    }
    palettes[block.key] = { ...block, tokens, byName };
    if (groups.length > groupOrder.length) groupOrder = groups;
  }

  /* Night is the base block; day only overrides part of it, so a `var()` in
     the day block may point at a token day never restates — `--blue` is
     `var(--adventure)` in both, and `--adventure` is declared once, in night.
     Resolving day against night-then-day is the cascade the browser runs, and
     resolving it against the day block alone leaves those tokens unpainted. */
  const dayLookup = new Map([...palettes.night.byName, ...palettes.day.byName]);

  /* Presenting the two palettes as two columns of one row is what makes a
     missing day override visible instead of invisible. */
  const rows = palettes.night.tokens.map((t) => ({
    ...t,
    dayValue: palettes.day.byName.get(t.name) ?? null,
    dayResolved: palettes.day.byName.has(t.name)
      ? resolve(palettes.day.byName.get(t.name), dayLookup)
      : null,
  }));

  return { header, groups: groupOrder, rows, palettes };
}

/* ============================================================
   Contrast — the reason several twin colours were rejected
   ============================================================ */

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Parse the colour forms globals.css actually uses. Alpha is composited by
 *  the caller against a known backdrop — WCAG is defined on opaque pairs. */
export function rgb(value) {
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio. `fg` may be translucent; it is composited on `bg`. */
export function contrast(fgValue, bgValue) {
  const fg = rgb(fgValue);
  const bg = rgb(bgValue);
  if (!fg || !bg || bg[3] < 1) return null;
  const a = luminance(over(fg, bg));
  const b = luminance(bg.slice(0, 3));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Pairs worth measuring, named because no parser can know which ink lands on
 * which surface — that is a fact about the screens, not about the stylesheet.
 *
 * `where` is the rule that puts them together, so a reader can go and look.
 * These selectors are the one hand-written thing on this page: they are a
 * reading of `globals.css`, and if one is renamed this table gets stale in the
 * only way this bundle can. Grep the selector before trusting the row.
 *
 * `status` separates three kinds of row. `ships` is a combination the app
 * actually paints, so its number is a live measurement of the product.
 * `rejected` is a combination that was proposed and turned down — kept because
 * a floor with no failing example beside it does not teach anyone anything,
 * and white-on-aqua at 2.45:1 is the exact reading that sent the twin's chips
 * back. `reference` is measured but not judged.
 *
 * A hairline separator is `reference` on purpose. WCAG 1.4.11 covers graphical
 * objects *required to understand the content*, and a decorative rule between
 * two rows is not one — the rows are already separated by their spacing. An
 * icon a guest has to find in order to act on it is, and would be `ships` at a
 * 3:1 floor. Holding a decorative hairline to 3:1 would put a permanent red
 * mark on this table, and a table that always shows a failure is a table
 * nobody reads.
 */
export const CONTRAST_PAIRS = [
  { fg: '--label', bg: '--bg', use: 'Body text on the app background', where: 'html, body', floor: 4.5, status: 'ships' },
  { fg: '--label', bg: '--bg2', use: 'Body text on a sheet', where: '.sheet', floor: 4.5, status: 'ships' },
  { fg: '--label2', bg: '--bg2', use: 'Secondary ink on a sheet', where: '.questBlurb', floor: 4.5, status: 'ships' },
  { fg: '#0B1829', bg: '--aqua', use: 'Dark ink on a selected topic chip', where: '.settingsTopic.on', floor: 4.5, status: 'ships' },
  { fg: '--onTint', bg: '--adventure', use: 'White on the primary action', where: '.btn.primary', floor: 4.5, status: 'ships' },
  { fg: '--onTint', bg: '--signal', use: 'White on an alert fill', where: '.chip.danger.on', floor: 4.5, status: 'ships' },
  { fg: '--sep', bg: '--bg2', use: 'A hairline separator — decorative, not judged', where: '.row + .row', floor: 3, status: 'reference' },
  { fg: '--onTint', bg: '--aqua', use: 'White on a navigation tint', where: 'rejected — see .settingsTopic.on', floor: 4.5, status: 'rejected' },
  { fg: '--label3', bg: '--bg2', use: "The twin's 11.5px section eyebrow", where: 'rejected — see .label', floor: 4.5, status: 'rejected' },
];

/* ============================================================
   Skins — lib/world.js
   ============================================================ */

/**
 * Skin swatches are `mapPaint(id)`, called, not a hex table read off a mock.
 *
 * `WorldCloset.jsx` draws its own chip the same way — `paint.ground` behind,
 * `paint.path.stroke` as the border — because `SKINS[].paint` is the object
 * that also feeds `mapThemeCssVars` and `applyMapSkin`. Any swatch built any
 * other way is a promise about the ground under the guest's thumb that the map
 * has not agreed to.
 */
/**
 * The six paints a swatch shows, pulled off one `mapPaint()` result.
 *
 * Note what is NOT read here: `p.label`. `mapPaint` builds its result as
 * `{ id, label: 'Postcard', ...skin.paint }`, and `skin.paint` carries its own
 * `label` — the map's text paint, `{ fill, halo, fontSize }` — which lands
 * second and wins. So `mapPaint(id).label` is always the text-paint object and
 * never the name, whatever the property list suggests. The display name comes
 * off `SKINS[id].label`, which is the field `WorldCloset` renders.
 */
const swatchOf = (p) => ({
  ground: p.ground,
  stroke: p.path.stroke,
  water: p.water.fill,
  grass: p.grass.fill,
  building: p.building.fill,
  ink: p.label.fill,
});

export async function readSkins(paletteNames) {
  must(SOURCES.world);
  const world = await import(join(app, 'lib/world.js'));
  const { SKINS, SKIN_IDS, mapPaint } = world;

  const skins = SKIN_IDS.map((id) => ({
    id,
    label: SKINS[id].label,
    season: SKINS[id].season ?? null,
    traits: Object.keys(SKINS[id].traits || {}),
    unlock: SKINS[id].unlock,
    share: SKINS[id].share,
    ...swatchOf(mapPaint(id)),
  }));

  /* The two always-on palettes are paints to `mapPaint` but are not Skins —
     they are not in `SKINS` and are never earned. Showing them first is what
     makes the Skin rows below read as departures from a known ground. */
  const palettes = ['night', 'day'].map((id) => ({
    id,
    label: paletteNames[id],
    ...swatchOf(mapPaint(id)),
  }));

  return { skins, palettes, world };
}

/* ============================================================
   Icons — components/Icon.jsx
   ============================================================ */

const JSX_ATTR = {
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeDasharray: 'stroke-dasharray',
  fillRule: 'fill-rule',
  clipRule: 'clip-rule',
  strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity',
};

/**
 * Turn one GLYPHS entry's JSX into SVG markup.
 *
 * The entries are static on purpose — `Icon` interpolates nothing but `size`
 * and `className` — so this is a rename of attributes and an expansion of the
 * `{...STROKE}` spread, not an evaluation. If a glyph ever grows a real
 * expression, `assertStatic` below stops the build rather than shipping a
 * silently empty box.
 */
function jsxToSvg(source, strokeAttrs) {
  let out = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const dynamic = out.match(/\{(?!\.\.\.STROKE\})[^}]*\}/);
  if (dynamic) {
    throw new Error(
      `design-bundle: ${SOURCES.icon} glyph contains an expression this reader cannot ` +
        `render statically: ${dynamic[0]}. Teach jsxToSvg about it before regenerating.`,
    );
  }
  out = out.replace(/\{\.\.\.STROKE\}/g, strokeAttrs);
  out = out.replace(/<>/g, '<g>').replace(/<\/>/g, '</g>');
  for (const [jsx, svg] of Object.entries(JSX_ATTR)) {
    out = out.replace(new RegExp(`\\b${jsx}=`, 'g'), `${svg}=`);
  }

  /* Collapse repeated attributes, keeping the LAST.
     `<g {...STROKE} strokeWidth="2.1">` is a spread plus an override, and JSX
     resolves that to 2.1. Emitted literally it becomes two `stroke-width`
     attributes on one tag, and an HTML parser keeps the FIRST — so the glyph
     would quietly render at the spread's 2 and every stroke on this sheet
     would be a little wrong in a way nobody would think to check. */
  out = out.replace(/<([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")+)(\s*\/?)>/g, (all, tag, attrs, close) => {
    const seen = new Map();
    for (const m of attrs.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) seen.set(m[1], m[2]);
    const rebuilt = [...seen].map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${rebuilt}${close.includes('/') ? ' /' : ''}>`;
  });

  return out.replace(/\s+/g, ' ').trim();
}

export function readIcons() {
  const src = must(SOURCES.icon);

  const strokeBody = src.slice(src.indexOf('const STROKE = {') + 16, src.indexOf('};'));
  const strokeAttrs = [...strokeBody.matchAll(/([A-Za-z]+):\s*'([^']*)'|([A-Za-z]+):\s*([\d.]+)/g)]
    .map((m) => {
      const key = m[1] ?? m[3];
      return `${JSX_ATTR[key] ?? key}="${m[2] ?? m[4]}"`;
    })
    .join(' ');

  const open = src.indexOf('const GLYPHS = {');
  if (open === -1) throw new Error(`design-bundle: no GLYPHS map in ${SOURCES.icon}`);
  /* Bound the body at the map's own closing `\n};` so nothing outside GLYPHS
     can be read as a glyph. STROKE sits above it and the Icon component below,
     and both carry two-space-indented keys of their own. */
  const bodyStart = src.indexOf('{', open) + 1;
  const bodyEnd = src.indexOf('\n};', bodyStart);
  if (bodyEnd === -1) throw new Error(`design-bundle: GLYPHS map is unterminated in ${SOURCES.icon}`);
  const body = src.slice(bodyStart, bodyEnd);

  /* Entries come in TWO shapes, and reading only the first is how this reader
     under-reported the glyph set on its first pass:

         'sun.max.fill': (        <- multi-line, wrapped in parentheses
           <>…</>
         ),
         'bolt.fill': <path … />,   <- single line, no parentheses at all

     Ten of the thirty-four are the second kind. A pattern anchored on `: (`
     silently skipped every one of them and reported three real glyphs as
     missing — a design-system page that omits a glyph teaches a designer it
     does not exist, which is worse than having no page.

     So: locate the keys, and take each value as everything up to the next key.
     Quoting is irrelevant either way (`safari:` is bare, `'safari':` would not
     be) and never was the problem; the value's shape was. */
  const KEY = /\n {2}('?)([A-Za-z][A-Za-z0-9.\-_]*)\1:[ \t]/g;
  const keys = [...body.matchAll(KEY)];
  if (!keys.length) throw new Error('design-bundle: GLYPHS parsed to zero entries');

  const entries = keys.map((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < keys.length ? keys[i + 1].index : body.length;
    /* Trim the separating comma; a single-line entry ends `/>,` and a
       parenthesised one ends `),`. */
    const raw = body.slice(from, to).trim().replace(/,$/, '').trim();
    const inner = /^\(([\s\S]*)\)$/.exec(raw);
    return { name: m[2], jsx: inner ? inner[1] : raw };
  });

  const icons = entries.map(({ name, jsx }) => ({ name, svg: jsxToSvg(jsx, strokeAttrs) }));
  const viewBox = /viewBox="([^"]+)"/.exec(src)?.[1] ?? '0 0 24 24';
  const header = tidyComment(src.slice(src.indexOf('/*') + 2, src.indexOf('*/')));
  return { icons, viewBox, header };
}

/**
 * Which `KIT_ICONS` / `MARK_ICONS` names have no glyph behind them.
 *
 * `Icon` returns `null` for a name it does not know, so a broken entry is not
 * a missing-image box — it is nothing at all, in a row that otherwise looks
 * finished. Nobody notices a glyph that was never there, which is exactly why
 * this is worth computing every build rather than eyeballing.
 *
 * This reports; it does not throw. The bundle is a mirror, and a mirror that
 * refuses to render because the thing it reflects has a blemish is no use.
 */
export function crossCheckIconMaps(icons, world) {
  const have = new Set(icons.map((i) => i.name));
  const gaps = [];
  for (const [mapName, map] of [
    ['KIT_ICONS', world.KIT_ICONS],
    ['MARK_ICONS', world.MARK_ICONS],
  ]) {
    for (const [key, glyph] of Object.entries(map)) {
      if (!have.has(glyph)) gaps.push({ map: mapName, key, glyph });
    }
  }
  return gaps;
}

/* ============================================================
   Vocabulary — CONTEXT.md
   ============================================================ */

/**
 * The terms a designer has to get right, in the order a screen meets them.
 *
 * The list is curated — CONTEXT.md holds fifty-odd terms and a swatch sheet is
 * not a glossary — but every definition is lifted from CONTEXT.md verbatim,
 * and a term that has been renamed there fails the build instead of quietly
 * keeping the old wording. `_Avoid_` travels with the definition because it is
 * the half that stops a mock inventing "Meet-up" or "Venue".
 */
export const VOCABULARY_TERMS = [
  'World',
  'Zone',
  'Place',
  'Party',
  'Rally Point',
  'Side Quest',
  'Contribution',
  'Mark',
  'Skin',
  'Kit',
  'Title',
];

export function readVocabulary() {
  const md = must(SOURCES.context);
  const found = new Map();
  const re = /^\*\*(.+?)\*\*:\n([\s\S]*?)(?=\n_Avoid_:|\n\n|\n### |$)/gm;
  for (const m of md.matchAll(re)) {
    const after = md.slice(m.index + m[0].length);
    const avoid = /^\n_Avoid_:\s*(.+)$/m.exec(after.split('\n\n')[0]);
    found.set(m[1].replace(/\*\*/g, ''), {
      term: m[1].replace(/\*\*/g, ''),
      definition: m[2].trim(),
      avoid: avoid ? avoid[1].trim() : '',
    });
  }
  return VOCABULARY_TERMS.map((term) => {
    const hit = found.get(term);
    if (!hit) {
      throw new Error(
        `design-bundle: "${term}" is no longer defined in ${SOURCES.context}. ` +
          `Either it was renamed — update VOCABULARY_TERMS — or the glossary lost it.`,
      );
    }
    return hit;
  });
}

/* ============================================================
   Screen map — the check the twin's own contract never had
   ============================================================ */

/**
 * Which repo files each design screen stands on.
 *
 * This is the table the imported twin got wrong: its screen map pointed at a
 * `components/WorldPicker.jsx` and a `lib/worlds.js` that did not exist, and
 * nothing anywhere would say so. Here every path is checked against the disk
 * on every build, so a moved component breaks `design:check` in CI on the
 * commit that moved it rather than in a design session three weeks later.
 *
 * The screen names are the twin's own, so the two tables can be read side by
 * side. `mount` records where a component is actually rendered when that
 * distinction matters for the twin.
 */
export const SCREEN_MAP = [
  ['Sign in (Profile gate)', ['components/AuthGate.jsx', 'components/AuthGateActions.jsx', 'components/OAuthButtons.jsx', 'components/SignInCard.jsx', 'lib/auth/authCopy.js']],
  ['Intro / onboarding', ['components/IntroSplash.jsx', 'lib/brand.js', 'lib/introGate.js']],
  ['Location gate', ['components/GpsGate.jsx', 'components/ParkPrompt.jsx', 'lib/geo.js']],
  ['World pick', ['components/WorldPicker.jsx', 'lib/venueIndex.js']],
  // ParkMap.jsx turns Truth into map data; ParkMapGl.jsx is the shipped
  // MapLibre renderer (slice h18 retired the SVG adapter).
  ['Explore (map + sheet)', ['components/ParkMap.jsx', 'components/ParkMapGl.jsx', 'components/PlaceList.jsx', 'lib/sheet.js', 'lib/theme.js', 'lib/mapThemeTokens.js']],
  ['Selection capsule', ['components/SelectionCapsule.jsx']],
  ['Spot (bare-ground tap)', ['components/SpotCapsule.jsx', 'components/SpotBanner.jsx', 'lib/spot.js']],
  ['Map furniture (Key, scale)', ['components/MapLegend.jsx', 'components/MapSymbols.jsx', 'components/MapAttribution.jsx']],
  ['Plan (Stops + Heights)', ['components/PlanPanel.jsx', 'components/PlanStops.jsx', 'components/HeightPanel.jsx', 'lib/park.js', 'lib/plan.js', 'lib/eligibility.js']],
  ['Place detail', ['components/PlaceDetail.jsx']],
  ['Party + roster', ['components/PartyPanel.jsx', 'lib/party/client.js']],
  ['Walking directions', ['components/NavBar.jsx', 'components/NavBanner.jsx', 'components/DirectionsPanel.jsx', 'components/RoutePreview.jsx', 'lib/routing.js']],
  ['Side Quests (tab root)', ['components/SideQuestsPanel.jsx', 'lib/sideQuests.js']],
  ['Me (tab root)', ['components/MePanel.jsx', 'components/ProfileJourney.jsx', 'components/TitleProgress.jsx', 'components/RankPrizeCatalog.jsx', 'packages/shared/questScore.js']],
  ['Settings (pushed under Me)', ['components/SettingsPanel.jsx', 'components/InstallCard.jsx', 'components/NameOnFinds.jsx', 'lib/credits.js']],
  ['Notifications (pushed under Settings)', ['components/PushSettings.jsx']],
  ['What the panel shows (pushed under Settings)', ['components/HiddenCards.jsx']],
  ['Collection (pushed under Me)', ['components/WorldCloset.jsx', 'lib/world.js']],
  ['Marks (pushed under Collection)', ['components/WorldMarks.jsx', 'lib/worldMarks.js']],
  ['Walk history (pushed under Settings)', ['components/MovementHistoryPanel.jsx']],
  ['Diagnostics (pushed under Settings)', ['components/Diagnostics.jsx']],
  ['Chrome (tabs, compass)', ['components/TabBar.jsx', 'components/CompassTape.jsx', 'app/page.js', 'app/globals.css']],
  ['Icons & brand marks', ['components/Icon.jsx', 'components/BrandMark.jsx', 'components/BrandLockup.jsx', 'public/icon.svg']],
  ['Language / copy', ['CONTEXT.md', 'lib/brand.js']],
];

/** Files that exist but are mounted nowhere — recorded, not silently dropped. */
export const UNMOUNTED = [];

export function readScreenMap() {
  const page = must(SOURCES.page);
  const missing = [];
  const rows = SCREEN_MAP.map(([screen, paths]) => ({
    screen,
    paths: paths.map((p) => {
      /* Two roots: most paths are inside the app, a couple (CONTEXT.md,
         packages/shared) are repo-level. Try the app first. */
      const appRel = `apps/party-tracker/${p}`;
      const rel = existsSync(join(root, appRel)) ? appRel : p;
      const ok = existsSync(join(root, rel));
      if (!ok) missing.push(`${screen} → ${p}`);
      return { path: p, rel, ok };
    }),
  }));

  for (const [file, why] of UNMOUNTED) {
    if (!existsSync(join(app, file))) missing.push(`unmounted list → ${file}`);
    void why;
  }
  if (missing.length) {
    throw new Error(
      `design-bundle: the screen map points at files that do not exist:\n  ${missing.join('\n  ')}\n` +
        `Fix SCREEN_MAP in scripts/lib/design-bundle/sources.mjs — this check is the whole point.`,
    );
  }
  return { rows, unmounted: UNMOUNTED, page };
}
