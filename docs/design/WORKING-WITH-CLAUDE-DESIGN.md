# Working with Claude Design

How to drive Parkbound's front end from a Claude Design project without the
mock and the code quietly disagreeing.

This exists because the last import cost five recon agents and four
implementation agents, and almost none of that was design work. It was spent
finding out **where the twin had drifted from the code**, because nothing said.
Its screen map pointed at a `components/WorldPicker.jsx` that did not exist. Its
`--cat-*` colour tokens were invented. Its `judge()` was a lossy retype of
`lib/eligibility.js`. Its party code was a format the app cannot mint.

None of those are design mistakes. They are the ordinary decay of a copy, and a
copy is what a hand-built twin is.

---

## The direction is one way

**The repo is authoritative. A connected Design project is downstream.**

That is a rule about resolution, not about respect. Design leads on how a screen
looks and how it behaves; the repo owns what is true — what the tokens are, what
a Place is called, what the party code looks like, which components exist. When
the two disagree about a *fact*, the repo wins and the mock gets corrected. When
they disagree about a *judgement*, that is a real design conversation.

The practical form of the rule: **never port a value out of a mock.** Port the
intent, then look the value up.

### Connecting a project

**The push is yours to make, and it has to be made from your own machine.**

DesignSync cannot authenticate anywhere else. `/design-login` needs an
interactive terminal, so no remote or background session can sign in, and
therefore none can push. That is not a limitation being worked around — it is
the reason the connection step is a wizard rather than a paragraph.

    npm run design:push

That walks five stages, checking state at each one rather than reciting
instructions:

1. **Are you local?** It looks for `CLAUDE_CODE_REMOTE`,
   `CLAUDE_CODE_REMOTE_SESSION_ID`, `CODESPACES`, `SSH_CONNECTION` and a real
   tty, and refuses outright if you are not on your own machine — because
   finding that out at the push itself leaves you nowhere to go.
2. **A fresh bundle.** It runs `design:build`, then `design:check`, then
   `design:plan`, so what you push is generated from the tree you are standing
   in. It stops if any of the three fails.
3. **`/design-login`, then the project.** Note that **a project's type is fixed
   at creation.** A regular Design project can never become a design system;
   if that is what you have, create a new one. There is no conversion.
4. **The push.** `list_files` → `finalize_plan` (the writes are the bundle's
   paths) → `write_files` with a `localPath` and `mimeType` per file. The
   wizard prints every path and mime type, read out of `design:plan --json`, so
   nothing has to be derived by hand.
5. **Verification.** Every card in the right group — the wizard prints the
   expected count and grouping out of `_ds_manifest.json`, so it moves with the
   bundle rather than with this paragraph — and the type actually rendering in
   Plus Jakarta Sans rather than a fallback.

It is safe to re-run. It rebuilds rather than assumes, remembers the project
name, and `write_files` overwrites by path.

Then keep a sync contract in the project, the way
[`parkbound-twin/sync-contract.md`](./parkbound-twin/sync-contract.md) does: a
screen map from project screen → repo files, plus the timestamp it was last
reconciled at. On a sync, rebuild only the screens whose mapped files moved.

### What has NOT been proved

**The round trip has never been exercised from this environment, because it
cannot be.** DesignSync is not reachable from a remote session at all, so no
agent working on this repo has pushed this bundle, seen the Design System pane,
or watched a card render. Everything below the push — how the cards group, how
the pages look once the project renders them — is inference from the format,
not observation.

What *has* been checked here, locally and mechanically:

- the bundle is self-contained: every reference in every page resolves to a
  file inside the push root, verified by `design:plan` and by
  `test/scripts/design-bundle.test.mjs`;
- the vendored typeface really loads and really paints, measured in headless
  Chromium against a server rooted at `docs/design/system/` with nothing above
  it, in both palettes;
- the bundle satisfies DesignSync's documented per-file, per-call and
  path-length limits.

So the **first real push is yours**, and stage 5 of the wizard is not a
formality. Expect to verify it rather than assume it, and if a card is missing
or the type looks wrong, that is new information nobody has had yet — say so.

