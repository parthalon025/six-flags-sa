/**
 * Render the capture record as design-system pages.
 *
 * One page per screen, drawn in the app's own tokens by the same shell the rest
 * of the bundle uses — so the twin and the design system are one document, not
 * a screenshot album stapled to a swatch sheet.
 *
 * What makes each page a twin rather than a picture is the four tables under
 * the shot, and the rule they all obey: **every value on this page was read
 * from something real.** The components were resolved from the classes the app
 * put on screen. The tokens were measured by the engine that painted them. The
 * copy was read off the screen and then traced back to the file it is written
 * in — and where it traces to nothing, the page says so instead of guessing.
 * A screen that could not be reached gets a page saying why.
 *
 * Interface:
 *   twinPages(record, model) → Map<relPath, html>
 *   twinPageIndex(record)    → [[file, group, label]]   (nav + @dsCard rows)
 */
import { page, esc, PAGE_GROUP_SCREENS } from '../design-bundle/render.mjs';

export const SHOT_SUBDIR = 'screens';

const pageFile = (id) => `screen-${id}.html`;
const INDEX_FILE = 'screens.html';

/** The nav/card rows the twin contributes. Derived from the record, so a new screen appears in the nav. */
export function twinPageIndex(record) {
  if (!record) return [];
  return [
    [INDEX_FILE, PAGE_GROUP_SCREENS, 'Screens'],
    ...record.screens.map((s) => [pageFile(s.id), PAGE_GROUP_SCREENS, s.title]),
  ];
}

/* ============================================================
   Pieces
   ============================================================ */

const table = (head, rows) =>
  rows.length
    ? `<div class="scroll"><table>
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('\n')}</tbody>
  </table></div>`
    : '<p class="fine">Nothing to show here.</p>';

/**
 * The two shots, side by side and labelled with the palette control's own
 * words. `loading="lazy"` is deliberate on the index and harmless here: the
 * pages are opened one at a time and a design system that takes four seconds to
 * paint is one nobody opens twice.
 */
function shots(screen, record) {
  const cells = record.palettes
    .map((palette) => {
      const shot = screen.shots[palette];
      if (!shot) {
        return `<figure class="shot missing"><figcaption>${esc(palette)} — not captured</figcaption></figure>`;
      }
      return `<figure class="shot">
      <img src="${SHOT_SUBDIR}/${esc(shot.file)}" width="${shot.width}" height="${shot.height}"
           alt="${esc(screen.title)}, ${esc(palette)} palette" loading="lazy">
      <figcaption>${esc(record.paletteLabels[palette] || palette)}
        <span class="fine">${(shot.bytes / 1024).toFixed(0)} KiB · WebP q${shot.quality}</span>
      </figcaption>
    </figure>`;
    })
    .join('\n');
  return `<div class="shots">${cells}</div>`;
}

function ownersSection(screen) {
  const rows = screen.owners.map(
    (o) => `<tr>
      <td class="mono">${esc(o.file)}</td>
      <td>${o.weight}</td>
      <td class="wrapcell mono">${o.matched
        .map((m) => `${esc(m.name)}${m.sharedBy > 1 ? ` <span class="pill info">×${m.sharedBy}</span>` : ''}`)
        .join(' ')}</td>
    </tr>`,
  );
  return `
  <h2>What renders this</h2>
  <p>Resolved from the code, not from a list. Every class name the app put on
  this screen was traced back to the file that writes it; a file scores a whole
  point for a class nothing else declares and a fraction of one for a class it
  shares, so the weight is “how much of this screen is unmistakably yours”.
  <code>×n</code> marks a class <b>n</b> files declare.</p>
  ${table(['File', 'Weight', 'Classes matched on screen'], rows)}`;
}

function tokensSection(screen) {
  const rows = screen.tokens.map(
    (t) => `<tr>
      <td class="mono">${esc(t.name)}</td>
      <td>${t.night ? `<span class="sw" style="background:${esc(t.night)}"></span>` : ''}</td>
      <td>${t.day ? `<span class="sw" style="background:${esc(t.day)}"></span>` : ''}</td>
      <td>${
        t.inPalette
          ? `<span class="pill pass">${esc(t.group || 'palette')}</span>`
          : '<span class="pill fail">not in globals.css</span>'
      }</td>
    </tr>`,
  );
  const strays = screen.tokens.filter((t) => !t.inPalette);
  return `
  <h2>The tokens it is painted with</h2>
  <p>Measured, not inferred: every CSS rule that <i>matched a visible element on
  this screen</i> was read for the custom properties it asks for. That is the
  engine which painted the shot answering the question, so a token here is a
  token this screen actually spends.</p>
  ${
    strays.length
      ? `<div class="note warn"><p>${strays
          .map((t) => `<code>${esc(t.name)}</code>`)
          .join(', ')} ${strays.length === 1 ? 'is' : 'are'} used on this screen and defined
      nowhere in <code>globals.css</code>. That is usually a variable injected from
      outside the palette (<code>next/font</code> writes one); it is shown rather than
      hidden, because a name with nothing behind it is exactly what a designer must not
      copy.</p></div>`
      : ''
  }
  ${table(['Token', 'Park Midnight', 'Trail', 'Where'], rows)}`;
}

