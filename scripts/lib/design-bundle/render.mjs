/**
 * Render the derived design system as standalone preview pages.
 *
 * Every page is one file that opens with no server and no network: the values
 * are inlined at build time, the two palettes ship as CSS custom properties,
 * and the only external reference is the typeface the twin already vendored.
 *
 * The pages are painted in the app's own tokens on purpose. A swatch sheet
 * drawn in some other designer's greys is a second design system sitting on
 * top of the one it documents, and the first thing that drifts is the sheet.
 *
 * Interface:
 *   renderPages(model) → Map<relPath, contents>   (includes _ds_manifest.json)
 */

/* Each preview page opens with this marker — a Claude Design design-system
   project reads the first line of every preview HTML to build its card index,
   and compiles those into `_ds_manifest.json`. `group` is the documented
   attribute; the card's title comes from the page's own <title>. Nothing else
   is emitted into the marker, because an attribute this reader invented would
   be a guess about someone else's parser. */
const dsCard = (group) => `<!-- @dsCard group="${group}" -->`;

/* The card group the twin's pages land in. Named here rather than in the twin
   so the two halves of one bundle cannot drift into two spellings of the same
   group and split the card index in the project. */
export const PAGE_GROUP_SCREENS = 'Screens';

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** CONTEXT.md marks every cross-referenced term in bold; keep that. */
const mdInline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

/** A source comment, as paragraphs. Blank lines are the author's own breaks. */
const prose = (text) =>
  String(text || '')
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => `<p>${mdInline(p.replace(/\n/g, ' '))}</p>`)
    .join('\n');

/* ============================================================
   The shell
   ============================================================ */

/**
 * Both palettes as real custom properties, so the toggle is a class swap and
 * every swatch on the page is painted by the token it is describing rather
 * than by a copy of it.
 */
function paletteCss(rows) {
  const night = rows.map((t) => `    ${t.name}: ${t.value};`).join('\n');
  const day = rows
    .filter((t) => t.dayValue !== null)
    .map((t) => `    ${t.name}: ${t.dayValue};`).join('\n');
  return `  :root, .pal-night {\n${night}\n  }\n\n  .pal-day {\n${day}\n  }`;
}

/* Where the typeface lives *inside the pushable unit*, and which weights the
   shell actually asks for.

   DesignSync pushes files to project-relative paths, so a page that reaches
   sideways with `../` resolves to nothing once it is pushed on its own and the
   typeface silently falls back. The woff2 therefore ship *inside*
   docs/design/system/, and every reference below is relative to the page.

   The weight list is the whole contract between the CSS and the bytes: these
   three faces are what the shell declares, and compose.mjs vendors exactly
   these three files. @fontsource ships five (400/500/600/700/800) and the twin
   keeps all five for its viewer; the bundle carries three because those are the
   only ones ever declared here. 500 and 700 are NOT dropped weights — they were
   never declared, so 700-weight text already matches to the 800 face by the CSS
   font-matching algorithm today. Adding them would change how the pages render;
   omitting them changes nothing and saves ~24 KB per push. */
export const FONT_FAMILY = 'Plus Jakarta Sans';
export const FONT_WEIGHTS = [400, 600, 800];
export const FONT_DIR = 'vendor/fonts';
/* @fontsource's own filename shape. Derived rather than listed so the vendoring
   in compose.mjs and the `src` below cannot drift apart. */
export const fontFile = (weight) => `plus-jakarta-sans-latin-${weight}-normal.woff2`;

const fontFaceCss = FONT_WEIGHTS.map(
  (w) => `  @font-face {
    font-family: '${FONT_FAMILY}'; font-style: normal; font-weight: ${w}; font-display: swap;
    src: url('${FONT_DIR}/${fontFile(w)}') format('woff2');
  }`,
).join('\n');