One thing is transcribed rather than derived and is the known drift risk:
`DESIGN_SYNC_LIMITS` in `scripts/lib/design-bundle/compose.mjs` holds
DesignSync's 256 KiB per-file, 256-file per-call and 256-character path limits,
copied from the documented contract because the tool's schema cannot be read
from here. If a push fails on a limit, correct it there — the wizard, the CLI
gate and the test all read it.

### The generated bundle

`docs/design/system/` is built by `npm run design:build` and verified by
`npm run design:check`. `npm run design:plan` shows it as DesignSync would push
it and fails if it is not pushable; `npm run design:push` walks the push itself.
Nothing in it is written by hand:

| Page | Derived from |
| --- | --- |
| Colour | `app/globals.css` — both palette blocks, parsed |
| Type | `app/globals.css` — the `--fs-*` / `--lh-*` / `--tr-*` triples |
| Spacing | `app/globals.css` plus `lib/sheet.js`'s measured budget |
| Radius | `app/globals.css` — the `---- radii ----` group |
| Skins | `lib/world.js` — `mapPaint()`, called |
| Icons | `components/Icon.jsx` — the real `GLYPHS` path data |
| Vocabulary | `CONTEXT.md`, verbatim |
| Screen map | checked against the working tree, every path |

Change a token in `globals.css`, and regenerating changes the bundle. Fail to
regenerate, and `design:check` fails and names the file. That is the whole
mechanism: the bundle cannot be right and stale at the same time.

The directory also carries its own typeface, at
`docs/design/system/vendor/fonts/`. That is not tidiness — it is the difference
between the bundle being correct on disk and being correct once pushed.
DesignSync writes to **project-relative** paths, so a page that reaches sideways
with `../` resolves to nothing in the project. Every page used to carry
`url('../parkbound-twin/vendor/fonts/…')`, and every page would have fallen back
to system faces the moment it was pushed — silently, since a webfont that fails
to load does not announce itself and the fallback stack is close enough to pass
a glance. **A design system that misrepresents its own typeface is the same
class of failure as a glyph page that omits a glyph.**

So the push root is self-contained, and that is *checked* rather than intended:
`design:plan` and the test both require every reference in every page to resolve
to a file in the push plan. That one rule covers `../`, absolute paths, http(s)
URLs and dangling links at once, and cannot be satisfied by a shape nobody
thought to ban.

Three weights travel — 400, 600, 800 — because those are the three
`@font-face` rules the shell declares, generated from the same `FONT_WEIGHTS`
list that decides which files get vendored. @fontsource ships five. 500 and 700
are not *dropped*: they were never declared, so 700-weight text already matches
to the 800 face and renders today exactly as it will after the push. Adding them
would change how the pages render; leaving them out changes nothing and saves
~24 KB on every push. `docs/design/parkbound-twin/` keeps all five for its own
offline viewer, and remains the upstream copy the bundle vendors from — it is a
separate thing and is not the push unit.

It also cross-checks a few things the app has no other assertion for, and prints
what it finds. Those are reported, never thrown — a mirror that refuses to
render because the thing it reflects has a blemish is no use to anybody.

### The twin: the app's own screens

The bundle above is the design system — tokens, glyphs, words. What it was
missing is the app. `npm run design:twin` supplies it: it boots the real app,
drives it, photographs every screen it can reach in both palettes, and writes
those out as pages that join the same push unit.

    npm run build && npm run start &          # a server, on any port
    BASE_URL=http://127.0.0.1:3000 \
      CHROMIUM_PATH=/opt/pw-browsers/chromium \
      npm run design:twin

One command. It refuses to run against a server whose `/app-version.json` does
not name this tree's `HEAD`, because a screenshot of another build filed as this
one is the drift the twin exists to stop — and that has already happened on this
repo's own boxes.

**A photograph is not the point; the four tables under it are.** For each screen
the page carries what a mockup can never have, and none of it is written by hand:

