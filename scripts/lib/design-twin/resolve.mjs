/**
 * Resolve what the browser saw back onto the code that produced it.
 *
 * The capture records DOM evidence — the class names on screen, the strings on
 * screen, the tokens the matching CSS rules actually asked for. This file turns
 * that evidence into the four things a designer needs and a mockup never has:
 *
 *   who renders this      → the components that DECLARE the classes on screen
 *   what it costs         → the tokens, cross-checked against globals.css
 *   what it says          → each string traced back to the file it is written in
 *   what it does not show → the branches those components have and this shot did not
 *
 * Every one of those is read out of the repo. Nothing here invents a name, a
 * count or a string: a value that cannot be traced is reported as untraced,
 * because a plausible-looking placeholder is the exact failure that cost this
 * project a session (`PB-4K9T`, `Search 100+ Worlds`, `--cat-food`).
 *
 * Interface:
 *   sourceIndex()                     → { components, libs, data, all }
 *   resolveOwners(classes, index)     → [{ file, weight, matched }]
 *   traceCopy(strings, index)         → [{ text, sources, how }]
 *   statesNotShown(owners, seen, idx) → [{ file, className, line, source, flagged }]
 *   crossCheckTokens(tokens)          → [{ name, inPalette, group }]
 *   annotate(screens)                 → { annotated, sources }
 *   profileShown(diff, gained, lost)  → is a seeded-Profile shot worth carrying?
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { root, readTokens } from '../design-bundle/sources.mjs';

const APP = 'apps/party-tracker';

/* ============================================================
   The source index
   ============================================================ */

/** Every file under `rel` matching `test`, as repo-relative posix paths. */
function walk(rel, test, acc = []) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return acc;
  for (const name of readdirSync(abs)) {
    const child = posix.join(rel, name);
    if (statSync(join(root, child)).isDirectory()) walk(child, test, acc);
    else if (test(name)) acc.push(child);
  }
  return acc;
}

/**
 * The files a screen's claims may be traced to, in three tiers.
 *
 * `components` is where class names are declared, so it is what ownership is
 * resolved against. `libs` and `data` are where copy and Place names live —
 * `lib/brand.js` writes the app's own voice, and the venue JSON is the Place
 * names the map draws. A string found in none of the three is untraced, and
 * the twin says so on the page rather than dressing it up.
 */
export function sourceIndex() {
  const components = [
    ...walk(`${APP}/components`, (n) => /\.(jsx|js)$/.test(n)),
    ...walk(`${APP}/app`, (n) => /\.(jsx|js)$/.test(n)),
  ].sort();
  const libs = walk(`${APP}/lib`, (n) => /\.(js|mjs)$/.test(n))
    .concat(walk('packages/shared', (n) => /\.js$/.test(n)))
    .concat(['CONTEXT.md'])
    .sort();
  const data = walk(`${APP}/public/venues`, (n) => n.endsWith('.json')).sort();

  const text = new Map();
  const read = (rel) => {
    if (!text.has(rel)) text.set(rel, readFileSync(join(root, rel), 'utf8'));
    return text.get(rel);
  };
  return { components, libs, data, all: [...components, ...libs, ...data], read };
}

/* ============================================================
   Ownership — which components render this screen
   ============================================================ */

/**
 * Every class name a file writes into a `className`.
 *
 * The app writes classes as literals — `className="poiRow"`,
 * `` className={`chip ${on ? 'on' : ''}`} `` — so the literal text between the
 * template's holes is the class set the file can put on screen. That is what
 * makes ownership derivable at all: a class on screen was written by whoever
 * wrote the class, and nobody has to keep a table of it.
 *
 * Returns Map<className, { line, source }> — the line is kept because it is the
 * evidence a reader needs to check the claim, and because the branch a class
 * sits in is the state the class stands for.
 */