const SHELL_CSS = `
  /* The typeface ships INSIDE this directory, at ${FONT_DIR}/, and is
     referenced relatively — so this page renders correctly wherever the
     directory is pushed, with nothing above it. The fallbacks in --display /
     --ui below are the app's real stacks out of globals.css. */
${fontFaceCss}

  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 20px 96px;
    background: var(--bg); color: var(--label);
    font-family: var(--ui); font-size: 15px; line-height: 21px; letter-spacing: -.2px;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 940px; margin: 0 auto; }
  header.top { padding: 34px 0 8px; }
  .eyebrow {
    font-size: 12px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    color: var(--aqua);
  }
  h1 {
    font-family: var(--display); font-size: 32px; line-height: 38px; letter-spacing: -.6px;
    font-weight: 800; margin: 6px 0 0;
  }
  h2 {
    font-family: var(--display); font-size: 20px; line-height: 26px; letter-spacing: -.4px;
    font-weight: 700; margin: 36px 0 4px;
  }
  h3 { font-size: 15px; font-weight: 700; margin: 24px 0 6px; letter-spacing: -.2px; }
  p { margin: 8px 0; color: var(--label2); max-width: 68ch; }
  .lede { font-size: 16px; line-height: 24px; color: var(--label2); max-width: 68ch; }
  a { color: var(--aqua); }
  code {
    font-family: var(--mono); font-size: .92em;
    background: var(--fill3); padding: 1px 5px; border-radius: var(--r1);
  }
  .src {
    display: inline-block; margin-top: 10px; padding: 5px 10px;
    background: var(--fill3); border: 1px solid var(--sep); border-radius: var(--rCapsule);
    font-family: var(--mono); font-size: 12px; color: var(--label2);
  }
  .note {
    border-left: 2px solid var(--sep); padding: 2px 0 2px 14px; margin: 12px 0;
  }
  .note p { margin: 4px 0; font-size: 14px; line-height: 20px; }
  .warn { border-left-color: var(--sun); }
  .warn p { color: var(--label); }

  /* Scroll a wide table inside its own box; the page itself never scrolls
     sideways. */
  .scroll { overflow-x: auto; margin: 12px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td {
    text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--sep);
    vertical-align: top; white-space: nowrap;
  }
  th {
    font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    color: var(--label2); position: sticky; top: 0; background: var(--bg);
  }
  td.wrapcell { white-space: normal; min-width: 22ch; color: var(--label2); }
  .mono { font-family: var(--mono); font-size: 12px; }

  .sw { width: 30px; height: 30px; border-radius: var(--r2); border: 1px solid var(--sep); display: block; }
  .grid { display: grid; gap: 12px; margin: 14px 0; }
  .card {
    background: var(--bg2); border: 1px solid var(--sep); border-radius: var(--r4);
    padding: 14px; box-shadow: var(--shadow1);
  }

  .pill {
    display: inline-block; padding: 2px 8px; border-radius: var(--rCapsule);
    font-size: 11px; font-weight: 700; letter-spacing: .04em;
  }
  .pass { background: color-mix(in srgb, var(--meadow) 22%, transparent); color: var(--meadow); }
  .fail { background: color-mix(in srgb, var(--signal) 22%, transparent); color: var(--signal); }
  .info { background: var(--fill3); color: var(--label2); }

  /* The palette switch. Both palettes are on the page as classes, so this
     swaps a class on <html> and repaints from the tokens — the same thing the
     app does with data-theme, minus the persistence. */
  .toggle {
    position: sticky; top: 0; z-index: 9;
    display: flex; gap: 8px; align-items: center; justify-content: flex-end;
    padding: 10px 0; background: var(--bg); border-bottom: 1px solid var(--sep);
  }
  .toggle button {
    font: inherit; font-size: 13px; font-weight: 600;
    padding: 7px 14px; border-radius: var(--rCapsule);
    background: var(--fill3); color: var(--label); border: 1px solid var(--sep); cursor: pointer;
  }
  .toggle button[aria-pressed='true'] { background: var(--aqua); color: #0B1829; border-color: transparent; }
  .toggle .where { margin-right: auto; font-size: 12px; color: var(--label3); font-family: var(--mono); }

  nav.bundle { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 6px; }
  nav.bundle a {
    font-size: 13px; font-weight: 600; text-decoration: none;
    padding: 6px 12px; border-radius: var(--rCapsule);
    background: var(--fill3); border: 1px solid var(--sep); color: var(--label);
  }
  nav.bundle a[aria-current] { background: var(--aqua); color: #0B1829; border-color: transparent; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--sep); font-size: 12px; color: var(--label3); }
`;

const TOGGLE_JS = `
  // Default to the viewer's own preference, then let the buttons override it.
  (function () {
    var root = document.documentElement;
    function set(pal) {
      root.classList.remove('pal-day', 'pal-night');
      root.classList.add('pal-' + pal);
      root.style.colorScheme = pal === 'day' ? 'light' : 'dark';
      var bs = document.querySelectorAll('.toggle button');
      for (var i = 0; i < bs.length; i++) {
        bs[i].setAttribute('aria-pressed', String(bs[i].dataset.pal === pal));
      }
    }
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    set(mq.matches ? 'day' : 'night');
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.toggle button');
      if (b) set(b.dataset.pal);
    });
  })();
`;

const PAGES = [
  ['index.html', 'Overview', 'Contents'],
  ['tokens-color.html', 'Tokens', 'Colour'],
  ['tokens-type.html', 'Tokens', 'Type'],
  ['tokens-spacing.html', 'Tokens', 'Spacing'],
  ['tokens-radius.html', 'Tokens', 'Radius'],
  ['map-skins.html', 'Map', 'Skins'],
  ['icons.html', 'Icons', 'Glyphs'],
  ['vocabulary.html', 'Language', 'Vocabulary'],
  ['screen-map.html', 'Overview', 'Screen map'],
];