| On the page | Read from |
| --- | --- |
| What renders this | the class names the app put on screen, traced to the files that declare them, weighted so an exclusive class counts for more than a shared one |
| The tokens it is painted with | every CSS rule that *matched a visible element*, harvested for `var(--…)` — the engine that painted the shot answering the question |
| Every word on it | the visible text and the accessible names, each traced back to the file it is written in — with comments stripped first, and a phrase found in too many files reported as too common to attribute rather than given an arbitrary source |
| What this shot does not show | the branches the owning components can render and this capture did not contain — derived by subtraction, so a new branch appears without anyone updating a list |

**Nothing on a twin page was retyped.** Copy that traces to no file is listed
under *Traced to nothing* rather than being quietly presented as sourced, and a
screen the tour could not reach gets a page saying why, with nothing drawn in
its place. That is the whole discipline: the last twin's `PB-4K9T` and
`Search 100+ Worlds` were believable, and each sent an implementer down a wrong
path. An absence you can see costs an afternoon; a plausible invention costs a
session.

#### What it does not capture, and why

**A real sign-in.** There are no Clerk keys on the machines these captures are
taken on, so the sign-in card and the OAuth buttons cannot be reached at all and
are drawn nowhere. They are shipped features. Per *Absence is not removal*
above, a screen missing from the twin is a gap in the twin — not a decision.

**The map, as design.** It is factory output from the venue builder — see the
section above. The twin photographs it because it is what the screen looks like,
not because it is up for redesign.

**Anything behind a second phone.** Party screens are captured from the host's
side, with a party this capture really created and a code the server really
minted. A joined roster needs two phones and is not part of the tour.

#### What a seeded session does reach

The signed-in *rendering* is a different thing from a sign-in, and it is
reached. After the main tour the capture writes a session into the key
`lib/auth/session.js` reads — the same mechanism `test/app/functional.mjs` uses,
and for the same reason: without a Profile, Marks answers “Sign in” before it
ever reaches the screen you wanted to look at. It then re-walks the tour and
keeps an extra shot only where a branch appeared or a line of real copy changed.
(Not where a string changed: the app draws a clock, and a clock ticking is not a
Profile doing anything.)

That seeded Profile carries an id and a label that says what it is, and nothing
else — rank, Title and XP are left out so the app derives them with its own
functions rather than being handed numbers. **It is not a sign-in**, every page
carrying one of those shots says so on its face, and the real sign-in screens
remain undrawn.

The leg re-runs on its own, because the signed-out evidence is already in the
record and does not need taking again:

    npm run design:twin:profile

#### Improving a reader without re-photographing

    npm run design:twin:resolve

The shots are the expensive half; the annotations are cheap and pure. `resolve`
re-derives every screen's components, tokens, copy and unshown branches from the
evidence already in the capture record — no server, no browser, images
byte-identical — and re-keys the staleness fingerprint, because a better reader
reads a different set of files.

#### Staleness

    npm run design:twin:check

Hashing the image would be useless: the app draws a live clock, live weather, a
breathing GPS pulse and map labels placed by a layout pass, so two captures of
an unchanged app differ in thousands of pixels. The check is keyed on the
**inputs** instead — every file the twin renders an annotation from, recorded at
capture time — and fails when one of them has changed. A component appearing or
disappearing is reported but never thrown, because a component on disk is not
yet a screen.

It is deliberately **not** wired into `test:unit` or CI. Fixing a stale twin
means re-photographing, which needs a built app and a browser; a gate that fires
in an environment that cannot clear it is a gate that gets switched off, which is
how the last twin came to be trusted while being wrong. Run it when you change a
screen, and before a push. What *is* in `test:unit` is
`test/scripts/design-twin.test.mjs`, which proves the check fires on real drift
and that no page renders a string the capture did not record.

### The bundle is only as good as its readers

The generator parses real source, so a weak pattern produces a confident, wrong
page. That is not hypothetical either: the first version of the glyph reader was
anchored on `: (`, which matches

```js
'sun.max.fill': (        // multi-line, parenthesised
  <>…</>
),
```

but silently skips

```js
'bolt.fill': <path … />,  // single line, no parentheses
```

Ten of the thirty-four glyphs are the second kind. The page showed twenty-four
glyphs and the build reported three Kit and Mark icons as missing — all of them
real, all of them fine. **A design-system page that omits a glyph is worse than
no page, because it teaches a designer that glyph does not exist.**

