# Architecture map — Park Bound

A visual tour for new developers. Read this before diving into files.
Short tree: [docs/repo-structure.md](./repo-structure.md). Package seams: [packages/README.md](../packages/README.md).
Adapter / evidence detail: [universal venue builder architecture](./universal-venue-builder-architecture.md).

---

## The one idea

Two runtimes, one contract:

| Runtime | Lives in | May use the network? | Ships to phones? |
| --- | --- | --- | --- |
| **Builder** | `packages/venue-builder/` | Yes — Overpass, Nominatim, research | No |
| **Phone (PWA)** | `apps/party-tracker/` | Optional — party mesh, weather | Yes |

The builder writes JSON. The phone fetches JSON. Nothing in the phone imports
builder code, LangGraph, Valhalla, or YOLO.

```mermaid
flowchart TB
  subgraph edit ["Hand-edited input"]
    OV["packages/venue-builder/data/venues/&lt;id&gt;/overrides.json"]
    HT["heights.json"]
    RC["recipe.json"]
    IDS["ids.json"]
    ATTR["attractions.json"]
    SRC["sources.json"]
  end

  subgraph build ["Builder — packages/venue-builder"]
    BV["bin/build-venue.mjs"]
    AT["bin/attractions.mjs"]
    TR["bin/trace-venue.mjs"]
  end

  subgraph ship ["Generated output — do not hand-edit"]
    MAP["apps/party-tracker/public/venues/&lt;id&gt;.map.json"]
    POIS["apps/party-tracker/public/venues/&lt;id&gt;.pois.json"]
    MAN["manifest.json"]
    VIX["apps/party-tracker/lib/venueIndex.js"]
  end

  subgraph phone ["Phone PWA — apps/party-tracker"]
    STORE["lib/venue/store.js"]
    PM["ParkMap.jsx"]
    PAGE["app/page.js"]
    PR["partyRuntime.js"]
  end

  OV & HT & RC & IDS & SRC --> BV
  ATTR --> AT
  BV --> MAP & POIS & MAN & VIX
  BV --> AT
  AT --> POIS
  TR --> ATTR
  MAP & POIS & MAN --> STORE
  STORE --> PM & PAGE
  PAGE --> PR
```

**Rule of thumb:** wrong ride / height / tag → fix `packages/venue-builder/data/venues/` or `packages/venue-builder/lib/`,
then regenerate. Never patch `apps/party-tracker/public/venues/*.json` by hand.

---

## System map — what talks to what

```mermaid
flowchart LR
  subgraph devices ["Phones in a party"]
    H["Host phone<br/>authoritative roster"]
    C1["Client phone"]
    C2["Client phone"]
  end

  subgraph optional ["Optional infrastructure"]
    RELAY["Mailbox / WebRTC signaling<br/>apps/party-tracker/app/api/mailbox"]
    SYNC["server/index.mjs<br/>LAN host"]
    WX["Weather API<br/>app/api/weather"]
  end

  subgraph static ["Precached on device"]
    SW["apps/party-tracker/public/sw.js"]
    VEN["venues/*.map.json<br/>venues/*.pois.json"]
    SHELL["Next.js shell"]
  end

  H <-->|"sealed patches"| C1
  H <-->|"sealed patches"| C2
  H -.->|"signaling / fallback"| RELAY
  C1 -.-> RELAY
  C2 -.-> RELAY
  H -.-> SYNC
  PAGE_WX["useWeather"] -.-> WX
  SW --> VEN
  SW --> SHELL
```

Party state lives on the **host phone**. Relays move sealed blobs; they never
hold the AES key (that rides in the invite URL fragment). The map and POIs work
offline after the first open — the service worker caches them; the roster never
goes in that cache.

---

## Phone app — layers

Paths in this section are under `apps/party-tracker/`. Shared contracts (`ontology`, `wayFlags`, `mapSymbols`) live in `packages/shared/` and are re-exported from `lib/`.

```mermaid
flowchart TB
  subgraph ui ["UI — React"]
    PAGE2["app/page.js<br/>tabs, sheet, nav stacks"]
    COMP["components/*<br/>ParkMap, GlanceRail, PartyPanel, …"]
  end

  subgraph seams ["Seams — thin React glue"]
    UV["lib/venue/useVenue.js"]
    RT["lib/partyRuntime.js"]
    GPS["useGeolocation / gps/*"]
  end

  subgraph domain ["Domain — pure, no I/O"]
    CORE["lib/core/*<br/>state, protocol, crypto, session"]
    GEO["lib/geo.js · routing.js · park.js"]
    SYM["lib/mapSymbols.js · mapLabels.js"]
    WX2["lib/weather.js · rideStatus.js"]
  end

  subgraph pipes ["Pipes"]
    TX["lib/transport/*<br/>WebRTC → local HTTP → cloud → BT probe"]
    HOST["lib/party/hostService.js"]
    CLI["lib/party/client.js"]
    EL["lib/party/election.js"]
  end

  PAGE2 --> COMP
  COMP --> UV & RT & GPS
  UV --> STORE2["lib/venue/store.js"]
  RT --> HOST & CLI & TX & CORE
  HOST & CLI --> CORE
  TX --> CORE
  COMP --> GEO & SYM & WX2
  EL --> HOST
```