export function page({ file, group, title, lede, source, body, model }) {
  /* The nav is the bundle's own contents, and the bundle grew a second half:
     the twin contributes a page per screen, so the list can no longer be a
     module constant. `model.navIndex` is that list — PAGES plus whatever else
     was composed in — and it falls back to PAGES so a caller that has no twin
     (a test, a bundle built before a capture exists) still renders. */
  const nav = (model.navIndex ?? PAGES).map(
    ([href, , label]) =>
      `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${esc(label)}</a>`,
  ).join('\n    ');

  return `${dsCard(group)}
<!DOCTYPE html>
<html lang="en" class="pal-night">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parkbound — ${esc(title)}</title>
<!--
  GENERATED by scripts/design-bundle.mjs — do not edit by hand.

  Every value on this page was read out of the repo at build time; the source
  it came from is named under the heading. Change the source, run
  \`npm run design:build\`, and this page changes with it. Edit this file
  instead and \`npm run design:check\` will fail, which is the point.
-->
<style>
${paletteCss(model.tokens.rows)}

${SHELL_CSS}
${model.extraCss ?? ''}
</style>
</head>
<body>
<div class="wrap">
  <div class="toggle">
    <span class="where">${esc(file)}</span>
    <button type="button" data-pal="night" aria-pressed="true">Park Midnight</button>
    <button type="button" data-pal="day" aria-pressed="false">Trail</button>
  </div>

  <header class="top">
    <div class="eyebrow">Parkbound design system · ${esc(group)}</div>
    <h1>${esc(title)}</h1>
    <p class="lede">${mdInline(lede)}</p>
    ${source ? `<div class="src">derived from ${esc(source)}</div>` : ''}
  </header>

  <nav class="bundle">
    ${nav}
  </nav>

${body}

  <footer>
    Generated by <code>npm run design:build</code> from
    <code>apps/party-tracker</code>. The repo is authoritative: this bundle is a
    mirror of it, never a source for it. See
    <code>docs/design/WORKING-WITH-CLAUDE-DESIGN.md</code>.
  </footer>
</div>
<script>${TOGGLE_JS}</script>
</body>
</html>
`;
}

/* ============================================================
   Pages
   ============================================================ */

const swatchCell = (value) =>
  value ? `<td><span class="sw" style="background:${esc(value)}"></span></td>` : '<td></td>';

function tokenTable(rows) {
  const body = rows
    .map((t) => {
      const showSwatch = t.kind === 'colour';
      return `<tr>
        ${showSwatch ? swatchCell(t.resolved) : '<td></td>'}
        ${showSwatch ? swatchCell(t.dayResolved ?? t.resolved) : '<td></td>'}
        <td class="mono">${esc(t.name)}</td>
        <td class="mono">${esc(t.value)}</td>
        <td class="mono">${esc(t.dayValue ?? '—')}</td>
        <td class="wrapcell">${t.alias ? `alias → <code>${esc(t.resolved)}</code>. ` : ''}${mdInline(t.note)}</td>
      </tr>`;
    })
    .join('\n');
  return `<div class="scroll"><table>
    <thead><tr>
      <th colspan="2">Swatch</th><th>Token</th><th>Park Midnight</th><th>Trail</th><th>Why</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function colourPage(model) {
  /* Colours, and the surface treatments made of colour — shadows and the glass
     filters. The type scale, the radii and the sheet stops are all tokens too,
     but each has a page where it can be shown at its own value rather than as
     a row of text, so listing them again here would only make this page long
     enough that nobody reaches the bottom of it. */
  const isHere = (t) => ['colour', 'shadow', 'filter'].includes(t.kind);

  const groups = model.tokens.groups
    .map((g) => {
      const rows = model.tokens.rows.filter((t) => t.group === g.name && isHere(t));
      if (!rows.length) return '';
      return `<h2>${esc(g.name)}</h2>
      ${g.note ? `<div class="note">${prose(g.note)}</div>` : ''}
      ${tokenTable(rows)}`;
    })
    .join('\n');

  const elsewhere = model.tokens.rows.filter((t) => !isHere(t)).length;

  const contrast = model.contrast
    .map((c) => {
      const cell = (r) => {
        if (r === null) return '<td class="info">—</td>';
        const tone = c.status === 'reference' ? 'info' : r >= c.floor ? 'pass' : 'fail';
        return `<td><span class="pill ${tone}">${r.toFixed(2)}:1</span></td>`;
      };
      return `<tr>
        <td class="mono">${esc(c.fg)}</td>
        <td class="mono">${esc(c.bg)}</td>
        ${cell(c.night)}${cell(c.day)}
        <td class="mono">${c.status === 'reference' ? '—' : `${c.floor.toFixed(1)}:1`}</td>
        <td><span class="pill ${c.status === 'rejected' ? 'fail' : 'info'}">${c.status}</span></td>
        <td class="wrapcell">${esc(c.use)} — <code>${esc(c.where)}</code></td>
      </tr>`;
    })
    .join('\n');

  const body = `
  <h2>Contrast</h2>
  <p>Parkbound is used outdoors, in a queue, in direct sun. That is the whole
  reason this table is here and not in an appendix: a ratio that is merely
  adequate on a desk is unreadable on a phone at noon. The floor is AA — 4.5:1
  for text, 3:1 for a graphical object such as a separator or an icon that has
  to be found.</p>
  <p>Ratios are computed from the resolved token values, compositing any alpha
  onto the background beneath it. <b>ships</b> rows are combinations the app
  paints today, and their numbers are a live measurement of the product.
  <b>rejected</b> rows were proposed and turned down, kept because a floor with
  no failing example beside it teaches nobody anything.
  <b>reference</b> rows are measured but not judged — a decorative hairline is
  not a graphical object required to understand the content, though an icon a
  guest has to find in order to act on it is.</p>
  <div class="scroll"><table>
    <thead><tr><th>Ink</th><th>On</th><th>Midnight</th><th>Trail</th><th>Floor</th><th></th><th>Where</th></tr></thead>
    <tbody>${contrast}</tbody>
  </table></div>
  ${
    model.contrastShipFails.length
      ? `<div class="note warn"><p><b>${model.contrastShipFails.length} shipped combination${
          model.contrastShipFails.length === 1 ? '' : 's'
        } read below the floor:</b> ${model.contrastShipFails
          .map((c) => `<code>${esc(c.fg)}</code> on <code>${esc(c.bg)}</code>`)
          .join(', ')}. Recorded rather than quietly rounded up — this is a
          measurement of the app as it stands, and the number is the argument
          for changing it.</p></div>`
      : ''
  }

  ${groups}

  <p style="margin-top:28px">The other ${elsewhere} tokens in these two blocks
  are type, radius, motion and layout, and each is shown at its own value on
  <a href="tokens-type.html">Type</a>, <a href="tokens-radius.html">Radius</a>
  and <a href="tokens-spacing.html">Spacing</a>.</p>`;

  return page({
    file: 'tokens-color.html',
    group: 'Tokens',
    title: 'Colour',
    lede:
      'Every custom property in both palettes, read straight out of `globals.css`. ' +
      'The swatches are painted by the tokens themselves, so a value that changes ' +
      'in the stylesheet changes here on the next build — and a colour that is not ' +
      'in this table does not exist.',
    source: 'apps/party-tracker/app/globals.css — `:root` and `:root[data-theme=\'day\']`',
    body,
    model,
  });
}

