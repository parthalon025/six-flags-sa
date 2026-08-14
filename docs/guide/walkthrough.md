# Walkthrough

[← README](../../README.md) · [Guide index](index.md)

The [README video](../../README.md#walkthrough) (`docs/images/readme/walkthrough.mp4`) is a single phone session at Kings Island. Stills from the same capture sit in the [screenshot gallery](../../README.md#screenshots). This page is the example script those media follow.

## 1. Drawn map (not tiles)

Open the app inside the park. The canvas is SVG projected from OpenStreetMap: midways, water, buildings, and every coaster centreline. District names lie along their land. The orange pulse is you.

Still: `docs/images/readme/map-day.png` · [Features](features.md)

## 2. Night map

Tap the moon. Same geometry, low-glare colours. It follows the phone's appearance until you pick one.

Still: `docs/images/readme/map-night.png`

## 3. Tap a coaster

Tap **The Beast**. Its own track lights up (Kings Island's coaster polylines carry the ride name). The callout shows walk time and the height rule; the sheet has **Walk me there**.

Still: `docs/images/readme/ride-callout.png`

## 4. Height requirements

On **Plan**, set a rider to **46″**. Rides that are out turn alarm red on the map — ringed and struck through, with a tally (`46″ · 34 of 68 rides`). Not faded: fading is what a missing party member looks like.

Still: `docs/images/readme/height-filter.png`

## 5. Walking directions

Search **beast**, expand the row, tap **Walk me there**. The phone graphs the venue file (no routing API). You get time, arrival, a via, and **Start walking** — the map draws the path first; nothing starts until you say so.

Still: `docs/images/readme/walking.png` · [Walking directions](walking-directions.md)

## 6. Live party

**Party → Start a party**. A second phone joins with the six-character code. Both people appear on the map; the glance rail shows walking time and range. The host is a phone in the group.

Still: `docs/images/readme/party.png` · [How the party works](party.md)

## Regenerating the media

```bash
npm run start          # or npm run dev
npm run readme:shots   # writes stills + walkthrough.mp4
npm run readme:shots:check
```

`docs/images/readme/shots.json` lists each file and the source paths that should force a recapture. `readme:shots:check` fails a PR that changes those sources without new media.

---
[← README](../../README.md) · [Guide index](index.md)