| Start here | Why |
| --- | --- |
| `app/page.js` | Owns tabs, sheet budget, what the map is asked to draw |
| `components/ParkMap.jsx` | SVG renderer: pan/zoom, markers, labels, route ink |
| `lib/venue/store.js` | Which venue is loaded and how it was chosen |
| `lib/partyRuntime.js` | Only bridge from React into host/client/transports |
| `lib/routing.js` | Path graph + A* turn-by-turn on the phone |
| `lib/core/state.js` | Party model and op reducer |

---

## Venue selection at boot

```mermaid
flowchart TD
  BOOT["bootVenue()"] --> LAST["Last venue on screen<br/>or manifest default"]
  LAST --> FIX{"GPS fix?"}
  FIX -->|no| STAY["Keep last / default"]
  FIX -->|yes| ASK{"venueChoiceFor()"}
  ASK -->|"ask once"| PROMPT["ParkPrompt"]
  ASK -->|"nothing to ask"| AUTO["Nearest / containing venue"]
  PROMPT -->|yes| CONF["confirmVenue — soft pin"]
  PROMPT -->|dismiss| AUTO
  HAND["Hand pick in Settings"] --> HARD["Hard pin — nothing auto-moves"]
  HOST["Party host's venue"] -->|"outranks self"| LOAD["load map.json + pois.json"]
  CONF --> LOAD
  AUTO --> LOAD
  HARD --> LOAD
```

Priority when several answers compete: **hand pick → host venue → confirmed →
GPS inside/nearest → manifest default**.

---

## Pipeline visual — building a venue

`npm run venues:build` is the main path. `--rebuild` replays `recipe.json`.
Attractions inventory runs at the end of a full build.

```mermaid
flowchart TB
  subgraph in ["1 · Resolve where"]
    A1["--place → Nominatim"]
    A2["--bbox / --around"]
    A3["--rebuild → recipe.json"]
    A1 & A2 & A3 --> BOX["bounding box + pad"]
  end

  subgraph osm ["2 · Fetch & classify"]
    BOX --> OP["Overpass query"]
    OP --> EL["OSM elements"]
    EL --> LAY["buildLayers<br/>path, building, water, coaster, slide, lands, …"]
    EL --> POI["buildPois + camp pitches"]
    LAY --> TRACK["poisFromTrack<br/>named coaster/slide with no node"]
    POI --> TRACK
  end

  subgraph enrich ["3 · Enrich"]
    TRACK --> LAND["assignLands · drop offsite"]
    LAND --> Q["entrancesFromQueues"]
    Q --> KEY1["assignKeys from ids.json"]
    KEY1 --> OV2["overrides + heights sidecar"]
    OV2 --> CAMP["camping defaults"]
    CAMP --> MERGE["optional merge / trace / imagery"]
    MERGE --> KEY2["assignKeys again"]
  end

  subgraph inv ["4 · Ride inventory"]
    KEY2 --> INV["attractions inventory"]
    INV --> EV["evidence fuse"]
    EV --> PUB["publish entrances/exits<br/>that clear PUBLISH_AT"]
  end

  subgraph out ["5 · Ship"]
    PUB --> W1["write map.json + pois.json"]
    W1 --> W2["recipe.json · ids.json · attractions.json"]
    W2 --> W3["reindex → manifest.json + venueIndex.js"]
  end
```

### Inputs vs outputs

```text
packages/venue-builder/data/venues/<id>/   ← edit these (one package per venue)
        │
        ▼  npm run venues:build | rebuild | overrides | attractions
        │
apps/party-tracker/public/venues/<id>.map.json  ← generated (geometry layers)
apps/party-tracker/public/venues/<id>.pois.json ← generated (places + published entrances)
apps/party-tracker/public/venues/manifest.json  ← generated
apps/party-tracker/lib/venueIndex.js            ← generated (API route static imports)
```

### Companion scripts

| Script | Role |
| --- | --- |
| `venues:build` / `rebuild` | OSM → map + pois + recipe |
| `venues:attractions` | Entrances/exits evidence → publish into pois |
| `venues:trace` | Georeference a park PDF/map → features |
| `venues:overrides` | Re-apply overrides without refetching OSM |
| `venues:reindex` | Manifest + index only |
| `venues:report` | Checklist of what a venue carries |
| `venues:audit` / `research` | Gaps, briefs, capability hints |

---

## Attractions / evidence pipeline

A ride is not one point. The inventory finds **queue entrances and exits**,
scores each claim, and only publishes what clears the bar.