So the readers are tested like anything else, and the tests assert *floors*
rather than snapshots — at least 34 glyphs, every `KIT_ICONS` / `MARK_ICONS`
value resolving — because the cheap way to make a "nothing is missing" check
pass is to stop finding things. If you add a source to the bundle, add the
assertion that would catch it under-reading.

---

## Pre-flight: before you trust a mock

Five minutes, and it is the whole of what the last import was missing.

**1. Verify the screen map still resolves.** Every path, against the working
tree. `npm run design:check` does this for the repo's own map and fails on a
path that has stopped existing. If the mock carries its own map, check it by
hand — this is the single highest-yield step, and it is the one that was skipped.

**2. Check tokens against `globals.css`, never against the mock.** Open
`docs/design/system/tokens-color.html`, or grep the stylesheet. A token that is
not in that file does not exist, however plausible its name. The twin's
`--cat-food`, `--cat-ride` and friends read exactly like tokens this app would
have. It has never had them.

**3. Never copy the prototype's data model.** A Design prototype is flat by
construction: hardcoded arrays, one state object, handlers that fake a
transition. The app has real state, a host election, an overlay layer and an
upload queue. Match the *presentation*; leave the wiring alone.

**4. Read the comment before changing the value.** `globals.css` and the
components are heavily commented, and the comments are usually the record of a
decision that has already been argued once. If a value differs from the mock,
there is often a sentence at that exact line saying why.

**5. Treat absence as absence.** A screen the mock never drew is not a screen
the design deleted. See below.

---

## Known failure modes

Every one of these is from the last import. They are listed because they
recurred, not because they were exotic.

### Fabricated data that looks like a spec

The twin showed a party code of `PB-4K9T`. Real codes are six characters drawn
from `CODE_ALPHABET` in `lib/core/ids.js` — a 32-character alphabet with **no
I, O, 0 or 1, because the code is read aloud and typed in by hand** — and there
is no `PB-` prefix. Building the UI around `PB-4K9T` would have produced a field
sized for the wrong string and a hyphen the app never emits.

Same class: `Search 100+ Worlds` as a placeholder, when the manifest ships four
venues. A hardcoded `Location on` badge, which is untrue on the manual-pin and
denied paths. A decorative QR tile with no payload behind it.

**Rule:** a number or a string in a mock is set dressing until you find the code
that produces it. Gate it on real state, or leave it out.

### Invented tokens

The `--cat-*` colours. There is no such token family and never was. A mock's
stylesheet is its own; it borrows names freely and nothing stops it.

**Rule:** every colour resolves to a token in `globals.css` or it does not ship.
If a mock needs a colour the repo has no token for, the answer is the nearest
existing token — not a new one, and never an inline hex.

### Lossy logic copies

The twin's `judge()` was a re-typing of `lib/eligibility.js` with cases missing.
It looked right on the four fake members it was written against.

**Rule:** logic is never ported from a prototype. If a mock demonstrates a
behaviour, find the module that already owns it and call that. Eligibility,
routing, the sheet ladder and the score are all real modules with tests.

### Handlers wired backwards from their own labels

On the location gate, `I'm ready` called `browseApp` (which *skips* location)
and `Browse Worlds` called `enterApp` (which *turns location on*) — backwards,
and contradicting the gate's own `1 OF 2 → 2 OF 2` framing.

**Rule:** when a prototype's handler contradicts its label, the label is the
design intent and the handler is a prototype bug. Keep the repo's existing
handler. Do not port prototype transitions.

### Absence is not removal

The twin never drew walk history, Diagnostics, QR join, Managed Guests, subgroup
tags or route alternates. All six are shipped features. A prototype omits things
because drawing them is work, not because someone decided against them.

**Rule:** a screen missing from a mock is a gap in the mock. Removing a feature
is a decision someone has to actually make, out loud.

---

## Constraints a mock cannot see

A mock is rendered on a desktop monitor by someone sitting down. This app is
used one-handed, outdoors, in a queue, in direct sun. Several things follow that
no visual review will surface.

### The map is factory output, not a design surface

