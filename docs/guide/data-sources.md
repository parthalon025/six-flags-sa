# Where the data came from

[← README](../../README.md) · [Guide index](index.md)

- **Map geometry and ride positions** — OpenStreetMap contributors, pulled via the
  Overpass API and licensed ODbL. Positions are building footprints, track midpoints and
  centroids, **not queue entrances** — see [Ride entrances](ride-entrances.md) for why not,
  and for what the app does instead.
- **Height requirements** — for Kings Island, compiled from Kings Island Central and
  Theme Park Insider, reflecting the 2026 season. For Big Kahuna's, from the park's own
  2026 attraction pages, which state a minimum in prose for the thrill rides and file
  every attraction under the park's own Over 42"/44"/48" headings. For Six Flags Fiesta
  Texas, from the park's Guest Safety and Accessibility Guide, topped up for the water park
  from its own per-attraction pages, which post a Min and Max Height each. They live in
  `packages/venue-builder/data/venues/<id>/overrides.json`; a venue built from OpenStreetMap alone has
  none until somebody writes them. They change between seasons and the ride operator measures
  at the gate and has the final say, so the app says as much on the rider-height screen.
- **Weather** — Open-Meteo, at the active venue's centre from the manifest, so switching
  parks moves the forecast with the map. Which places care about which conditions is not
  data at all: `lib/weather.js` derives it from each POI's category, land and note, with
  no ride names anywhere in the file — so a venue built from OpenStreetMap alone, with no
  height overrides written for it yet, still gets a full weather picture.
- **Operating status** — nobody's but your own party's. There is no ride-status feed here
  and the app never claims one.
- Flight of Fear is not mapped in OpenStreetMap; it's placed on its show building and
  flagged as approximate in the app.
- Two renames are reflected: Backlot Stunt Coaster is now Queen City Stunt Coaster, and
  Boo Blasters on Boo Hill is now Phantom Theater: Opening Nightmare.
- The Bat's posted minimum is reported inconsistently across sources (42–54"); the app
  uses 48" and tells you to confirm at the gate.

The park's own printed map artwork is copyrighted and is deliberately not used here.

---
[← README](../../README.md) · [Guide index](index.md)