/** How a string was matched, said in a way a reader can weigh. */
const matchPill = (c) => {
  if (c.how === 'exact') return '<span class="pill pass">verbatim</span>';
  if (c.how === 'ambiguous') {
    return `<span class="pill info">in ${c.hits} files — too common to attribute</span>`;
  }
  return `<span class="pill info">${esc(c.how)}</span>`;
};

function copySection(screen) {
  const traced = screen.copy.filter((c) => c.sources.length);
  const untraced = screen.copy.filter((c) => !c.sources.length);
  const rows = traced.map(
    (c) => `<tr>
      <td class="wrapcell" style="color:var(--label)">${esc(c.text)}</td>
      <td class="wrapcell mono">${c.sources.map(esc).join('<br>')}</td>
      <td>${matchPill(c)}</td>
    </tr>`,
  );
  const strayRows = untraced.map(
    (c) => `<tr>
      <td class="wrapcell" style="color:var(--label)">${esc(c.text)}</td>
      <td>${
        c.how === 'too-short'
          ? '<span class="pill info">too short to trace</span>'
          : '<span class="pill fail">traced to nothing</span>'
      }</td>
    </tr>`,
  );

  return `
  <h2>Every word on it</h2>
  <p>Read off the screen — the visible text and the accessible names, which are
  copy too and are the half a screenshot cannot show — and then traced back to
  the file each one is written in. <b>Nothing in this table was retyped.</b>
  A <code>prefix-n</code> match is a line the app interrupts with a value, so
  only its opening words can be matched whole. A phrase found in more files than
  a source could plausibly be written in is reported as too common to attribute,
  with the count, rather than being handed four arbitrary sources — <b>a false
  source is worse than none</b>, because it sends a reader to the wrong file.
  Comments are stripped before a source is searched, for the same reason: this
  repo writes its comments in full sentences, and “Here” appears in a dozen of
  them.</p>
  ${table(['On screen', 'Written in', 'Match'], rows)}

  <h3>Traced to nothing</h3>
  <p>Strings the app painted that no file in <code>apps/party-tracker</code>,
  <code>packages/shared</code>, <code>CONTEXT.md</code> or the venue data
  contains. Most are live values — a temperature, a distance, a clock — and a
  few are copy assembled from parts. They are listed rather than quietly
  dropped, because <b>a string with no source is a string a mock is free to
  invent</b>, and that is how a party code the app cannot mint ends up in a
  design.</p>
  ${table(['On screen', 'Why'], strayRows)}`;
}

/**
 * What a Profile changes here — and, loudly, what this shot is not.
 *
 * There are no Clerk keys on the machines these captures run on, so the sign-in
 * screens are genuinely unreachable and are not drawn. What is reachable is the
 * app's own signed-in *rendering*, driven by a session written into the key
 * `lib/auth/session.js` reads. That is a real state of the app and a useful one
 * — it is where Marks stops saying "Sign in" — but it is NOT a sign-in, and a
 * page that let a reader think otherwise would be doing the thing this whole
 * project exists to stop. Hence the warning, on every page that carries one.
 */
