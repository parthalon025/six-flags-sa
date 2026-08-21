/**
 * Read the front end's ownership facts out of the app, rather than off a list.
 *
 * A hand-written screen map is what this module exists to replace. The design
 * import shipped one: it named `components/WorldPicker.jsx` and `lib/worlds.js`
 * when the repo had neither, five agents rediscovered the truth by hand, and
 * nothing in the build could tell it was wrong. Every export here answers its
 * question by reading the file that already owns the answer, so the map is
 * wrong only for as long as the code is.
 *
 * Where a fact cannot be derived, the reader records a gap and says why. An
 * honest "unresolved" is the whole improvement over the table this replaces —
 * a wrong entry is what sent people looking for files that did not exist.
 *
 * Interface:
 *   readScreens()   → tab/view → the components that render it, from app/page.js
 *   readClasses()   → CSS class → the components using it, from className usage
 *   readPairs()     → CSS custom property ↔ the JS constant its comment names
 *   readFactory()   → paths the venue builder owns, from the builder↔app policy
 *   readOrphans()   → components on disk that no importer names
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readTokens } from '../design-bundle/sources.mjs';

const libDir = dirname(fileURLToPath(import.meta.url));
export const root = join(libDir, '../../..');

/* Paths we read FROM. Named once, so a moved file is one edit and a loud
   failure rather than a section that quietly renders empty — the same reason
   design-bundle/sources.mjs keeps its own SOURCES block. */
export const SOURCES = {
  page: 'apps/party-tracker/app/page.js',
  components: 'apps/party-tracker/components',
  css: 'apps/party-tracker/app/globals.css',
  factoryPolicy: 'docs/agents/policies/builder-app-contract.md',
};

/** The app root every `@/…` import in this app resolves against. */
const APP = 'apps/party-tracker';

const read = (rel) => readFileSync(join(root, rel), 'utf8');

function must(rel) {
  if (!existsSync(join(root, rel))) {
    throw new Error(`frontend-map: source moved or missing — ${rel}`);
  }
  return read(rel);
}

/* ============================================================
   Shared scanning — one brace walker, used by three readers
   ============================================================ */

/**
 * Take the brace-balanced slice that starts at `open`.
 *
 * Quotes, template literals and comments are skipped, because a `}` inside a
 * string is not a closing brace and a JSX branch is full of both. Returns null
 * when the braces never balance, which the callers turn into a loud error —
 * a truncated region would silently drop the components at the end of it, and
 * a screen map missing its last owner is the failure this file is here to stop.
 */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) return null;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = endOfString(src, i);
      if (i === -1) return null;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/** Index of the closing quote of the string that opens at `at`. */
function endOfString(src, at) {
  const quote = src[at];
  for (let i = at + 1; i < src.length; i += 1) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    /* A template's `${…}` can hold another string, and inside it a bare
       backtick or apostrophe is content rather than a terminator. Recurse
       through the hole so `` `chip ${x ? 'on' : ''}` `` does not end early. */
    if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
      const inner = balanced(src, i + 1);
      if (inner === null) return -1;
      i += inner.length;
      continue;
    }
    if (src[i] === quote) return i;
  }
  return -1;
}

/* ============================================================
   Screens — apps/party-tracker/app/page.js
   ============================================================ */

/**
 * Where a component name imported by `page.js` actually lives.
 *
 * Both import forms count. Half this app's screens arrive through
 * `dynamic(() => import('@/components/X'))` rather than a static import, and a
 * map that read only the `import` lines would call every panel screen an
 * unresolved owner. The extension is probed rather than assumed because the
 * folder holds both `.jsx` components and `.js` hooks.
 */
