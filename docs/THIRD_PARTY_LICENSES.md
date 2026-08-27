# Third-party licenses

The **party-tracker** application and Universal Venue Builder scripts are **MIT**
(see `LICENSE`).

External tools wrapped by the builder are **not** vendored into this repository.
Each adapter documents its upstream license in `packages/venue-builder/lib/adapters/registry.mjs`.

## Phone runtime (npm dependencies)

| Package | License |
| --- | --- |
| next, react, react-dom | MIT |
| qrcode | ISC |
| web-push | MIT |
| playwright (dev) | Apache-2.0 |

## Builder adapters (wrap only — not bundled in the PWA)

| Tool | License | Commercial use |
| --- | --- | --- |
| OpenStreetMap data | ODbL | OK with attribution |
| ThemeParks.wiki API | Public API | OK; cache sidecars locally |
| Playwright | Apache-2.0 | OK |
| Tippecanoe | BSD-2-Clause | OK |
| Mapillary tools | BSD-2-Clause | OK |
| SAM 2 | Apache-2.0 | OK (optional GPU worker) |
| Valhalla / GraphHopper | MIT / Apache-2.0 | Evaluate as external services |
| **Ultralytics YOLO** | **AGPL-3.0** | **Not embedded — rejected** |

## AGPL policy

AGPL-licensed computer-vision stacks (Ultralytics YOLO) are **not** linked into
this codebase or the phone bundle. Vision evidence uses Apache-2.0 segmentation
(SAM 2) or human validation when GPU workers are available. If detection is
required commercially, run a separate AGPL-compliant service or obtain an
enterprise license from Ultralytics — never import it here.

## LLM providers

Agent orchestration calls an OpenAI-compatible API using your own key
(`VENUE_LLM_API_KEY`). Model provider terms apply to that traffic; no model
weights ship with this repo.
