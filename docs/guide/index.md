# Parkbound guide

[← README](../../README.md)

Full documentation split out of the root README. Start with [Features](features.md) or jump to what you need.

| Topic | Summary |
| --- | --- |
| [Walkthrough](walkthrough.md) | Video + stills: map, coaster tap, heights, walking, party. |
| [Features](features.md) | What the app does — map, party, directions, weather, and more. |
| [Getting started](getting-started.md) | Install, run on a phone, and local development. |
| [Walking directions](walking-directions.md) | On-device routing from venue geometry. |
| [How the party works](party.md) | Host, transports, failover, and standalone server. |
| [API](api.md) | Mailbox, REST surface, weather proxy, and rate limits. |
| [Notifications](notifications.md) | Web Push setup and what gets sent. |
| [Browser limits](browser-limits.md) | What the web platform cannot do yet. |
| [Tests](testing.md) | Unit, functional, grandma, visual, and CI modules. |
| [Venue builder](venue-builder.md) | Build a map of anywhere OpenStreetMap covers. |
| [Ride entrances](ride-entrances.md) | Why markers are not queue gates, and what is derived. |
| [Privacy](privacy.md) | Party codes, keys, and what leaves the browser. |
| [Data sources](data-sources.md) | OpenStreetMap, heights, weather, and attributions. |
| [Repository layout](layout.md) | Where code and generated venue output live. |
| [Contributing](contributing.md) | Issues, PRs, builder contract, and README screenshots. |
| [Store binaries](../../fastlane/README.md) | Capacitor iOS/Android shells and Fastlane upload. |
| [Store releases](store-releases.md) | Web vs metadata vs native — when App Store review applies. |
| [Apple Developer](apple-developer.md) | Identifiers vs Xcode vs Keys; SIWA Services ID. |
| [Release cycle](release-cycle.md) | Merge-driven web shipping; when to dispatch store.yml. |
| [Neon Postgres](neon.md) | Preview branching, `DATABASE_URL` wiring, pooling, and exhaustion. |

## See also

- [INSTALL.md](../../INSTALL.md) — non-technical install for end users
- [Architecture map](../architecture-map.md) — system diagram and execution flows
- [Repository structure](../repo-structure.md) — short tree
- [Packages](../../packages/README.md) — deep-module seams
- [Disney park apps vs Park Bound](../research/2026-08-15-disney-park-apps-vs-park-bound.md) — official Disney guest-app audit and what not to copy
