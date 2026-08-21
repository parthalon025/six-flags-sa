/**
 * Compose the generated design-system bundle.
 *
 * Sources of truth: apps/party-tracker/app/globals.css, lib/world.js,
 * lib/sheet.js, components/Icon.jsx, CONTEXT.md.
 * Generated output: docs/design/system/*.html + _ds_manifest.json + the
 * vendored woff2 under docs/design/system/vendor/fonts/, so the directory is a
 * self-contained unit that can be pushed to a Design project on its own.
 *
 * Same shape as scripts/lib/agent-docs/compose.mjs — compose to a
 * Map<relPath, contents>, then write it or diff it — so `design:check`
 * behaves the way `agent-docs:check` already does.
 *
 * Interface:
 *   composeDesignBundle()  → Map<relPath, contents>
 *   writeDesignBundle()    → relPaths written
 *   checkDesignBundle()    → [{ path, reason }]  (empty when fresh)
 *   designSyncPlan()       → [{ projectPath, localPath, mimeType, bytes }]
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { join, dirname, posix } from 'node:path';
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
import { renderPages, PAGES, FONT_WEIGHTS, FONT_DIR, fontFile } from './render.mjs';

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

/* ------------------------------------------------------------------
   The pushable unit
   ------------------------------------------------------------------ */

/* The DesignSync limits the bundle has to satisfy to be pushable.
 *
 * HARDCODED, and this comment is the reason: these are DesignSync's documented
 * per-call limits, and this environment cannot load the tool's schema to read
 * them back — DesignSync is not exposed to a remote session at all, and
 * `/design-login` needs an interactive terminal. They are therefore transcribed
 * from the documented contract rather than derived, which makes them the one
 * drift risk in this file. If a push ever fails on a limit, correct it HERE:
 * the test and `design:plan` both read these, so one edit moves everything.
 */
export const DESIGN_SYNC_LIMITS = {
  maxFileBytes: 256 * 1024,
  maxFilesPerCall: 256,
  maxProjectPathChars: 256,
};

/* The typeface, vendored INTO the push unit.
 *
 * Upstream is the copy docs/design/parkbound-twin already has — the @fontsource
 * latin subset — so there is still one place a font version is bumped. The
 * bytes are copied in at build time because DesignSync pushes to
 * project-relative paths: a page that reached back out with `../` resolves to
 * nothing once it is pushed on its own, and the typeface falls back to the
 * system stack without saying so. A design system that misrepresents its own
 * type is worse than no design system, which is the same argument the glyph
 * reader is held to.
 *
 * Which weights travel is FONT_WEIGHTS in render.mjs — the same list the
 * @font-face rules are generated from, so the CSS and the bytes cannot disagree.
 */
const FONT_SOURCE_DIR = 'docs/design/parkbound-twin/vendor/fonts';

/** MIME by extension — what DesignSync's `write_files` wants alongside `localPath`. */
const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export const mimeFor = (relPath) => MIME[relPath.slice(relPath.lastIndexOf('.'))] ?? 'text/plain';

function vendoredFonts() {
  const out = new Map();
  for (const weight of FONT_WEIGHTS) {
    const name = fontFile(weight);
    const from = join(root, FONT_SOURCE_DIR, name);
    if (!existsSync(from)) {
      throw new Error(
        `design-bundle: ${FONT_SOURCE_DIR}/${name} is missing, so the bundle cannot be made ` +
          `self-contained. FONT_WEIGHTS in render.mjs asks for weight ${weight}.`,
      );
    }
    out.set(posix.join(OUT_DIR, FONT_DIR, name), readFileSync(from));
  }
  return out;
}

export async function composeDesignBundle() {
  const model = await buildModel();
  const pages = renderPages(model);
  const out = new Map();
  for (const [name, contents] of pages) out.set(posix.join(OUT_DIR, name), contents);
  for (const [rel, bytes] of vendoredFonts()) out.set(rel, bytes);
  return { outputs: out, model };
}

/**
 * The bundle as DesignSync would push it: one row per file, carrying the
 * project-relative path it lands on, the `localPath` to read it from, its
 * `mimeType` and its size. Everything a push needs, derived — so neither the
 * wizard nor the test has to restate a path.
 */
export async function designSyncPlan() {
  const { outputs } = await composeDesignBundle();
  return [...outputs].map(([rel, contents]) => ({
    projectPath: rel.slice(OUT_DIR.length + 1),
    localPath: rel,
    mimeType: mimeFor(rel),
    bytes: Buffer.isBuffer(contents) ? contents.length : Buffer.byteLength(contents, 'utf8'),
  }));
}

/* ------------------------------------------------------------------
   Writing and checking
   ------------------------------------------------------------------ */

/** Every file under `dir`, relative to the repo root. Recursive: the bundle has subdirectories now. */
function walk(dir, acc = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, acc);
    else acc.push(rel);
  }
  return acc;
}

const same = (a, b) => {
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) return Buffer.from(a).equals(Buffer.from(b));
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  return normalize(a) === normalize(b);
};