The map is generated by the venue builder, which owns `public/venues/*.map.json`,
`*.pois.json` and `manifest.json`. Per
[`builder-app-contract`](../agents/policies/builder-app-contract.md) that output
is never hand-edited — fix upstream, prove in the app.

A prototype's park map is scenery standing in for factory output. Cartography,
zone labels, pin symbology and ground colour are **out of scope for design**.
Everything floating *above* the map — the sheet and its detents, the search
field, the capsule, the browse list, Place detail, the tab bar — is in scope and
is where the design work actually is.

Skins are the exception that proves it: a Skin restyles how the map is painted,
never where Places sit, and its palette is `mapPaint()` in `lib/world.js`.

### `.label` is bigger and darker than it looks like it should be

`.label` is 13px, weight 500, sentence case, colour-mixed 78% toward `--label`.
It carries this comment, at the rule:

> Secondary ink, but dark enough for section headers on a white sheet (AA on
> 13px). Pure `--label2` at 60% opacity fails on outdoor glare.

A designer will reliably want to make it a proper eyebrow — smaller, lighter,
uppercase, tracked. The twin did exactly that: 11.5px, weight 800, `--label3`,
which is 34% opacity at night and 36% in day. That is **smaller and lighter than
the treatment the comment above already records as having failed.**

**This is settled repo-wide and does not get re-litigated per screen.** Uppercase
tracking is available for flavour if the size and the colour stay at `.label`'s
values. Accessibility beats fidelity to a mock rendered indoors.

### Contrast is checked because of the sun, not because of a checklist

See the floor below. The short version: a ratio that is merely adequate at a
desk is unreadable on a phone at noon, and this app is used at noon.

### The sheet's stops are a budget, not a taste

`lib/sheet.js` derives the resting stop by adding up the rungs that have to fit
in it — the chrome, the search field, the venue line or the locate card, the
hint. It is `SHEET_PEEK_PX`, and it is a sum so that it cannot drift from its
parts. A redesign that adds a band to the sheet has to come back here and pay
for it; a mock with three hardcoded stops has not.

---

## Accessibility floor

Non-negotiable, and checked rather than asserted:

- **4.5:1 for text.** WCAG AA. Large text (18.66px bold, or 24px) may use 3:1,
  and almost nothing in this app qualifies.
- **3:1 for graphical objects** that a guest has to find in order to act — an
  icon, a control boundary, a state indicator. A decorative hairline between two
  rows is not one of these.
- **Both palettes.** Trail and Park Midnight are equally shipped; a colour that
  passes in one and fails in the other has failed.

`docs/design/system/tokens-color.html` measures these from the real token values
on every build, compositing alpha onto whatever is behind it.

Several of the twin's colours did not clear the floor. The one worth
remembering: **white on `--aqua` measures 2.45:1**, which is well under AA for
label text, and those chips steer the whole of Settings and Plan. They ship with
dark ink instead — `#0B1829` on the same fill clears 7.3:1.

That is the shape of the argument to make. Not "this fails a checklist" but
"this is the control that steers Settings, it is read in direct sun, and it is
at 2.45:1".

---

## Doing a round of work

1. `npm run design:build`, then read the findings it prints. If a screen has
   moved since the last capture, `npm run design:twin` (with a current server up)
   re-photographs it; `npm run design:twin:check` says whether that is needed.
2. Do the design work in Claude Design, against `docs/design/system/`.
3. Run the pre-flight above on anything the mock proposes.
4. Implement in `apps/party-tracker`, reusing the existing classes in
   `globals.css` — the canvas writes inline `style` attributes and the app uses
   classes, so translate rather than paste.
5. Where the mock lost an argument, leave the reason in a comment **at the line
   that differs**, in the stylesheet's own voice: explain why, and tie the number
   to the thing that owns it. That comment is what stops the next round
   re-proposing the same change.
6. `npm run design:check`, `npm run design:twin:check`, `npm run lint`,
   `npm run test:unit`.
7. `npm run design:push` if the Design project needs the refreshed bundle —
   from your own machine, since nothing else can authenticate.
8. Update the sync contract's screen map and its timestamp.

Step 5 is the one that compounds. Every comment of that kind is a round of
argument the next import does not have to repeat — and this document is mostly
just the comments that were not there last time.
