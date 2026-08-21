# Parkbound design twin

An interactive twin of `apps/party-tracker`, imported from the Claude Design project
"Parkbound App". Every screen the app ships, in both palettes, as one self-contained page.

This is a **reference artifact, not a build input.** Nothing in the app imports from this
directory, and no script generates it. It is here so the design the app was reconciled against
is version-controlled next to the code rather than living only in a hosted editor.

## Open it

```sh
cd docs/design/parkbound-twin && python3 -m http.server
# then open http://localhost:8000/viewer.html
```

It renders with **no network** — React and the typeface are vendored under `vendor/`. Opening
`parkbound-app.dc.html` directly will not work: it ships only the dc-runtime, which needs
`window.React` and `window.ReactDOM` that the file never loads. `viewer.html` exists to supply
them; see its header comment for why the bootstrap order matters.

Use the row of buttons above the phone frame to switch screens, and the toggle beside them to
swap palettes.

## What is in here

| Path | What it is |
| --- | --- |
| `parkbound-app.dc.html` | The canvas. `<x-dc>` template (`{{expr}}`, `<sc-if>`, `<sc-for>`) plus a `<script type="text/x-dc">` block holding the component logic, state and copy. |
| `support.js` | The generated dc-runtime that parses and renders the canvas. |
| `viewer.html` | Local host page. The only file here we wrote. |
| `vendor/` | React 18.3.1 UMD + Plus Jakarta Sans, so the page works offline. |
| `sync-contract.md` | The project's own `github.md`: which repo files each screen maps to, and its sync log. |
| `sketches/` | Hand-drawn inputs from the design session. |

`parkbound-app.dc.html` and `support.js` are imported artifacts and are kept **byte-identical**
to what Claude Design produced. Anything the canvas needs in order to run locally belongs in
`viewer.html`, never in those two files.

## Screens

Thirteen, reachable from the switcher: `auth · intro · gate · world · explore · plan · party ·
me · quests · settings · closet · marks · walking`, plus sub-states inside the frame — the map
Key, Place detail, the bare-ground spot with its two follow-ups, the Marks sign-phrase picker,
Collection Skins/Kits, the four Settings topics, and Plan's Stops/Heights sections.

## How to read it against the app

Three things are worth knowing before treating any pixel here as a specification.

**The token system is already ours.** The twin was generated *from* `app/globals.css`, so the
palettes match byte for byte — night `--bg: #0B1829`, day `--sep: rgba(16,35,63,.16)`, brand
`--adventure: #FF6B35`, and so on. Differences between the twin and the app are structure,
copy and interaction, never colour. The canvas writes everything as inline `style` attributes;
the app uses classes in `globals.css`. Translate, don't paste.

**It is a flat prototype.** `pois`, `members` and `venues` are hardcoded arrays; the party code
`PB-4K9T`, the `Search 100+ Worlds` placeholder, the `Location on` badge and the `Photo —
entrance` box are all fabrications with no source in the app. A few handlers contradict their
own labels. Match presentation; never copy the prototype's data model or its wiring.

**Absence is not removal.** `sync-contract.md` keeps a "Not yet in the twin" list — walk
history, Diagnostics, QR scan join, Managed Guests, subgroup tags, route alternates. Those are
app features the twin never drew, not features the design dropped.

Where the twin and the app disagreed and the app won, the reason is recorded in the code at the
point of the decision — search `globals.css` and the components for comments explaining why a
value differs from the mock.

## Keeping it current

`sync-contract.md` describes the flow the design project used: read the contract, pull what
changed in `apps/party-tracker` since its timestamp, rebuild only the screens whose mapped files
moved, then rewrite the log. That sync runs in Claude Design, not here — this directory holds a
snapshot. Re-export and replace the two artifact files to refresh it.

Its screen map was accurate when written but drifts. At import it already pointed at
`components/WorldPicker.jsx` and `lib/worlds.js`, neither of which existed — that screen was
split across `GpsGate`'s inner `ParkSection` and `ParkPrompt.jsx`. Verify a path before trusting
it.

That map has since been corrected and put under a check: it lives in
`scripts/lib/design-bundle/sources.mjs` as well, where `npm run design:check` re-verifies every
path against the working tree. For the next round of design work, start from
[`../WORKING-WITH-CLAUDE-DESIGN.md`](../WORKING-WITH-CLAUDE-DESIGN.md) and the generated system
bundle in [`../system/`](../system/) — this directory is the snapshot that was reconciled
against, and the bundle is the thing that stays current.