export async function writeDesignBundle() {
  const { outputs, model } = await composeDesignBundle();
  mkdirSync(join(root, OUT_DIR), { recursive: true });

  /* Sweep anything a previous build wrote and this one no longer emits. The
     whole directory is generated, so "not in outputs" means "stale" — a renamed
     page or a dropped font weight lingering here would be pushed to the project
     and become drift of exactly the kind this script exists to stop. Empty
     directories are pruned after, so a removed subdirectory does not survive. */
  const expected = new Set(outputs.keys());
  const present = walk(OUT_DIR);
  for (const rel of present) if (!expected.has(rel)) unlinkSync(join(root, rel));

  for (const [rel, contents] of outputs) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), contents);
  }

  const keptDirs = new Set([...expected].map((rel) => posix.dirname(rel)));
  for (const dir of new Set(present.map((rel) => posix.dirname(rel)))) {
    if (dir !== OUT_DIR && !keptDirs.has(dir) && existsSync(join(root, dir))) {
      rmdirSync(join(root, dir));
    }
  }

  return { written: [...outputs.keys()], model };
}

export async function checkDesignBundle() {
  const { outputs, model } = await composeDesignBundle();
  const drift = [];

  for (const [rel, expected] of outputs) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      drift.push({ path: rel, reason: 'missing' });
      continue;
    }
    if (!same(readFileSync(abs), expected)) drift.push({ path: rel, reason: 'content drift' });
  }

  if (existsSync(join(root, OUT_DIR))) {
    const expectedNames = new Set(outputs.keys());
    for (const rel of walk(OUT_DIR)) {
      if (!expectedNames.has(rel)) drift.push({ path: rel, reason: 'not generated by this build' });
    }
  }

  return { drift, model };
}

/* ------------------------------------------------------------------
   Push readiness
   ------------------------------------------------------------------ */

/**
 * Every reference a page makes: `src=` / `href=` attributes and CSS `url()`.
 * Fragments are dropped — `#foo` is a reference to the page itself.
 */
export function pageReferences(html) {
  const attrs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
  const urls = [...html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
  return [...attrs, ...urls].map((r) => r.split('#')[0]).filter(Boolean);
}

/**
 * Is the bundle pushable? Returns a list of violations — empty means yes.
 *
 * This is the gate that `docs/design/system/` is a *self-contained unit*, which
 * is the property DesignSync actually needs and the one the bundle silently
 * lacked: every page carried `url('../parkbound-twin/vendor/fonts/…')`, and a
 * page pushed to a project has no `../parkbound-twin/` above it, so the
 * typeface fell back to the system stack and the bundle misrepresented the
 * app's own type without failing anything.
 *
 * The reference rule is deliberately stated as *resolution* rather than as a
 * list of forbidden shapes: every reference must name a file that is in the
 * push plan. That one rule subsumes `../`, absolute filesystem paths, http(s)
 * URLs, protocol-relative URLs and plain dangling links, and it cannot be
 * satisfied by a reference nobody thought to ban.
 *
 * Shared by `design:plan` and test/scripts/design-bundle.test.mjs so the gate
 * and its proof are the same code.
 */
export function auditPushReadiness(plan, pages) {
  const problems = [];
  const inPlan = new Set(plan.map((f) => f.projectPath));

  for (const [file, group] of PAGES) {
    const html = pages.get(file);
    if (!html) {
      problems.push(`${file} is in PAGES but was not rendered`);
      continue;
    }
    if (html.split('\n')[0] !== `<!-- @dsCard group="${group}" -->`) {
      problems.push(
        `${file} does not open with <!-- @dsCard group="${group}" --> on its first line — ` +
          `the project builds its card index from that line, so the card would be lost`,
      );
    }
    for (const ref of pageReferences(html)) {
      if (!inPlan.has(ref)) {
        problems.push(
          `${file} references "${ref}", which is not a file in the push root — once pushed, ` +
            `that path resolves to nothing`,
        );
      }
    }
  }

  for (const f of plan) {
    if (f.bytes > DESIGN_SYNC_LIMITS.maxFileBytes) {
      problems.push(
        `${f.projectPath} is ${f.bytes} bytes, over DesignSync's ` +
          `${DESIGN_SYNC_LIMITS.maxFileBytes}-byte per-file cap`,
      );
    }
    if (f.projectPath.length > DESIGN_SYNC_LIMITS.maxProjectPathChars) {
      problems.push(
        `${f.projectPath} is ${f.projectPath.length} chars, over DesignSync's ` +
          `${DESIGN_SYNC_LIMITS.maxProjectPathChars}-char project-path cap`,
      );
    }
  }

  if (plan.length > DESIGN_SYNC_LIMITS.maxFilesPerCall) {
    problems.push(
      `the bundle is ${plan.length} files, over DesignSync's ` +
        `${DESIGN_SYNC_LIMITS.maxFilesPerCall}-file per-call limit`,
    );
  }

  return problems;
}

export { PAGES };
