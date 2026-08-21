/**
 * Render the front-end map as Markdown.
 *
 * Markdown rather than the HTML the design bundle emits, because the reader is
 * an agent with a terminal rather than a designer with a browser: this file is
 * opened by `grep`, `cat` and a session's first Read, and every one of those
 * shows a table better than it shows a stylesheet.
 *
 * Nothing here decides anything. Every number and path on the page arrives in
 * `model`, already read out of the app by sources.mjs; this module chooses
 * headings and column order and says what each section is for.
 *
 * Interface:
 *   renderMap(model) → the whole document, as a string
 */
import { FLOORS } from './contrast.mjs';

const code = (s) => `\`${s}\``;
const list = (xs, empty = '—') => (xs.length ? xs.join(', ') : empty);

/** A Markdown table from a header row and body rows, or a line saying it is empty. */
function table(headers, rows, empty) {
  if (!rows.length) return `${empty}\n`;
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |`;
  return `${head}\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
}

function screensSection(screens, page) {
  const rows = screens.screens.map((s) => [
    code(s.id),
    s.kind,
    s.title ?? '—',
    s.components.length
      ? s.components.map((c) => `${code(c.name)} — ${code(c.path)}`).join('<br>')
      : `**drawn inline** in ${code(page)}`,
    list(s.also.map((c) => code(c.name))),
    s.lines.map((l) => `${page}:${l}`).join('<br>'),
  ]);

  return `## Screens → the component that owns them

Derived from ${code(page)}: \`TAB_ORDER\` and \`ROOT_TITLES\` for the tab roots,
\`VIEW_TITLES\` for the pushed screens, and the \`{view === … && (\` render branch that
draws each one. **Owner** is what the branch mounts directly; **also renders** is
everything deeper, which is furniture inside markup \`page.js\` writes itself. A screen
whose branch mounts no component of its own says so — that is where the edit goes.

${table(['screen', 'kind', 'title', 'owner', 'also renders', 'branch'], rows, '_No screens found — the registry read failed._')}
### Chrome and overlays

Mounted by ${code(page)} outside any screen branch: the map under the sheet, the tab
bar, and the gates and splashes that cover them. Editing one of these changes every
screen at once.

${screens.chrome.map((c) => `- ${code(c.name)} — ${code(c.path)}`).join('\n')}
`;
}

function orphansSection(orphans) {
  if (!orphans.length) return '### Nothing unmounted\n\nEvery component under `components/` has an importer.\n';
  return `### On disk, imported by nothing

${orphans.map((f) => `- ${code(f)}`).join('\n')}

A file no importer names is not necessarily dead, but editing one ships nothing. Check
before you spend a pass on it.
`;
}

function classesSection(classes) {
  const rows = classes.shared.map((c) => [
    code(`.${c.name}`),
    String(c.files.length),
    c.styled ? 'yes' : '**no rule**',
    c.files.map(code).join(' '),
  ]);

  return `## Shared classes — changing one is a cross-screen edit

Every class name that appears in a \`className\` on two or more files under
\`apps/party-tracker/components/\` or in \`app/page.js\`. Static names only: a
\`\${…}\` hole in a template contributes nothing, because a class that only exists at
runtime is not a class this map can promise anything about.

**A class on this list is shared. Do not give it a local override.** Four agents each
patching \`.chip.on\` in their own component is how one considered change becomes four
that disagree; settle the rule once, in \`globals.css\`, before anyone edits.

\`rule?\` is whether \`globals.css\` has a selector for the name — **no rule** means the
class is being written and nothing styles it.

${table(['class', 'files', 'rule?', 'used by'], rows, '_No shared classes._')}
Total distinct classes in use: **${classes.rows.length}**, of which **${classes.shared.length}** are shared.
`;
}