function typePage(model) {
  const scale = model.type.scale
    .map(
      (s) => `<tr>
      <td class="mono">${esc(s.name)}</td>
      <td class="mono">${esc(s.size)}</td>
      <td class="mono">${esc(s.leading)}</td>
      <td class="mono">${esc(s.tracking)}</td>
      <td class="wrapcell" style="font-size:${esc(s.size)};line-height:${esc(
        s.leading,
      )};letter-spacing:${esc(s.tracking)};color:var(--label);font-family:var(--display)">
        Park Bound
      </td>
    </tr>`,
    )
    .join('\n');

  const stacks = model.type.stacks
    .map(
      (s) => `<div class="card">
      <h3 class="mono">${esc(s.name)}</h3>
      <p class="mono" style="font-size:12px">${esc(s.value)}</p>
      <div style="font-family:${esc(s.value)};font-size:26px;line-height:34px;color:var(--label)">
        Park Bound · Explore
      </div>
    </div>`,
    )
    .join('\n');

  const body = `
  ${model.type.note ? `<div class="note">${prose(model.type.note)}</div>` : ''}

  <h2>The scale</h2>
  <p>Apple's built-in text styles at the Large (default) Dynamic Type size. The
  preview column is set in <code>--display</code> at each row's real size,
  leading and tracking.</p>
  <div class="scroll"><table>
    <thead><tr><th>Style</th><th>Size</th><th>Leading</th><th>Tracking</th><th>Preview</th></tr></thead>
    <tbody>${scale}</tbody>
  </table></div>

  <h2>Families</h2>
  <div class="grid">${stacks}</div>

  <h2>Section headings</h2>
  <p>This one is worth stating outright, because it is the treatment a mock is
  most likely to get wrong and the app will not accept the correction.</p>
  <div class="note warn">${prose(model.type.labelNote)}</div>
  <div class="card">
    <div style="font-size:13px;font-weight:500;line-height:18px;letter-spacing:-.08px;text-transform:none;color:color-mix(in srgb, var(--label) 78%, var(--label2))">
      Today's stops
    </div>
    <p style="margin-top:2px">↑ <code>.label</code> as the app ships it: 13px, weight 500, sentence case.</p>
    <div style="margin-top:16px;font-size:11.5px;font-weight:800;line-height:15px;letter-spacing:.1em;text-transform:uppercase;color:var(--label3)">
      Today's stops
    </div>
    <p style="margin-top:2px">↑ the imported twin's eyebrow: 11.5px, weight 800,
    <code>--label3</code>. Smaller <i>and</i> lighter than the treatment the
    comment above records as already having failed outdoors. Rejected repo-wide.</p>
  </div>`;

  return page({
    file: 'tokens-type.html',
    group: 'Tokens',
    title: 'Type',
    lede:
      'The type scale, the two families, and the one heading treatment that a ' +
      'mock keeps trying to change.',
    source: "apps/party-tracker/app/globals.css — `--fs-*` / `--lh-*` / `--tr-*`, `--display`, `--ui`, `.label`",
    body,
    model,
  });
}