```mermaid
flowchart LR
  R["Rides in pois.json"] --> M["Master list"]
  OSM["OSM entrance=*"] --> CL["Claims"]
  CAND["candidates.mjs<br/>named ways, gates, nearest path"] --> CL
  TRACE["trace-venue GeoJSON"] --> CL
  M --> FUSE["evidence.mjs fuse"]
  CL --> FUSE
  FUSE --> SIDE["packages/venue-builder/data/venues/&lt;id&gt;/attractions.json<br/>sidecar — not on phone"]
  FUSE --> BAND{"band ≥ PUBLISH_AT?"}
  BAND -->|yes| OUT["coords on pois.json"]
  BAND -->|no| HOLD["stays in sidecar only"]
```

Weights and source keys live in `packages/venue-builder/lib/evidence.mjs`. Adapter wraps that
emit claims without becoming phone dependencies are documented in
[universal-venue-builder-architecture.md](./universal-venue-builder-architecture.md).

---

## Party mesh — how phones agree

```mermaid
sequenceDiagram
  participant Host as Host phone
  participant Relay as Mailbox optional
  participant Peer as Client phone

  Host->>Host: mint party key + code
  Host->>Peer: QR / invite fragment carries key
  Peer->>Relay: signaling / claim code
  Relay->>Host: introduce peers
  Host->>Peer: WebRTC data channel preferred
  Note over Host,Peer: All payloads AES-GCM sealed;<br/>relay never has the key
  Host->>Peer: PATCH_MEMBER / LOCATION / SET_MEET
  Peer->>Host: commands + location
  Note over Host,Peer: If host leaves, election.mjs<br/>promotes best remaining phone
```

Transport preference (failover): **WebRTC → local HTTP → cloud relay →
Bluetooth capability probe**. See `apps/party-tracker/lib/transport/registry.js`.

---

## Request path — walking directions

```mermaid
flowchart LR
  TAP["Go / Walk me there"] --> ENT["bestEntrance"]
  ENT --> GRAPH["routing.js path graph<br/>from map path layer"]
  GRAPH --> ASTAR["A* alternatives"]
  ASTAR --> PRE["RoutePreview"]
  PRE --> START["Start"]
  START --> NAV["course-up map<br/>NavBanner + NavBar"]
  NAV --> VOICE["useVoiceGuidance"]
```

Routing runs **on the phone** against the venue's path geometry. Builder-side
route QA (`venues:route-qa`) is optional validation, not the runtime engine.

---

## API surface (when a server is up)

Most of the app is client-side. API routes exist for the optional cloud/LAN
fallback and a few soft services:

| Area | Path | Notes |
| --- | --- | --- |
| Party mailbox | `/api/mailbox/*` | Sealed blob relay + signaling |
| Party REST | `/api/party`, `/members`, `/location`, … | Cloud fallback store |
| Weather | `/api/weather` | Only routine outbound call; cached, fails soft |
| Health | `/api/health`, `/api/ready`, `/api/metrics` | Ops |
| Rides / status | `/api/rides`, `/api/ride-status` | Server-visible ride helpers |

Self-host everything with `npm run sync` (`server/index.mjs`) or Docker.

---

## Where to change what

| You want to… | Edit | Then |
| --- | --- | --- |
| Fix a height / alias / district tint | `packages/venue-builder/data/venues/<id>/overrides.json` or `heights.json` | `venues:overrides` or rebuild |
| Fix tag → layer/category mapping | `packages/venue-builder/lib/osm-tags.mjs` | rebuild affected venues |
| Fix fusion / publish threshold | `packages/venue-builder/lib/evidence.mjs` | `venues:attractions` |
| Change map drawing / symbols | `apps/party-tracker/components/ParkMap.jsx`, `packages/shared/mapSymbols.js` | app tests |
| Change party protocol | `apps/party-tracker/lib/core/*`, `lib/party/*` | unit + functional tests |
| Change sheet / tabs UX | `apps/party-tracker/app/page.js`, `lib/sheet.js` | UX / visual tests |
| Add a whole new park | Actions → Build a venue, or `venues:build` | report + PR |

---

## Suggested first hour

1. `npm run setup` (or install + `npm test:unit`) — see [INSTALL.md](../INSTALL.md).
2. Skim this map, then [packages/README.md](../packages/README.md) and [repo-structure.md](./repo-structure.md).
3. Open `apps/party-tracker/public/venues/manifest.json` and one `*.pois.json` — that is what the phone sees.
4. Trace one tap: place card → `bestEntrance` → `routing.js` → `ParkMap` route layer.
5. Trace one party message: `partyRuntime` → `seal` → transport → `hostService` / `client`.
6. Rebuild one small venue dry-run: `npm run venues:rebuild -- big-kahunas --dry-run`.

---

## Related docs

- [README — Building a map of somewhere else](../README.md#building-a-map-of-somewhere-else)
- [Packages — deep-module seams](../packages/README.md)
- [Repository structure](./repo-structure.md)
- [Universal venue builder architecture](./universal-venue-builder-architecture.md)
- [Dependency / adapter matrix](./universal-venue-builder-dependency-matrix.md)
- [Self-contained party handoff](./HANDOFF-self-contained.md)
- [App updates](./app-updates.md)