function importedPaths(page) {
  const found = new Map();
  const add = (name, spec) => {
    if (!spec.startsWith('@/')) return;
    const base = `${APP}/${spec.slice(2)}`;
    const rel = ['.jsx', '.js', ''].map((ext) => base + ext).find((p) => existsSync(join(root, p)));
    found.set(name, rel ?? null);
  };
  for (const m of page.matchAll(/^import\s+([A-Z]\w*)\s+from\s+'([^']+)'/gm)) add(m[1], m[2]);
  for (const m of page.matchAll(/^const\s+([A-Z]\w*)\s*=\s*dynamic\(\s*\(\)\s*=>\s*import\('([^']+)'\)/gm)) {
    add(m[1], m[2]);
  }
  return found;
}

/** Pull the keys out of an object literal assigned to `name`, in source order. */
function objectKeys(page, name) {
  const at = page.indexOf(`const ${name} = {`);
  if (at === -1) throw new Error(`frontend-map: no "const ${name} = {" in ${SOURCES.page}`);
  const body = balanced(page, page.indexOf('{', at));
  if (body === null) throw new Error(`frontend-map: unbalanced braces after "const ${name}"`);
  return [...body.matchAll(/(?:^|[{,])\s*(?:'([\w-]+)'|([A-Za-z]\w*))\s*:/g)].map((m) => m[1] ?? m[2]);
}

/** Pull the string entries out of an array literal assigned to `name`. */
function arrayEntries(page, name) {
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(page);
  if (!m) throw new Error(`frontend-map: no "const ${name} = [" in ${SOURCES.page}`);
  return [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]);
}

/**
 * The render branches, as the source writes them.
 *
 * `page.js` gates every screen on one of two shapes — `{view === 'route' && (`
 * for a pushed screen and `{view === null && tab === 'party' && (` for a tab
 * root. The `&&` is what makes this a branch rather than a mention: `view ===
 * 'place' ? null : 'Back'` inside the nav header is a ternary about a label,
 * not a screen, and matching it would file `Icon` as an owner of the Place
 * screen. The `$` guard drops the same comparison written inside a template
 * literal, which is how the header builds its class name.
 */
const BRANCH_RE = /(?<!\$)\{\s*view === (null|'[\w-]+')\s*&&\s*([^\n]*?)\(\s*$/gm;

/**
 * Every JSX tag in a branch, with how deep it sits.
 *
 * Depth is what separates the panel that owns a screen from a glyph inside it.
 * The Explore Worlds screen renders `<Icon>`; it does not belong to `Icon`, it
 * belongs to `page.js`, which draws the whole list itself. Reporting the first
 * capitalised tag would have filed that screen under Icon — the same species
 * of wrong entry as the imported map's `components/WorldPicker.jsx`, arrived
 * at by a different route.
 *
 * `<` only opens a tag when a name or a `/` or `>` follows it immediately;
 * this stylesheet-free JSX writes its comparisons as `i < current`, with the
 * space that keeps the two apart.
 */
function tagDepths(region) {
  const tags = [];
  let depth = 0;
  for (let i = 0; i < region.length; i += 1) {
    const c = region[i];
    if (c === '/' && region[i + 1] === '/') {
      i = region.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (c === '/' && region[i + 1] === '*') {
      const end = region.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const end = endOfString(region, i);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (c !== '<' || !/[A-Za-z/>]/.test(region[i + 1] || '')) continue;

    if (region[i + 1] === '/') {
      depth -= 1;
      i = region.indexOf('>', i);
      if (i === -1) break;
      continue;
    }
    const name = /^<([A-Za-z][\w.]*)/.exec(region.slice(i))?.[1] ?? null;
    /* Walk to this tag's own `>`, stepping over any nested `{…}` prop so a
       handler body's braces and strings cannot be mistaken for the tag end. */
    let j = i + 1;
    for (; j < region.length; j += 1) {
      if (region[j] === '{') {
        const prop = balanced(region, j);
        if (prop === null) break;
        j += prop.length - 1;
        continue;
      }
      if (region[j] === '"' || region[j] === "'" || region[j] === '`') {
        const end = endOfString(region, j);
        if (end === -1) break;
        j = end;
        continue;
      }
      if (region[j] === '>') break;
    }
    const selfClosing = region[j - 1] === '/';
    if (name && /^[A-Z]/.test(name)) tags.push({ name, depth });
    if (!selfClosing) depth += 1;
    i = j;
  }
  return tags;
}

function renderBranches(page) {
  const branches = [];
  for (const m of page.matchAll(BRANCH_RE)) {
    const region = balanced(page, m.index + m[0].indexOf('{'));
    if (region === null) {
      throw new Error(`frontend-map: unbalanced branch at ${SOURCES.page}:${lineOf(page, m.index)}`);
    }
    const tab = /tab === '([\w-]+)'/.exec(m[2])?.[1] ?? null;
    branches.push({
      view: m[1] === 'null' ? null : m[1].slice(1, -1),
      tab,
      tags: tagDepths(region),
      line: lineOf(page, m.index),
    });
  }
  return branches;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

export function readScreens() {
  const page = must(SOURCES.page);
  const imports = importedPaths(page);
  const branches = renderBranches(page);

  /**
   * A screen's owners are the components the branch mounts directly — depth 0
   * when the branch is one panel, depth 1 when it is a fragment holding two.
   * Anything deeper is furniture inside markup `page.js` writes itself, and is
   * reported as `also`, so the map never hides it and never mistakes it for
   * the owner.
   */
  const owners = (match) => {
    const hits = branches.filter(match);
    const seen = new Map();
    for (const b of hits) {
      for (const t of b.tags) {
        if (!imports.has(t.name)) continue;
        seen.set(t.name, Math.min(seen.get(t.name) ?? t.depth, t.depth));
      }
    }
    const at = (keep) =>
      [...seen]
        .filter(([, depth]) => keep(depth))
        .map(([name]) => ({ name, path: imports.get(name) }));
    const components = at((d) => d <= 1);
    return {
      lines: hits.map((b) => b.line),
      components,
      also: at((d) => d > 1),
      /* A branch that mounts no component of its own draws the screen in
         `page.js` — Explore Worlds and On the map both do. Saying so is the
         answer an agent needs; an empty cell is not. */
      inline: hits.length > 0 && components.length === 0,
    };
  };

  const rootTitles = Object.fromEntries(
    objectKeys(page, 'ROOT_TITLES').map((k) => [
      k,
      new RegExp(`${k}: '([^']+)'`).exec(page.slice(page.indexOf('const ROOT_TITLES')))?.[1] ?? null,
    ]),
  );

  const tabs = arrayEntries(page, 'TAB_ORDER').map((tab) => ({
    kind: 'tab',
    id: tab,
    /* Explore is the one tab with no ROOT_TITLES entry: its title is the
       search field, because searching a map is why you opened that screen.
       Saying so beats printing an empty title cell. */
    title: rootTitles[tab] ?? '(the search field — no large title)',
    ...owners((b) => b.view === null && b.tab === tab),
  }));

  const views = objectKeys(page, 'VIEW_TITLES').map((view) => ({
    kind: 'view',
    id: view,
    title: new RegExp(`'?${view}'?: '([^']+)'`).exec(
      balanced(page, page.indexOf('{', page.indexOf('const VIEW_TITLES'))),
    )?.[1],
    ...owners((b) => b.view === view),
  }));

  /* Everything `page.js` mounts outside a screen branch: the map under the
     sheet, the tab bar, the gates and splashes that cover it. An agent sent to
     "the world picker" needs to learn here that it is not a screen — it is
     what `GpsGate` and `ParkPrompt` put on top of one. Derived by subtraction,
     so a component promoted to a screen leaves this list on its own. */
  const inBranch = new Set(branches.flatMap((b) => b.tags.map((t) => t.name)));
  const chrome = [...imports]
    .filter(([name]) => !inBranch.has(name) && new RegExp(`<${name}[\\s/>]`).test(page))
    .map(([name, path]) => ({ name, path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const screens = [...tabs, ...views];
  const gaps = [];
  for (const s of screens) {
    if (!s.lines.length) {
      gaps.push(`${s.kind} "${s.id}" is in the registry but no render branch in ${SOURCES.page} draws it`);
    }
    for (const c of s.components) {
      if (!c.path) gaps.push(`${s.kind} "${s.id}" renders <${c.name}>, whose import does not resolve to a file`);
    }
  }
  return {
    screens,
    chrome,
    gaps,
    unresolvedImports: [...imports].filter(([, p]) => p === null).map(([n]) => n),
  };
}

/**
 * Components on disk that nothing imports.
 *
 * The imported design twin's screen map named a `WorldPicker.jsx` the repo did
 * not have. The repo now has one, and nothing mounts it — the mirror-image
 * mistake, and just as expensive: an agent told to "edit the world picker"
 * finds a file, edits it, and ships nothing. A file no importer names is not
 * necessarily dead, but it is always worth knowing about before you touch it.
 */
export function readOrphans() {
  const files = frontEndFiles().filter((f) => f !== SOURCES.page);
  const imported = new Set();
  /* Both spellings count. `page.js` reaches its panels through the `@/`
     alias; a component reaching a sibling writes `./MapLegend`, and a reader
     that knew only the alias would call three mounted map layers dead. */
  const IMPORTED_RE = /(?:from|import\()\s*'(?:@\/components|\.)\/([\w/]+)'/g;
  for (const rel of [...files, SOURCES.page]) {
    for (const m of read(rel).matchAll(IMPORTED_RE)) imported.add(m[1]);
  }
  return files
    .map((rel) => rel.slice(`${SOURCES.components}/`.length))
    .filter((file) => !imported.has(file.replace(/\.jsx$/, '')))
    .sort();
}

/* ============================================================
   Classes — every className in the components and in page.js
   ============================================================ */

/** Every `.jsx` under components/, plus page.js. Hooks (`.js`) draw nothing. */
function frontEndFiles() {
  const dir = join(root, SOURCES.components);
  if (!existsSync(dir)) throw new Error(`frontend-map: source moved or missing — ${SOURCES.components}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => `${SOURCES.components}/${f}`);
  return [...files, SOURCES.page].sort();
}

/**
 * The static class names inside one `className=` expression.
 *
 * A template's interpolations are holes, not names: `` `lyr-${spec.id}` ``
 * contributes no class, and the `lyr-` in front of the hole is half of one. So
 * a chunk's first token is kept only when the chunk starts the template or
 * follows whitespace, and its last token only when it ends the template or is
 * followed by whitespace. Anything else is a fragment of a name that only
 * exists at runtime, and a map that listed it would be inventing classes —
 * exactly the habit this tool exists to break.
 */
function classesIn(expr) {
  const out = new Set();
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c !== '"' && c !== "'" && c !== '`') continue;
    const end = endOfString(expr, i);
    if (end === -1) break;
    const raw = expr.slice(i + 1, end);
    i = end;
    if (c !== '`') {
      for (const t of raw.split(/\s+/)) keep(out, t);
      continue;
    }
    /* Split the template on its holes, remembering which side of each chunk
       touches one. */
    const chunks = [];
    let start = 0;
    for (let j = 0; j < raw.length; j += 1) {
      if (raw[j] === '\\') { j += 1; continue; }
      if (raw[j] === '$' && raw[j + 1] === '{') {
        const hole = balanced(raw, j + 1);
        if (hole === null) break;
        chunks.push({ text: raw.slice(start, j), openEnd: true, openStart: chunks.length > 0 });
        /* The hole is where most of this app's state-dependent classes live —
           `` `chip ${on ? 'on' : ''}` `` is the shape nearly every toggle in
           the repo is written in, and a reader that skipped it would report
           `.on` as belonging to the three components that happen to spell it
           in a plain string. */
        keepAll(out, classesIn(hole));
        j += hole.length;
        start = j + 1;
      }
    }
    chunks.push({ text: raw.slice(start), openEnd: false, openStart: chunks.length > 0 });
    for (const ch of chunks) {
      const tokens = ch.text.split(/\s+/);
      if (ch.openStart && !/^\s/.test(ch.text)) tokens.shift();
      if (ch.openEnd && !/\s$/.test(ch.text)) tokens.pop();
      for (const t of tokens) keep(out, t);
    }
  }
  return out;
}

/* A class name, and nothing that merely looks like one. Rejects the sentence
   fragments and CSS values that share a quote with real class names. */
const CLASS_RE = /^[a-zA-Z][A-Za-z0-9_-]*$/;
const keep = (set, token) => {
  if (CLASS_RE.test(token)) set.add(token);
};
const keepAll = (set, more) => {
  for (const m of more) set.add(m);
};

/** The classes globals.css has a rule for, so a shared class can be looked up. */
function styledClasses() {
  const css = must(SOURCES.css);
  /* Selectors only: strip declaration blocks first, so `.chip` in a comment or
     a `content: '.foo'` value cannot pass for a rule. */
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{[^{}]*\}/g, ' ');
  return new Set([...selectors.matchAll(/\.([a-zA-Z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
}

export function readClasses() {
  const styled = styledClasses();
  const byClass = new Map();

  for (const rel of frontEndFiles()) {
    const src = read(rel);
    const file = rel.replace(`${SOURCES.components}/`, '').replace(`${APP}/app/`, '');
    for (const m of src.matchAll(/className=/g)) {
      const at = m.index + m[0].length;
      const expr =
        src[at] === '{'
          ? balanced(src, at)
          : src.slice(at, endOfString(src, at) + 1);
      if (!expr) continue;
      for (const cls of classesIn(expr)) {
        if (!byClass.has(cls)) byClass.set(cls, new Set());
        byClass.get(cls).add(file);
      }
    }
  }

  const rows = [...byClass]
    .map(([name, files]) => ({
      name,
      files: [...files].sort(),
      shared: files.size > 1,
      styled: styled.has(name),
    }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));

  return { rows, shared: rows.filter((r) => r.shared) };
}

/* ============================================================
   Paired constants — globals.css ↔ the JS that also owns the number
   ============================================================ */

/**
 * The stylesheet names its own counterparts, so the pair list is read rather
 * than kept.
 *
 * `globals.css` writes the relationship as prose — "This must equal
 * SHEET_PEEK_PX in lib/sheet.js", "Held in step with NIGHT_BARRED / DAY_BARRED
 * in lib/theme.js" — and that sentence is the only place the pairing is stated
 * anywhere. Reading it means a token that grows a counterpart tomorrow is
 * checked tomorrow, with nobody remembering to add a row. The shape it matches
 * is `CONSTANT in path/to/file.js`, optionally with `/`-separated alternatives.
 */
const COUNTERPART_RE = /([A-Z][A-Z0-9_]{2,}(?:\s*\/\s*[A-Z][A-Z0-9_]{2,})*)\s+in\s+([\w./-]+\.js)/g;

/** Any constant the note mentions, whether or not it says where it lives. */
const MENTION_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/**
 * What one named constant is worth, by the cheapest honest route.
 *
 * A module import is tried first because half these numbers are computed:
 * `SHEET_PEEK_PX` is a sum of five rungs, and parsing its expression would
 * mean reimplementing the arithmetic the module already does — the second copy
 * this whole tool argues against. Module-local constants such as
 * `NIGHT_BARRED` are not exported, so a literal `const NAME = …` is read from
 * source as the fallback. Anything else is reported unresolved, never guessed.
 */
async function constantValue(rel, name) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { value: null, why: `${rel} does not exist` };
  /* Only `lib/` is imported. Those modules are plain arithmetic and plain
     tables with no dependencies, which is what lets this run — and the CI Gate
     tier run it — before a workspace install. A component would drag in JSX,
     `next/dynamic` and the whole workspace to read one number out of it. */
  if (rel.startsWith(`${APP}/lib/`)) {
    try {
      const mod = await import(pathToFileURL(abs).href);
      if (mod[name] !== undefined) return { value: mod[name], via: 'export' };
    } catch (err) {
      /* An unimportable module is not a failed pairing yet — the constant may
         still be a plain literal. Fall through, and only then say so. */
      void err;
    }
  }
  const literal = new RegExp(`\\bconst ${name}\\s*=\\s*(-?[\\d.]+|'[^']*'|"[^"]*")\\s*;`).exec(
    readFileSync(abs, 'utf8'),
  );
  if (literal) {
    const raw = literal[1];
    return { value: /^['"]/.test(raw) ? raw.slice(1, -1) : Number(raw), via: 'literal' };
  }
  return {
    value: null,
    why:
      `${name} is neither an export of ${rel} nor a literal const in it` +
      nearest(name).map((n) => ` — did you mean ${n}?`).join(''),
  };
}

/**
 * The constant the comment probably meant, when the one it names is not there.
 *
 * `--shut` says "Kept in step with SHUT_PX in app/page.js" and the number
 * actually lives in `SHEET_SHUT_PX` in `lib/sheet.js`. Reporting only that the
 * name is missing leaves the reader to find that themselves, which is the cost
 * this whole file exists to remove — so the suggestion is derived by looking
 * for the named constant as the tail of a real one.
 */
function nearest(name) {
  const hits = [];
  for (const rel of ['app/page.js', ...libFiles()]) {
    const src = readFileSync(join(root, APP, rel), 'utf8');
    for (const m of src.matchAll(new RegExp(`\\bconst (\\w+_?${name})\\s*=`, 'g'))) {
      if (m[1] !== name) hits.push(`${m[1]} in ${rel}`);
    }
  }
  return hits;
}

/** Every module directly under lib/. Deep enough: the pairs all live there. */
const libFiles = () =>
  readdirSync(join(root, APP, 'lib'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `lib/${f}`);

/** Compare the two sides in whichever form they share. Null = not comparable. */
function agree(cssValue, jsValue) {
  if (typeof jsValue === 'number') {
    const px = /^(-?[\d.]+)px$/.exec(cssValue);
    return px ? Number(px[1]) === jsValue : null;
  }
  if (typeof jsValue === 'string') {
    const colour = /^#[0-9a-fA-F]{3,8}$/;
    if (colour.test(cssValue) && colour.test(jsValue)) return cssValue.toLowerCase() === jsValue.toLowerCase();
    return cssValue.trim() === jsValue.trim();
  }
  return null;
}

export async function readPairs() {
  const { rows } = readTokens();
  const pairs = [];
  const gaps = [];

  for (const row of rows) {
    const note = row.note || '';
    const declared = [
      { palette: 'night', value: row.value },
      ...(row.dayValue !== null ? [{ palette: 'day', value: row.dayValue }] : []),
    ];

    const named = [...note.matchAll(COUNTERPART_RE)];
    if (!named.length) {
      for (const mention of note.match(MENTION_RE) || []) {
        gaps.push(
          `${row.name} names ${mention} but not where it lives — write it as ` +
            `"${mention} in lib/<file>.js" and this pair gets checked`,
        );
      }
      continue;
    }

    for (const [, namesRaw, file] of named) {
      const names = namesRaw.split('/').map((n) => n.trim());
      const rel = `${APP}/${file}`;
      for (const { palette, value } of declared) {
        /* One note can name a constant per palette — `NIGHT_BARRED /
           DAY_BARRED` is the stylesheet describing both blocks in one
           sentence. Match by the palette's own name; a lone constant governs
           whichever blocks declare the token. */
        const name =
          names.length === 1
            ? names[0]
            : names.find((n) => n.toUpperCase().startsWith(palette.toUpperCase()));
        if (!name) continue;
        // eslint-disable-next-line no-await-in-loop
        const js = await constantValue(rel, name);
        const ok = js.value === null ? null : agree(value, js.value);
        pairs.push({ css: row.name, palette, cssValue: value, js: name, file: rel, ...js, ok });
        if (js.value === null) gaps.push(`${row.name} (${palette}) → ${js.why}`);
        else if (ok === null) {
          gaps.push(
            `${row.name} (${palette}) is "${value}" and ${name} is ` +
              `${JSON.stringify(js.value)} — no shared form to compare them in`,
          );
        }
      }
    }
  }
  return { pairs, gaps, diverged: pairs.filter((p) => p.ok === false) };
}

/* ============================================================
   Factory boundary — docs/agents/policies/builder-app-contract.md
   ============================================================ */

/**
 * Which paths are venue-builder output, read off the policy that says so.
 *
 * The policy already carries the list, in backticks, in one sentence. Copying
 * it here would put a second answer in the repo, and the second answer is
 * always the one that goes stale — the sentence is anchored on its own words
 * so a rewrite fails loudly instead of silently emptying the section.
 */
/* The paragraph runs to the blank line rather than to the first full stop:
   the paths it lists are `*.map.json`, `*.pois.json`, `manifest.json` — every
   one of them holds a dot, so sentence-splitting on `.` would cut the list in
   half at its first entry. */
const OUTPUT_ANCHOR = /is the only thing allowed to write([\s\S]*?)\n\n/;
const INPUT_ANCHOR = /`([^`]+)`\s+is builder input and is meant to be hand-edited/;

function anchored(md, re, what) {
  const m = re.exec(md);
  if (!m) {
    throw new Error(
      `frontend-map: ${SOURCES.factoryPolicy} no longer reads /${re.source}/ — the ${what} list ` +
        `is derived from that sentence. Re-anchor this reader on the policy's new wording.`,
    );
  }
  return m[1];
}

export function readFactory() {
  const md = must(SOURCES.factoryPolicy);
  /* Paths, not the `npm run venues:*` invocation the same paragraph names —
     a generated file has a slash in it and a command does not. */
  const outputs = [...anchored(md, OUTPUT_ANCHOR, 'builder-output').matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((span) => span.includes('/') && !span.startsWith('npm '));
  return { outputs, inputs: [anchored(md, INPUT_ANCHOR, 'builder-input')], policy: SOURCES.factoryPolicy };
}