function lengthTable(rows) {
  return `<div class="scroll"><table>
    <thead><tr><th>Token</th><th>Midnight</th><th>Trail</th><th>Scale</th><th>Why</th></tr></thead>
    <tbody>${rows
      .map(
        (t) => `<tr>
        <td class="mono">${esc(t.name)}</td>
        <td class="mono">${esc(t.value)}</td>
        <td class="mono">${esc(t.dayValue ?? '—')}</td>
        <td><span style="display:block;height:12px;border-radius:3px;background:var(--aqua);width:${
          /^\d+(\.\d+)?px$/.test(t.value) ? Math.min(parseFloat(t.value), 340) : 0
        }px"></span></td>
        <td class="wrapcell">${mdInline(t.note)}</td>
      </tr>`,
      )
      .join('\n')}</tbody>
  </table></div>`;
}

function spacingPage(model) {
  const budget = model.spacing.budget
    .map(
      (b) => `<tr>
      <td class="mono">${esc(b.name)}</td>
      <td class="mono">${b.value}px</td>
      <td><span style="display:block;height:12px;border-radius:3px;background:var(--aqua);width:${Math.min(
        b.value,
        340,
      )}px"></span></td>
    </tr>`,
    )
    .join('\n');

  const checks = model.spacing.checks
    .map(
      (c) => `<tr>
      <td class="mono">${esc(c.css)}</td>
      <td class="mono">${esc(c.cssValue)}</td>
      <td class="mono">${esc(c.js)}</td>
      <td class="mono">${c.jsValue}px</td>
      <td><span class="pill ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'in step' : 'drifted'}</span></td>
    </tr>`,
    )
    .join('\n');

  const drifted = model.spacing.checks.filter((c) => !c.ok);

  const body = `
  <h2>Sheet stops</h2>
  <p>The sheet is the app's main spacing decision, and its two named stops are
  the only large fixed lengths in the stylesheet.</p>
  ${lengthTable(model.spacing.lengths)}

  <h2>The peek budget</h2>
  <p>The resting stop is not a chosen number — it is the sum of the rungs that
  have to fit in it, added up in <code>lib/sheet.js</code> so it cannot drift
  from the parts. This is the table a mock cannot see, and the reason a
  redesign that adds a band to the sheet has to come back here and pay for it.</p>
  <div class="scroll"><table>
    <thead><tr><th>Constant</th><th>Value</th><th>Scale</th></tr></thead>
    <tbody>${budget}</tbody>
  </table></div>

  <h2>CSS against the measured ladder</h2>
  <p>The stylesheet's <code>--peek</code> and <code>--shut</code> are what the
  first paint uses before React has measured anything; <code>lib/sheet.js</code>
  is what the sheet actually settles to. They are supposed to agree, and nothing
  in the app makes them.</p>
  <div class="scroll"><table>
    <thead><tr><th>CSS</th><th>Value</th><th>JS</th><th>Value</th><th></th></tr></thead>
    <tbody>${checks}</tbody>
  </table></div>
  ${
    drifted.length
      ? `<div class="note warn"><p><b>Drifted:</b> ${drifted
          .map(
            (c) =>
              `<code>${esc(c.css)}</code> is ${esc(c.cssValue)} but <code>${esc(
                c.js,
              )}</code> computes ${c.jsValue}px`,
          )
          .join('; ')}. The glance rail's 104px came out of the JS budget when
          Explore became search → context → list; the stylesheet's copy of the
          number did not follow, and its comment still lists the rail among the
          things the stop has to stand. The cost is a first-paint stop
          ${Math.abs(drifted[0].jsValue - parseFloat(drifted[0].cssValue))}px
          taller than the one React settles to — a flash, not a broken layout,
          which is exactly why it survived.</p></div>`
      : ''
  }`;

  return page({
    file: 'tokens-spacing.html',
    group: 'Tokens',
    title: 'Spacing',
    lede:
      'The sheet stops and the budget they are the sum of. Parkbound has no ' +
      'general spacing scale — it has one sheet whose heights are argued for, ' +
      'and this is that argument.',
    source: "apps/party-tracker/app/globals.css and apps/party-tracker/lib/sheet.js",
    body,
    model,
  });
}