function profileSection(screen, record) {
  if (!screen.profile?.shown || !record.seededProfile) return '';
  const p = screen.profile;
  const gained = (p.gainedCopy || []).map(
    (c) => `<tr>
      <td class="wrapcell" style="color:var(--label)">${esc(c.text)}</td>
      <td class="wrapcell mono">${c.sources.length ? c.sources.map(esc).join('<br>') : ''}</td>
      <td>${c.sources.length ? matchPill(c) : '<span class="pill fail">traced to nothing</span>'}</td>
    </tr>`,
  );
  const lost = (p.lostCopy || p.stringsLost.map((text) => ({ text, sources: [] }))).map(
    (c) => `<tr>
      <td class="wrapcell" style="color:var(--label2)">${esc(c.text)}</td>
      <td class="wrapcell mono">${c.sources.length ? c.sources.map(esc).join('<br>') : ''}</td>
    </tr>`,
  );

  return `
  <h2>What a Profile changes here</h2>
  <div class="note warn">
    <p><b>This shot was taken with a session seeded into
    <code>${esc(record.seededProfile.key)}</code>, not with a sign-in.</b> There are no Clerk
    keys on the machine that took it, so the sign-in card and the OAuth buttons
    are genuinely unreachable and are not drawn anywhere in this twin.</p>
    <p>The seeded Profile carries two fields and nothing that pretends to be a
    person — <code>${esc(record.seededProfile.displayName)}</code> and an id that
    says what it is. Rank, Title and XP were left out so the app derives them
    with its own functions. If a name, Title or number on this shot looks like a
    real guest's, it is not; treat every one of them as the app's own default.</p>
  </div>
  <div class="shots"><figure class="shot">
    <img src="${SHOT_SUBDIR}/${esc(p.shot.file)}" width="${p.shot.width}" height="${p.shot.height}"
         alt="${esc(screen.title)} with a seeded Profile" loading="lazy">
    <figcaption>${esc(record.paletteLabels[p.palette] || p.palette)}, session seeded
      <span class="fine">${(p.shot.bytes / 1024).toFixed(0)} KiB · WebP q${p.shot.quality}</span>
    </figcaption>
  </figure></div>

  <h3>Copy a Profile adds</h3>
  ${table(['On screen', 'Written in', 'Match'], gained)}

  <h3>Copy a Profile takes away</h3>
  <p class="fine">Usually the sign-in gate this screen shows without one.</p>
  ${table(['No longer on screen', 'Written in'], lost)}`;
}

function statesSection(screen) {
  const rows = screen.states
    .slice(0, 60)
    .map(
      (s) => `<tr>
      <td class="mono">${esc(s.className)}${s.flagged ? ' <span class="pill fail">state</span>' : ''}</td>
      <td class="mono">${esc(s.file)}:${s.line}</td>
      <td class="wrapcell mono">${esc(s.source)}</td>
    </tr>`,
    );
  return `
  <h2>What this shot does not show</h2>
  <p>Derived by subtraction, which is why it needs no list to keep up to date:
  these are class names the owning components can render and this capture did
  not contain. A branch added to one of those files appears here on the next
  build. Rows marked <span class="pill fail">state</span> name an empty,
  offline, error or gated screen — the ones a design has to draw and a happy-path
  mockup never does.</p>
  ${table(['Branch', 'Declared at', 'The line'], rows)}
  ${
    screen.states.length > 60
      ? `<p class="fine">${screen.states.length - 60} further branches not listed.</p>`
      : ''
  }`;
}

/* ============================================================
   Pages
   ============================================================ */

function screenPage(screen, record, model) {
  const body = screen.unreached
    ? `
  <div class="note warn">
    <p><b>This screen was not reached, and nothing has been drawn in its place.</b></p>
    <p>The tour stopped with: <code>${esc(screen.unreached)}</code></p>
    <p>A gap you can see is worth more than a screen that looks finished and is
    fiction. The twin it replaces drew a party code the app cannot mint and a
    search placeholder over a four-venue manifest; both were believable, and both
    sent an implementer down a wrong path. If this state matters, reach it — do
    not draw it.</p>
  </div>`
    : `
  ${shots(screen, record)}
  ${ownersSection(screen)}
  ${tokensSection(screen)}
  ${copySection(screen)}
  ${profileSection(screen, record)}
  ${statesSection(screen)}`;

  return page({
    file: pageFile(screen.id),
    group: PAGE_GROUP_SCREENS,
    title: screen.title,
    lede: screen.intent,
    source: `the running app at ${record.baseUrl}, ${record.venue.name}, captured ${record.capturedAt}`,
    body,
    model,
  });
}