function pairsSection(pairs) {
  const rows = pairs.pairs.map((p) => [
    code(p.css),
    p.palette,
    code(p.cssValue),
    code(p.js),
    code(p.file),
    p.value === null ? '—' : code(String(p.value)),
    p.ok === true ? 'agree' : p.ok === false ? '**DIVERGED**' : '**unresolved**',
  ]);

  return `## Constants that exist twice

A CSS custom property and a JS constant that have to hold the same number are two
copies of one decision, and two copies drift. \`--peek\` said \`308px\` while
\`SHEET_PEEK_PX\` computed \`236\`; no test failed, because the layout was not broken —
only briefly wrong on the first paint, at the one stop the app rests on.

The pairs are not kept in a list here. \`globals.css\` states each one in its own
comment — "This must equal SHEET_PEEK_PX in lib/sheet.js", "Held in step with
NIGHT_BARRED / DAY_BARRED in lib/theme.js" — and this table is that sentence, read.
Write the relationship as \`CONSTANT in path/to/file.js\` and it gets checked from the
next build.

\`npm run frontend:map:check\` **fails** on a diverged pair.

${table(['token', 'palette', 'CSS', 'constant', 'file', 'JS', 'state'], rows, '_No paired constants found._')}`;
}

function factorySection(factory, link) {
  return `## The factory boundary — not a design surface

Generated by the venue builder, per [${factory.policy}](${link(factory.policy)}). Never
hand-edit these to fix what you see on the map; fix the builder or that venue's input
and regenerate.

${factory.outputs.map((p) => `- ${code(p)}`).join('\n')}

Builder **input**, and meant to be hand-edited: ${factory.inputs.map(code).join(', ')}.

A design canvas will contain a hand-drawn park map because a prototype needs something
to stand on. It is scenery. Redesign the chrome that floats above it.
`;
}

function contrastSection(contrast) {
  const rows = contrast.rows.map((r) => [
    `${code(r.fg)} on ${code(r.bg)}`,
    r.use,
    code(r.where),
    `${r.floor}:1`,
    r.night === null ? '—' : r.night.toFixed(2),
    r.day === null ? '—' : r.day.toFixed(2),
    !r.judged ? r.status : r.worst >= r.floor ? 'passes' : '**below floor**',
  ]);

  return `## Contrast — measured, not eyeballed

Both palettes, from the same \`globals.css\` the app ships. This app is used outdoors in
direct sun and the stylesheet already records that a lighter treatment "fails on outdoor
glare", so a pairing that is merely close to its floor is a pairing to look at.

${table(['pairing', 'use', 'where', 'floor', 'Park Midnight', 'Trail', 'state'], rows, '_No pairings._')}
Floors: ${FLOORS.map((f) => `${f.ratio}:1 for ${f.what} (${f.clause})`).join('; ')}.

Run \`npm run frontend:contrast\` for the gate. It fails on a **new** failure or on a
tracked one that has got worse, and reports the known ones without failing — otherwise
it could not be run at all on the day it landed.

${
  contrast.failures.length
    ? contrast.failures
        .map(
          (f) =>
            `- ${code(f.fg)} on ${code(f.bg)} (${code(f.where)}) reads **${f.worst.toFixed(2)}:1**, under its ${f.floor}:1 floor.`,
        )
        .join('\n')
    : '- Nothing the app paints reads below its floor.'
}
`;
}

function gapsSection(gaps) {
  if (!gaps.length) {
    return `## Gaps

None. Every screen resolved to a branch, every named counterpart to a constant.
`;
  }
  return `## Gaps — what this map could not derive

The map the design import shipped named files that did not exist, and nothing said so.
These are the questions this generator could not answer honestly. An unresolved entry is
worth more than a confident wrong one.

${gaps.map((g) => `- ${g}`).join('\n')}
`;
}

export function renderMap(model) {
  return `# Front-end map

<!-- GENERATED FILE — do not edit by hand.
     Written by scripts/frontend-map.mjs (scripts/lib/frontend-map/).
     Rebuild: npm run frontend:map      Verify: npm run frontend:map:check -->

Everything below is read out of the app at build time. Nothing here is transcribed, so
this file is wrong only for as long as the code is — which is the whole point: the
hand-written screen map this replaces named \`components/WorldPicker.jsx\` and
\`lib/worlds.js\`, and neither existed.

**Before you touch a component, read the screen table.** Before you touch a class, check
whether it is shared.

Read from: ${model.sources.map(code).join(', ')}.

${screensSection(model.screens, model.page)}
${orphansSection(model.orphans)}
${classesSection(model.classes)}
${pairsSection(model.pairs)}
${contrastSection(model.contrast)}
${factorySection(model.factory, model.link)}
${gapsSection(model.gaps)}`;
}