export function classLiterals(src) {
  const out = new Map();
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{'([^']*)'\}|\{"([^"]*)"\})/g)) {
      const literal = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
      /* Template holes carry the conditional half of the class list. Blanking
         them leaves the literal halves, which is what we can attribute. */
      for (const word of literal.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (!/^[a-zA-Z][\w-]*$/.test(word)) continue;
        if (!out.has(word)) out.set(word, { line: i + 1, source: lines[i].trim() });
      }
    }
    /* Classes chosen inside a template hole still name a real branch —
       `${on ? 'on' : ''}` and `${stop === 'full' ? 'full' : 'peek'}`. Pick the
       quoted words out of the holes on a className line so those states are
       not invisible. */
    if (/className\s*=/.test(lines[i])) {
      for (const m of lines[i].matchAll(/\$\{[^}]*\}/g)) {
        for (const q of m[0].matchAll(/'([a-zA-Z][\w-]*)'/g)) {
          if (!out.has(q[1])) out.set(q[1], { line: i + 1, source: lines[i].trim() });
        }
      }
    }
  }
  return out;
}

/** className → the component files that declare it. Built once per resolve pass. */
export function declarationMap(index) {
  const byClass = new Map();
  const byFile = new Map();
  for (const rel of index.components) {
    const declared = classLiterals(index.read(rel));
    byFile.set(rel, declared);
    for (const name of declared.keys()) {
      if (!byClass.has(name)) byClass.set(name, []);
      byClass.get(name).push(rel);
    }
  }
  return { byClass, byFile };
}

/**
 * Which components render a screen, from the classes that were on it.
 *
 * ADMISSION is one rule and it is not a threshold: a file is on this screen if
 * at least one class it declares EXCLUSIVELY was on it. `poiRow` is declared by
 * PlaceList and nothing else, so `poiRow` on screen is PlaceList on screen —
 * that is not a score, it is an identification.
 *
 * The alternative, admitting a file once its shared classes add up, is wrong in
 * a way that is worth recording because it shipped for an afternoon: WorldPicker
 * was listed as rendering Place detail on the strength of `btn`, `chip`, `field`
 * and `label` — nine classes it shares with a dozen files, no class of its own,
 * and it is not on that screen at all. A twin that names a component which is
 * not there sends an implementer to the wrong file, which is precisely the cost
 * this project already paid once.
 *
 * RANKING is then the inverse-document-frequency sum: an exclusive class is
 * worth a whole point, a class six files declare is worth a sixth. It orders
 * the list; it never decides membership.
 */
export function resolveOwners(classes, index, decl = declarationMap(index)) {
  const scored = [];
  for (const [file, declared] of decl.byFile) {
    let weight = 0;
    const matched = [];
    for (const name of classes) {
      if (!declared.has(name)) continue;
      const sharedBy = decl.byClass.get(name).length;
      weight += 1 / sharedBy;
      matched.push({ name, sharedBy });
    }
    if (!matched.some((m) => m.sharedBy === 1)) continue;
    scored.push({
      file,
      weight: Number(weight.toFixed(2)),
      matched: matched.sort((a, b) => a.sharedBy - b.sharedBy || a.name.localeCompare(b.name)),
    });
  }
  return scored.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
}

/* ============================================================
   Copy — every string on screen, traced to where it is written
   ============================================================ */

/**
 * Normalise a string so a JSX literal and the text the browser painted compare
 * equal. JSX writes `what&apos;s`, the DOM shows `what's`; the stylesheet's
 * `text-transform` shows OKTOBERFEST for a source that says Oktoberfest; and
 * a designer's curly apostrophe and a programmer's straight one are the same
 * word. Everything here is presentation, none of it is identity.
 */
const normalise = (s) =>
  String(s)
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The first `n` words of a string — the fallback probe for copy broken by a JSX hole. */
const words = (s, n) => s.split(' ').slice(0, n).join(' ');

/* A phrase shorter than this proves nothing: "Me", "All", "73°" appear in
   hundreds of files by accident, and a match on one of them is noise dressed as
   provenance. Below the floor the twin reports the string as too short to trace
   rather than claiming a source it does not believe. */
const TRACEABLE_MIN_CHARS = 4;

/* Above this many hits, a match is a coincidence rather than a source. "Here"
   is on the Party screen and is also inside a sentence in a dozen comments and
   route handlers; listing four of those as "written in" would be provenance
   theatre. Past the cutoff the twin says how many files contain the phrase and
   declines to name one. */
const AMBIGUOUS_ABOVE = 6;

/* Comments are stripped before a source is searched.
 *
 * This repo comments heavily and in full sentences, so its prose is full of
 * ordinary English — and an ordinary English word on screen ("Here", "Eating",
 * "In line") will match a comment in a file that has nothing to do with the
 * screen. That is a FALSE source, and a false source is worse than none: it
 * tells a reader to go and edit the wrong file. Copy lives in string literals
 * and JSX text, never in a comment, so dropping comments costs nothing real.
 *
 * Markdown and JSON are left alone: CONTEXT.md's prose IS a legitimate source
 * (the vocabulary the app is written in), and venue data has no comments.
 */