function radiusPage(model) {
  const cards = model.radii
    .map(
      (t) => `<div class="card">
      <div style="height:64px;border-radius:${esc(
        t.resolved,
      )};background:var(--aqua);border:1px solid var(--sep)"></div>
      <h3 class="mono">${esc(t.name)}</h3>
      <p class="mono" style="font-size:12px;margin:2px 0">${esc(t.value)}</p>
      ${t.note ? `<p style="font-size:13px;line-height:19px">${mdInline(t.note)}</p>` : ''}
    </div>`,
    )
    .join('\n');

  const body = `
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">${cards}</div>

  <h2>Two shapes, one rule</h2>
  <p>Both shapes are correct and they are not interchangeable. The rule, read
  off the buttons the app and the twin agree on:</p>
  <div class="card">
    <p style="color:var(--label)"><b>Capsule</b> (<code>--rCapsule</code>) —
    chips, filter toggles, small inline pills, segmented controls. Anything that
    sits in a row of its own kind.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px">
      <span class="pill info" style="padding:7px 14px;font-size:13px">Nearby</span>
      <span class="pill info" style="padding:7px 14px;font-size:13px">In the Plan</span>
      <span class="pill info" style="padding:7px 14px;font-size:13px">Rides</span>
    </div>
    <p style="color:var(--label)"><b>Rounded rect</b> (<code>--r4</code>) —
    full-width and major action buttons. Anything that is the point of the screen
    it is on.</p>
    <div style="margin-top:10px;padding:14px;text-align:center;font-weight:600;
                border-radius:var(--r4);background:var(--adventure);color:var(--onTint)">
      Rally the Party
    </div>
  </div>`;

  return page({
    file: 'tokens-radius.html',
    group: 'Tokens',
    title: 'Radius',
    lede:
      'Every radius token, drawn at its own value. A floating sheet follows the ' +
      'curve of the display it nests into; a docked panel does not — which is ' +
      'why there is more than one number here.',
    source: "apps/party-tracker/app/globals.css — the `---- radii ----` group",
    body,
    model,
  });
}

function skinsPage(model) {
  const row = (s, isSkin) => `<div class="card">
    <div style="display:flex;height:76px;border-radius:var(--r3);overflow:hidden;border:2px solid ${esc(
      s.stroke,
    )}">
      <span style="flex:2;background:${esc(s.ground)}"></span>
      <span style="flex:1;background:${esc(s.grass)}"></span>
      <span style="flex:1;background:${esc(s.water)}"></span>
      <span style="flex:1;background:${esc(s.building)}"></span>
    </div>
    <h3>${esc(s.label)} ${
      isSkin ? '' : '<span class="pill info">always on</span>'
    }</h3>
    <p class="mono" style="font-size:11px;margin:2px 0">${esc(s.id)}</p>
    <p class="mono" style="font-size:11px;margin:6px 0 0">
      ground ${esc(s.ground)}<br>path ${esc(s.stroke)}<br>
      grass ${esc(s.grass)} · water ${esc(s.water)}<br>building ${esc(s.building)} · ink ${esc(s.ink)}
    </p>
    ${
      isSkin
        ? `<p style="font-size:12px;line-height:17px;margin-top:8px">
             unlock <code>${esc(JSON.stringify(s.unlock))}</code><br>
             share <code>${esc(JSON.stringify(s.share))}</code>
             ${s.season ? `<br><span class="pill info">season: ${esc(s.season)}</span>` : ''}
             ${s.traits.length ? `<br><span class="pill info">${esc(s.traits.join(', '))}</span>` : ''}
           </p>`
        : ''
    }
  </div>`;

  const body = `
  <div class="note">
    <p>Each chip is <code>mapPaint(id)</code>, called — the ground is
    <code>p.ground</code> and the border is <code>p.path.stroke</code>, which is
    exactly how <code>WorldCloset.jsx</code> draws its own. There is no hex table
    anywhere in this bundle, because <code>SKINS[].paint</code> is the same object
    that feeds <code>mapThemeCssVars</code> and <code>applyMapSkin</code>: a
    swatch built any other way is a promise about the ground under the guest's
    thumb that the map has not agreed to.</p>
  </div>

  <h2>Palettes</h2>
  <p>Trail and Park Midnight are always on and are never earned. They are not
  Skins — they are not in <code>SKINS</code> — and calling one a Skin in copy is
  the mistake <code>CONTEXT.md</code> names under <b>Skin</b>.</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
    ${model.skins.palettes.map((s) => row(s, false)).join('\n')}
  </div>

  <h2>Skins <span class="pill info">${model.skins.skins.length}</span></h2>
  <p>A Skin restyles how the World map is painted, never where Places sit. Each
  carries two rungs — a private unlock, then a share.</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
    ${model.skins.skins.map((s) => row(s, true)).join('\n')}
  </div>`;

  return page({
    file: 'map-skins.html',
    group: 'Map',
    title: 'Map skins',
    lede:
      'What every Skin paints, derived by calling `mapPaint()`. The map itself is ' +
      'factory output and is not a design surface — these are the palettes it is ' +
      'painted in, which is a different thing.',
    source: 'apps/party-tracker/lib/world.js — `SKINS` via `mapPaint()`',
    body,
    model,
  });
}