function indexPage(record, model) {
  const cards = record.screens
    .map((s) => {
      const shot = s.shots[record.palettes[0]] || s.shots[record.palettes[1]];
      const thumb = shot
        ? `<img src="${SHOT_SUBDIR}/${esc(shot.file)}" alt="" loading="lazy">`
        : '<div class="gap">not reached</div>';
      return `<a class="card screenCard" href="${pageFile(s.id)}">
      ${thumb}
      <h3>${esc(s.title)}</h3>
      <p class="fine">${esc(s.intent)}</p>
    </a>`;
    })
    .join('\n');

  const reached = record.screens.filter((s) => !s.unreached);
  const missed = record.screens.filter((s) => s.unreached);
  const withProfile = record.screens.filter((s) => s.profile?.shown);

  const body = `
  <div class="note">
    <p>These are photographs of the app, taken by driving it. The build they were
    taken from is named under the heading, and
    <code>npm run design:twin:check</code> fails when any file one of these pages
    reads from has changed since — so a screen here cannot be both wrong and
    quiet.</p>
    <p>What it is <b>not</b>: a mockup. Nothing on these pages was drawn, and no
    number, name or string on them was typed by anyone. Where the app would not
    show something, the page says so.</p>
  </div>

  <div class="grid screens">${cards}</div>

  <h2>What was reached, and what was not</h2>
  <p>${reached.length} of ${record.screens.length} screens, in both palettes,
  at ${esc(record.venue.name)}${record.venue.locality ? ` (${esc(record.venue.locality)})` : ''}.</p>
  ${
    missed.length
      ? `<div class="note warn">${missed
          .map(
            (s) =>
              `<p><b>${esc(s.title)}</b> — <code>${esc(s.unreached)}</code></p>`,
          )
          .join('\n')}</div>`
      : '<p>Every screen in the tour was reached.</p>'
  }

  <h2>What the capture cannot see</h2>
  <p>This machine has no Clerk keys, so <b>a real sign-in is unreachable</b>: the
  sign-in card and the OAuth buttons are not drawn anywhere in this twin. They
  are absent because they could not be photographed, <i>not</i> because they do
  not exist — see <code>docs/design/WORKING-WITH-CLAUDE-DESIGN.md</code>, where
  “absence is not removal” is one of the failure modes this project has already
  paid for once.</p>
  ${!record.seededProfile ? '' : `<p>What <i>was</i> reached is the app's signed-in <b>rendering</b>, by seeding a
  session into <code>${esc(record.seededProfile.key)}</code> — the same mechanism
  the functional suite uses. ${
    withProfile.length
      ? `A Profile changes ${withProfile.length} of these screens, and each one carries the
         extra shot with a warning saying exactly what it is: ` +
        withProfile.map((s) => `<a href="${pageFile(s.id)}">${esc(s.title)}</a>`).join(', ') +
        '.'
      : 'It changed nothing the capture could see on any screen in this tour.'
  }${
    record.seededProfile.error
      ? ` The leg did not finish: <code>${esc(record.seededProfile.error)}</code>.`
      : ''
  }</p>`}
  <p>The map itself is factory output from the venue builder and is not a design
  surface; the sheet and everything above the map is. That distinction is in the
  same document.</p>`;

  return page({
    file: INDEX_FILE,
    group: PAGE_GROUP_SCREENS,
    title: 'Screens',
    lede:
      'The app’s real screens, photographed by driving the real app in both ' +
      'palettes — with the components, tokens, copy and unshown states behind ' +
      'each one resolved from the code.',
    source: `the running app at ${record.baseUrl}, captured ${record.capturedAt}`,
    body,
    model,
  });
}

/** The stylesheet the twin adds to the shell — screenshots, and the grid they sit in. */
export const TWIN_CSS = `
  .shots { display: flex; gap: 16px; flex-wrap: wrap; margin: 18px 0 8px; }
  .shot { margin: 0; flex: 1 1 260px; max-width: 320px; }
  .shot img {
    display: block; width: 100%; height: auto;
    border-radius: var(--r4); border: 1px solid var(--sep); box-shadow: var(--shadow1);
  }
  .shot figcaption { margin-top: 8px; font-size: 12px; color: var(--label2); }
  .shot figcaption .fine { display: block; color: var(--label3); font-size: 11px; }
  .shot.missing {
    border: 1px dashed var(--sep); border-radius: var(--r4); padding: 40px 12px;
    text-align: center; color: var(--label3);
  }
  .grid.screens { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
  .screenCard { text-decoration: none; }
  .screenCard img {
    display: block; width: 100%; height: auto;
    border-radius: var(--r2); border: 1px solid var(--sep); margin-bottom: 10px;
  }
  .screenCard .gap {
    border: 1px dashed var(--sep); border-radius: var(--r2); padding: 34px 8px;
    text-align: center; color: var(--label3); font-size: 12px; margin-bottom: 10px;
  }
  .screenCard h3 { margin: 0 0 4px; font-family: var(--display); font-size: 16px; color: var(--label); }
  .fine { font-size: 12px; line-height: 17px; color: var(--label3); margin: 0; }
`;

export function twinPages(record, model) {
  const out = new Map();
  if (!record) return out;
  out.set(INDEX_FILE, indexPage(record, model));
  for (const screen of record.screens) out.set(pageFile(screen.id), screenPage(screen, record, model));
  return out;
}