const stripComments = (rel, text) =>
  /\.(md|json)$/.test(rel)
    ? text
    : text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* One normalised copy of every source, built once per process.
 *
 * `traceCopy` is called once per screen and there are seventeen of them; folding
 * two megabytes of source through five regexes seventeen times is a minute of
 * nothing. The cache is keyed on the index, so a caller with a different source
 * set still gets its own. */
const haystacks = new WeakMap();
function haystackFor(index) {
  if (!haystacks.has(index)) {
    haystacks.set(
      index,
      index.all.map((rel) => [rel, normalise(stripComments(rel, index.read(rel)))]),
    );
  }
  return haystacks.get(index);
}

export function traceCopy(strings, index) {
  const haystack = haystackFor(index);
  return strings.map((text) => {
    const needle = normalise(text);
    if (needle.length < TRACEABLE_MIN_CHARS) return { text, sources: [], how: 'too-short' };

    const exact = haystack.filter(([, hay]) => hay.includes(needle)).map(([rel]) => rel);
    if (exact.length > AMBIGUOUS_ABOVE) {
      return { text, sources: exact.slice(0, 4), how: 'ambiguous', hits: exact.length };
    }
    if (exact.length) return { text, sources: exact, how: 'exact' };

    /* A line of copy interrupted by a JSX hole — `Nothing in {label} matches` —
       cannot match whole. Its opening words still can, and three words is long
       enough to be that sentence rather than a coincidence. */
    for (let n = Math.min(6, needle.split(' ').length); n >= 3; n -= 1) {
      const probe = words(needle, n);
      const hits = haystack.filter(([, hay]) => hay.includes(probe)).map(([rel]) => rel);
      if (hits.length > AMBIGUOUS_ABOVE) {
        return { text, sources: hits.slice(0, 4), how: 'ambiguous', hits: hits.length };
      }
      if (hits.length) return { text, sources: hits, how: `prefix-${n}` };
    }
    return { text, sources: [], how: 'untraced' };
  });
}

/* ============================================================
   States this shot does not show
   ============================================================ */

/* The words that mark a branch worth putting at the top of the list.
 *
 * HARDCODED, and this is the reason: these are English, not code. There is no
 * file in the repo that enumerates "the states a screen can be in" — the states
 * are branches, and what makes `emptyNote` more interesting to a designer than
 * `withDot` is what the word means. The list only REORDERS what is already
 * derived; every unshown branch is listed either way, so a state whose name is
 * not in here is demoted, never hidden.
 */
const STATE_WORDS =
  /empty|offline|error|fail|denied|blocked|missing|none|no-?fix|stale|loading|pending|unavailable|down|gap|fallback|locked|gate|warn|retry|skeleton|placeholder/i;

/**
 * The branches the owning components can render that this capture did not.
 *
 * Derived by subtraction: a component declares a set of classes, the shot
 * contains a subset of them, and the difference is the screen this shot is not
 * showing. That is the whole trick, and it needs no vocabulary of states and no
 * hand-written list — a branch added to a component appears here on the next
 * build without this file changing.
 *
 * Classes shared with other components are dropped: a shared class is not this
 * component's branch, and including it would fill the list with `btn` and `row`.
 */