function iconsPage(model) {
  const cell = (i) => `<div class="card" style="text-align:center;padding:12px 8px">
    <svg viewBox="${esc(model.icons.viewBox)}" width="28" height="28" aria-hidden="true"
         style="color:var(--label)">${i.svg}</svg>
    <p class="mono" style="font-size:10px;line-height:14px;margin:8px 0 0;white-space:normal;overflow-wrap:anywhere">${esc(
      i.name,
    )}</p>
  </div>`;

  const mapRows = (name, map) =>
    Object.entries(map)
      .map(([key, glyph]) => {
        const icon = model.icons.icons.find((i) => i.name === glyph);
        return `<tr>
        <td>${
          icon
            ? `<svg viewBox="${esc(model.icons.viewBox)}" width="22" height="22" aria-hidden="true">${
                icon.svg
              }</svg>`
            : '<span class="pill fail">none</span>'
        }</td>
        <td class="mono">${esc(key)}</td>
        <td class="mono">${esc(glyph)}</td>
        <td>${icon ? '' : '<span class="pill fail">no glyph behind this name</span>'}</td>
      </tr>`;
      })
      .join('\n');

  const body = `
  <div class="note">${prose(model.icons.header)}</div>

  <h2>The glyph set <span class="pill info">${model.icons.icons.length}</span></h2>
  <p>This is all of it. A name that is not here renders as nothing at all —
  <code>Icon</code> returns <code>null</code> for a name it does not know — so
  a mock that invents a glyph produces an empty space in a finished-looking row.</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(104px,1fr))">
    ${model.icons.icons.map(cell).join('\n')}
  </div>

  <h2>Kits</h2>
  <p><code>KIT_ICONS</code> maps each Kit to the glyph its chrome wears.</p>
  <div class="scroll"><table>
    <thead><tr><th></th><th>Kit</th><th>Glyph</th><th></th></tr></thead>
    <tbody>${mapRows('KIT_ICONS', model.world.KIT_ICONS)}</tbody>
  </table></div>

  <h2>Marks</h2>
  <p><code>MARK_ICONS</code> maps each Mark type to its glyph. Only
  <code>${esc(model.world.PLACEABLE_MARK_TYPES.join(' and '))}</code> may be
  placed by hand; <code>${esc(
    model.world.EARNED_MARK_TYPES.join(', '),
  )}</code> are minted by <code>recordSideQuest</code> as evidence that a fact
  was settled, and their whole worth is that nobody chose to leave them.</p>
  <div class="scroll"><table>
    <thead><tr><th></th><th>Mark</th><th>Glyph</th><th></th></tr></thead>
    <tbody>${mapRows('MARK_ICONS', model.world.MARK_ICONS)}</tbody>
  </table></div>

  ${
    model.iconGaps.length
      ? `<div class="note warn"><p><b>${model.iconGaps.length} names point at glyphs that do not
        exist:</b> ${model.iconGaps
          .map((g) => `<code>${esc(g.map)}.${esc(g.key)}</code> → <code>${esc(g.glyph)}</code>`)
          .join(', ')}. <code>Icon</code> returns <code>null</code> for each, so
        those rows draw no glyph at all in Collection and Marks. Nobody notices a
        glyph that was never there, which is why this is computed on every build
        rather than eyeballed.</p></div>`
      : ''
  }`;

  return page({
    file: 'icons.html',
    group: 'Icons',
    title: 'Icons',
    lede:
      'Every glyph the app can draw, rendered from the real path data in ' +
      '`Icon.jsx`, plus the two maps that name them.',
    source:
      'apps/party-tracker/components/Icon.jsx — `GLYPHS`; apps/party-tracker/lib/world.js — `KIT_ICONS` / `MARK_ICONS`',
    body,
    model,
  });
}

function vocabularyPage(model) {
  const terms = model.vocabulary
    .map(
      (t) => `<div class="card">
      <h3 style="font-family:var(--display);font-size:19px;letter-spacing:-.4px;margin:0 0 6px">${esc(
        t.term,
      )}</h3>
      <p style="color:var(--label)">${mdInline(t.definition)}</p>
      ${
        t.avoid
          ? `<p style="font-size:13px;margin-top:8px"><span class="pill fail">avoid</span>
             ${mdInline(t.avoid)}</p>`
          : ''
      }
    </div>`,
    )
    .join('\n');

  const body = `
  <div class="note">
    <p>Definitions are lifted verbatim from <code>CONTEXT.md</code>, which is the
    glossary the whole repo is written against. If a term is renamed there this
    page fails to build rather than keeping the old wording — the failure is the
    feature.</p>
    <p>The <b>avoid</b> line is the half that does the work in a design review.
    Most of the wrong words are not wrong-sounding; they are the obvious word.
    "Meet-up", "venue", "pin", "level" all read fine and all mean something else
    here.</p>
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${terms}</div>`;

  return page({
    file: 'vocabulary.html',
    group: 'Language',
    title: 'Vocabulary',
    lede:
      'The terms a screen has to get right, and the near-misses that mean ' +
      'something else. Copy is a design surface here.',
    source: 'CONTEXT.md',
    body,
    model,
  });
}

function screenMapPage(model) {
  const rows = model.screenMap.rows
    .map(
      (r) => `<tr>
      <td class="wrapcell" style="color:var(--label);font-weight:600">${esc(r.screen)}</td>
      <td class="wrapcell mono">${r.paths
        .map((p) => `${esc(p.path)} <span class="pill pass">exists</span>`)
        .join('<br>')}</td>
    </tr>`,
    )
    .join('\n');

  const unmounted = model.screenMap.unmounted
    .map(
      ([file, why]) => `<tr><td class="mono">${esc(file)}</td><td class="wrapcell">${esc(why)}</td></tr>`,
    )
    .join('\n');

  const body = `
  <div class="note">
    <p>Every path in this table was checked against the working tree when this
    page was generated. If any one of them stops existing,
    <code>npm run design:check</code> fails and names it.</p>
    <p>That check is the whole reason this page exists. The imported twin
    carried a screen map of its own that pointed at a
    <code>components/WorldPicker.jsx</code> and a <code>lib/worlds.js</code>
    which did not exist — and nothing, anywhere, would have said so. Five recon
    agents found it by hand.</p>
  </div>

  <div class="scroll"><table>
    <thead><tr><th>Screen</th><th>Repo files</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>

  <h2>On disk, mounted nowhere</h2>
  <p>A file existing is a weaker fact than a file being used. These are real,
  and they are not on any screen.</p>
  <div class="scroll"><table>
    <thead><tr><th>File</th><th>Why</th></tr></thead>
    <tbody>${unmounted}</tbody>
  </table></div>`;

  return page({
    file: 'screen-map.html',
    group: 'Overview',
    title: 'Screen map',
    lede:
      'Which repo files each screen stands on — with every path verified against ' +
      'the working tree at build time.',
    source: 'checked against the working tree; see `scripts/lib/design-bundle/sources.mjs`',
    body,
    model,
  });
}

function indexPage(model) {
  /* Every page in the index that has a blurb of its own. The twin contributes
     one such page (its Screens contents) and seventeen that are reached from
     it — listing all eighteen here would bury the eight the design system is
     made of, so carrying a blurb is what earns a card. */
  const cards = (model.navIndex ?? PAGES).filter(([f]) => f !== 'index.html' && model.blurbs[f])
    .map(
      ([href, group, label]) => `<a class="card" href="${href}" style="text-decoration:none;display:block">
      <div class="eyebrow">${esc(group)}</div>
      <h3 style="font-family:var(--display);font-size:19px;margin:4px 0 6px;color:var(--label)">${esc(
        label,
      )}</h3>
      <p style="font-size:13px;line-height:19px;margin:0">${esc(model.blurbs[href])}</p>
    </a>`,
    )
    .join('\n');

  const findings = model.findings.length
    ? `<h2>What this build noticed</h2>
       <p>Cross-checks the generator runs every time. These are reported, not
       thrown — a mirror that refuses to render because the thing it reflects has
       a blemish is no use to anybody.</p>
       <div class="note warn">${model.findings.map((f) => `<p>${f}</p>`).join('\n')}</div>`
    : '';

  const body = `
  <div class="note">${prose(model.tokens.header)}</div>

  <h2>The pages</h2>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">${cards}</div>

  ${findings}

  <h2>How to use this</h2>
  <p>This bundle is generated by <code>npm run design:build</code> and verified
  by <code>npm run design:check</code>. Nothing in it is maintained by hand, and
  editing a page here does not change the app — it changes a mirror, and the
  next <code>design:check</code> will say so.</p>
  <p>The direction is one way. The repo is authoritative; a Design project
  connected to it is downstream. Before trusting any mock against this app, read
  <code>docs/design/WORKING-WITH-CLAUDE-DESIGN.md</code> — it is short, and it is
  the pre-flight that would have saved the last import.</p>`;

  return page({
    file: 'index.html',
    group: 'Overview',
    title: 'Parkbound design system',
    lede:
      'The app’s real tokens, skins, glyphs and words — generated from the ' +
      'source that owns each one, so a mock can be checked against the code ' +
      'instead of against a memory of it.',
    source: null,
    body,
    model,
  });
}

/* ============================================================
   Manifest
   ============================================================ */

/**
 * The card index a Claude Design design-system project compiles from the
 * `@dsCard` markers. Written here too so the bundle is self-describing when it
 * is read from the repo rather than through the sync — and so a page added to
 * PAGES without a marker is visible as a diff.
 */
function manifest(model) {
  return `${JSON.stringify(
    {
      name: 'Parkbound design system',
      generatedFrom: {
        repo: 'parthalon025/six-flags-sa',
        app: 'apps/party-tracker',
      },
      generator: 'scripts/design-bundle.mjs',
      note:
        'Generated. The repo is authoritative — edit the source a card derives ' +
        'from, then run `npm run design:build`.',
      cards: (model.pageIndex ?? PAGES).map(([file, group, title]) => ({
        file,
        group,
        title,
        derivedFrom: model.derivedFrom[file],
      })),
    },
    null,
    2,
  )}\n`;
}

export function renderPages(model) {
  const out = new Map();
  out.set('index.html', indexPage(model));
  out.set('tokens-color.html', colourPage(model));
  out.set('tokens-type.html', typePage(model));
  out.set('tokens-spacing.html', spacingPage(model));
  out.set('tokens-radius.html', radiusPage(model));
  out.set('map-skins.html', skinsPage(model));
  out.set('icons.html', iconsPage(model));
  out.set('vocabulary.html', vocabularyPage(model));
  out.set('screen-map.html', screenMapPage(model));
  out.set('_ds_manifest.json', manifest(model));
  return out;
}

export { PAGES };