export function statesNotShown(owners, seen, index, decl = declarationMap(index)) {
  const on = new Set(seen);
  const out = [];
  for (const owner of owners) {
    for (const [name, where] of decl.byFile.get(owner.file)) {
      if (on.has(name)) continue;
      if (decl.byClass.get(name).length > 1) continue;
      out.push({
        file: owner.file,
        className: name,
        line: where.line,
        source: where.source.slice(0, 180),
        flagged: STATE_WORDS.test(name),
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.flagged) - Number(a.flagged) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

/* ============================================================
   Tokens — the same reader the rest of the bundle uses
   ============================================================ */

/**
 * Cross-check the tokens the browser measured against the palette the design
 * bundle already parses out of globals.css.
 *
 * Deliberately reusing `readTokens()` rather than parsing the stylesheet again:
 * two readers of one file is two answers waiting to disagree, and the token
 * page and this page have to be describing the same palette or neither is
 * worth reading. A token the browser used that the palette does not define is
 * flagged, not dropped — `--font-display` is one, injected by next/font, and a
 * designer should be told that rather than shown a name with nothing behind it.
 */
export function crossCheckTokens(tokenNames, tokens = readTokens()) {
  const byName = new Map(tokens.rows.map((t) => [t.name, t]));
  return tokenNames
    .map((name) => {
      const row = byName.get(name);
      return {
        name,
        inPalette: Boolean(row),
        group: row?.group ?? null,
        night: row?.resolved ?? null,
        day: row?.dayResolved ?? row?.resolved ?? null,
      };
    })
    .sort((a, b) => Number(b.inPalette) - Number(a.inPalette) || a.name.localeCompare(b.name));
}

/* ============================================================
   The whole annotation pass
   ============================================================ */

/**
 * Is this screen's seeded-Profile shot worth carrying?
 *
 * The naive answer — "the screens where something changed" — is wrong twice
 * over, and both wrong answers were built and thrown away:
 *
 *   A STRING diff marks everything changed. The app draws a clock, so every
 *   screen gains "3 min ago" and loses "2 min ago" between the two walks. That
 *   filed seventeen near-identical extra shots and buried the three that matter.
 *
 *   A CLASS diff alone misses the best screen in the set. Marks renders its
 *   signed-out gate and its signed-in state with the same classes and different
 *   words, so the one screen where a Profile visibly changes what a guest can DO
 *   scored zero and was dropped.
 *
 * So: a branch appearing or disappearing counts, and so does COPY appearing or
 * disappearing — copy meaning a string that traces to a file, which a clock
 * reading never does. Live values are exactly the strings the tracer cannot
 * place, so the thing that makes them untraceable is the thing that filters
 * them out. Nothing here needs a list of volatile strings to maintain.
 */
const traceable = (c) => c.sources.length > 0 && c.how !== 'ambiguous';

export function profileShown(diff, gainedCopy, lostCopy) {
  if ((diff.classesGained ?? []).length || (diff.classesLost ?? []).length) return true;
  return gainedCopy.some(traceable) || lostCopy.some(traceable);
}

/**
 * Annotate every captured screen, and report the files the annotations were
 * read from.
 *
 * Split out of the capture on purpose: the browser's job is to observe, and
 * observation is expensive (a server, a browser, ten minutes). Turning the
 * observation into claims about the code is cheap and pure, so
 * `node scripts/design-twin.mjs resolve` can re-run it on the committed record
 * whenever a reader here improves — no re-photographing, and the shots stay
 * byte-identical.
 *
 * The returned `sources` set is what the staleness gate is keyed on: exactly the
 * files that were read to make a claim. A file nothing was read from cannot
 * make the twin wrong, and putting it in the key would only make the check fire
 * on work it cannot judge.
 */
export function annotate(screens, index = sourceIndex()) {
  const decl = declarationMap(index);
  const sources = new Set();
  const annotated = screens.map((screen) => {
    if (!screen.evidence) {
      return { ...screen, profile: null, owners: [], tokens: [], copy: [], states: [] };
    }
    const owners = resolveOwners(screen.evidence.classes, index, decl);
    const copy = traceCopy([...screen.evidence.strings, ...screen.evidence.labels], index);
    const states = statesNotShown(owners, screen.evidence.classes, index, decl);
    /* The strings a Profile ADDS are copy too, and get the same treatment as the
       rest: traced back to the file that writes them, or reported as untraced.
       A signed-in screen is exactly where a twin is most tempted to invent, so
       it is exactly where the tracing must not be skipped. */
    const profile = screen.profile
      ? (() => {
          const gainedCopy = traceCopy(screen.profile.stringsGained, index);
          const lostCopy = traceCopy(screen.profile.stringsLost, index);
          return { ...screen.profile, gainedCopy, lostCopy, shown: profileShown(screen.profile, gainedCopy, lostCopy) };
        })()
      : null;

    for (const o of owners) sources.add(o.file);
    for (const c of [...copy, ...(profile?.gainedCopy ?? [])]) for (const s of c.sources) sources.add(s);

    return { ...screen, profile, owners, tokens: crossCheckTokens(screen.evidence.tokens), copy, states };
  });
  return { annotated, sources: [...sources] };
}
