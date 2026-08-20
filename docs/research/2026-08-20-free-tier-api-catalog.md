# Free-Tier API Catalog — Venue-Map Visual Factory

*Research note, compiled 2026-08-20, from four dump files: `geo-data`, `assets-media`, `ai-gen`, `infra-verify`. Every claim below is traced to a URL from those dumps. Cost rules applied: no per-token fees (subscription Claude/Gemini + free tiers only); guest-facing quotas need a cap or must be back-office-only; every shipped asset is license-gated (AGPL/NC rejected); attribution obligations are recorded.*

**Guest-path vs back-office, at a glance:** Stages 1–5 (truth inputs, design/concept, asset sourcing, bake/compile, certification) are build-time / back-office — quota math against 10k Overpass queries/day or 5 req/sec Geoapify caps is irrelevant to guest count. Only **Stage 6 (delivery)** and **Stage 7 (live app data — weather, queue times)** scale with concurrent guests and are the only rows below that strictly require a cap or a paid/self-hosted fallback.

---

## 1. Stage-by-Stage Catalog

### Stage 1 — Truth inputs (OSM/geocoding/elevation/imagery)

| API/Service | Free-tier quota (as-of 2026-08-20) | Commercial use | Attribution | Auth | Output license | Status |
|---|---|---|---|---|---|---|
| Overpass API (overpass-api.de) | Fair-use guidance: <10,000 queries/day, <1GB/day; 429→30s backoff | Not prohibited | **Required**: "© OpenStreetMap contributors"; ODbL share-alike on derived extracts | None (custom UA/Referer mandatory) | ODbL / CC-BY-SA (legacy) | **in** — back-office, self-throttle to 10k/day, set real UA |
| Overpass mirrors (kumi.systems, VK, private.coffee) | No published hard caps | Not prohibited | Same as above | Same | Same | **watch** — fallback capacity, no SLA |
| Nominatim (public OSMF instance) | Hard 1 req/s; bulk 4 req/min | Allowed for normal app use; **reselling geocoding results prohibited** | ODbL, "suitable for medium" | None (custom UA/Referer) | ODbL | **rejected** — "apps whose primary function is geocoding must self-host," not viable as production backbone |
| Geoapify | 3,000 credits/day, 5 req/sec, multi-key allowed | Allowed ("Limited Commercial Use") | Mandatory `Powered by Geoapify` link | API key | OSM-derived per Geoapify ToS | **in** — back-office geocoding, commercial-safe with attribution |
| OpenCage | 2,500 req/day, 1 req/sec | **Not permitted — "testing only"** | Not detailed | API key | — | **rejected — non-commercial trap** |
| LocationIQ | 5,000 req/day, 2 req/sec / 60 req/min | **Allowed with attribution** (`Search by LocationIQ.com` link) | Required | API key | OSM/Nominatim-derived, own infra (not bound by Nominatim no-resale clause) | **in** — best commercial-safe geocoder swap-in |
| Stadia Maps | Shared credit pool, geocoding = 20 credits/call | **Dev/eval/non-commercial only** — paid Starter ($20/mo) required for revenue apps | — | API key/domain | — | **rejected — non-commercial trap** |
| OpenTopoData (public) | 100 loc/request, 1 call/sec, **1,000 calls/day** | No explicit ban but positioned "for testing"; self-host recommended | Per-DEM-source (SRTM/ASTER/etc.) | None | Public-instance ToS is dev-only | **adopt:volume-exceeds-1k/day → self-host** (OSS, Docker) |
| Open-Elevation (public) | ~1,000 req/**month** | Self-hosted use permitted under GPLv2 (copyleft on your own mods) | Not clearly specified; verify at self-host | None | GPLv2 (self-host path) | **adopt:self-host** — public instance unusable at any real volume |
| Google Elevation API | **No free tier without billing**; expired $200/mo credit (Feb 2025) | Allowed, paid product | — | API key + billing | — | **rejected** — no viable free tier |
| Microsoft Planetary Computer STAC (NAIP per ADR-0020) | STAC search: open, no key, best-effort shared resource; asset access via SAS tokens (free subscription key raises signing rate limit) | No published commercial ban (verify ToS directly before shipping) | NAIP: "requested," not required (credit USDA FPAC-BC-GEO); Sentinel: **verbatim required** — "Copernicus Sentinel data [Year]" | None for search; SAS token for blobs | NAIP: US public domain; Sentinel: Copernicus free/open, commercial OK | **in** — primary imagery source per ADR-0020 |
| Sentinel Hub | **30-day trial only**, 30,000 req / 300 PU-min during trial | **Trial explicitly disallows commercial use** | — | OAuth client id/secret | — | **rejected — one-time trial + non-commercial trap**; use Planetary Computer or Copernicus Data Space instead |
| USGS TNM Access | Unresolved — docs fetch failed/404'd | Public-domain data pattern suggests unrestricted | — | Likely none | US public domain (17 U.S.C. §105) | **watch — open item**, needs follow-up fetch before relying on hard numbers |
| OpenTopography (3DEP front-end) | 200 calls/24h academic, **50 calls/24h non-academic**; 1m DEM gated to academic accounts | Enterprise key required for commercial/high-volume | — | Free API key | 3DEP: US public domain | **adopt:volume-exceeds-50/day → Enterprise key or TNM direct** |

### Stage 2 — Design/concept (AI reference art, ADR-0017 admissible)

| API/Service | Free-tier quota (as-of 2026-08-20) | Commercial use | Attribution | Auth | Output license/rights | Status |
|---|---|---|---|---|---|---|
| Google Gemini AI Studio (text/vision, e.g. 2.5/3.x Flash) | "Free of charge" input/output/caching; third-party aggregate estimate ~15 RPM/1,500 RPD Flash-class, ~5 RPM/50 RPD Pro (Google itself disclaims these numbers — check live dashboard) | ToS doesn't explicitly ban commercial output use, **but** free-tier content is used "to improve our products," human reviewers may read/annotate I/O; **unusable for EEA/UK/Switzerland-facing users** | None documented | API key | Google retains improvement/training rights over free-tier I/O | **in (text/prompt/caption steps only, non-EEA)** — do not submit sensitive prompts; per ADR-0017, log as reviewed input |
| Google Gemini image models (Imagen 4, Gemini 2.5 Flash Image "Nano Banana") | **Not available on free tier** — billing required | N/A | N/A | N/A | N/A | **rejected for stage 2 image-gen** — free tier is text-only |
| Cloudflare Workers AI (Flux/SDXL/dreamshaper, image-gen) | **10,000 Neurons/day pool, shared across ALL models**; no card required | You own outputs / full commercial rights per Cloudflare terms | None from Cloudflare | None (free plan) | Cloudflare: your content; **underlying model license may differ** (e.g. some Flux variants non-commercial) — verify per model before ledger entry | **in, with per-model license check** — the only confirmed recurring free image-gen path |
| Groq (text/audio LLMs) | 30 RPM on flagship OSS models (varies by model family) | Standard | None documented | API key | — | **in** — free text/prompt/caption/QA step, no image-gen capability |
| OpenRouter free (`:free` models) | 20 RPM/50 RPD (<$10 lifetime credit) or 20 RPM/1,000 RPD ($10+ purchased); roster volatile (14→15→20 models observed churning weekly) | Not detailed per-model | Not detailed | API key | Varies by backing model | **watch** — text/vision only, no free image-gen, fragile model roster |
| Hugging Face Inference Providers | ~100K monthly credits (unverified exact $ value) + ZeroGPU (~3.5 min/day) | HF doesn't claim model/data ownership; is a router — third-party (fal/Together/Replicate) terms also apply | Not detailed | API key | Router — verify Supplemental Terms PDF | **watch** — verify credit value and per-backend terms before shipping outputs |
| Mistral La Plateforme ("Experiment" free tier) | Reported ~1B tokens/month aggregate (unverified); exact RPM no longer published | Not detailed | Not detailed | API key/account | — | **watch** — text-only, numbers unconfirmed, check console before depending on it |
| Together AI | Conflicting reports: possibly **no free tier now** (pay-first $5 min); startup credits are application-based | — | — | — | — | **rejected** — not reliably free, conflicts with no-per-token-fee rule |
| Fireworks AI | **$1 one-time** signup credit, not recurring | — | — | — | — | **rejected** — one-time credit only |
| Replicate | **No free tier, no trial credits** | Pay-as-you-go | — | — | — | **rejected** |
| Stability AI | **25 credits one-time**, Google-login-only | — | — | — | — | **rejected** — one-time trial |

### Stage 3 — Asset sourcing (CC0 sprites/PBR/fonts, sha-pinned ledger)

| API/Service | Free-tier quota | Commercial use | Attribution | Auth | Output license | Status |
|---|---|---|---|---|---|---|
| ambientCG (v2 API) | No documented cap | **Unrestricted commercial** | **Not required** ("appreciated" only) | None | CC0 1.0 | **in** — primary PBR source |
| Poly Haven (REST API) | No numeric cap published | "Free... forever, personal or commercial" | Assets: none required. **Live API usage itself requires "Powered by Poly Haven" credit** (record this obligation) | None (unique User-Agent required) | CC0 (assets) | **in** — record the API-usage attribution separately from asset attribution |
| ShareTextures | N/A — no API, download-only | CC0 | None | N/A | CC0 | **watch** — needs manual/scripted mirror step, not live-queryable |
| Kenney | N/A — no API, download-only | CC0 (per ecosystem consensus; direct license page unreachable this session) | None | N/A | CC0 (unverified direct) | **watch — verify license page directly** before treating as fully confirmed |
| OpenGameArt.org | N/A — no official API | Mixed **per-submission** (CC0/CC-BY/CC-BY-SA/GPL, sometimes multiple choices per asset) | Varies | N/A | Mixed, incl. **copyleft (GPL/CC-BY-SA)** | **rejected for automated pipeline** — violates AGPL/NC/copyleft-reject rule without per-asset human curation; no machine-readable license feed |
| Wikimedia Commons Action API | No hard published cap for anonymous GET; batch 50 titles/req unauth | Per-file, ranges PD/CC0 to CC-BY-SA | Per-file `AttributionRequired` field in `extmetadata` | None | Mixed, machine-readable via `extmetadata.License` | **in** — check `extmetadata` per file before ledger entry |
| Openverse | Anonymous OK; "standard"/"enhanced" tiers via OAuth2 for higher limits (no official numeric ceiling) | Per-item CC license | Per-item | Optional OAuth2 | Mixed CC licenses per item | **watch** — aggregator, same per-item verification burden as raw Commons |
| Smithsonian Open Access | DEMO_KEY 30 req/hr; registered key 1,000 req/hr | Unrestricted commercial | **Not required** | Free api.data.gov key | CC0 1.0 | **in** — 2D reference art/period imagery |
| Met Museum Collection API | 80 req/sec | Commercial OK **only for `isPublicDomain: true` items** | Per-object `rightsAndReproduction` check | None | CC0 subset only — must gate per object | **in, with per-object gate** |
| Iconify API | No numeric cap on public instance | Allowed for majority of sets, **but check per-set** | Per-set (many require CC-BY) | None | Per-icon-set (mostly MIT/Apache/OFL/CC-BY) | **watch** — resolve license per set prefix before bulk commercial use |
| Google Fonts Developer API | Quota undocumented, historically generous | Allowed | **Not required** (OFL/Apache) | API key | OFL / Apache 2.0 | **in** |
| Bunny Fonts | Free, no key, drop-in Google Fonts replacement | Allowed | Not required | None | Same as Google Fonts (OFL/Apache) | **in** — preferred over Google API key mgmt/telemetry |
| Fontsource | npm packages, not a live API | Allowed | Per-package (mostly none required) | None (build-time install) | Mostly OFL-1.1, some Apache-2.0/Ubuntu Font License | **in** — self-hosted, no runtime dependency, best determinism for bake/compile |
| TheColorAPI | No published rate limit | No explicit restriction | None | None | Utility, no asset license concern | **in** — deterministic palette generation |
| Colormind | No published cap | **"Free for personal and non-commercial use"** — commercial requires emailing maintainer | None | None | — | **rejected/trap** — not commercial-safe by default |
| Lospec Palette API | Keyless, by-slug only, no search | Not exposed via API — check palette page individually | Not exposed via API | None | Community-authored, mostly free-to-use but unconfirmed per palette | **watch** — verify per-palette before ledger entry |

### Stage 4 — Bake/compile (local, no APIs needed)

Local-only per pipeline design — no hosted API required. **Where a hosted API could substitute:** Cloudflare Images (5,000 free transformations/month, but only for **externally-stored** images — no free storage/delivery of Cloudflare-hosted images itself) could offload texture resize/transform work from local baking if that step becomes a bottleneck. Source: https://developers.cloudflare.com/images/pricing/. **Status: watch** — back-office only if adopted, no guest-scaling concern since bake/compile never runs in the guest request path.

### Stage 5 — Certification/verification (local Playwright; perceptual services as adopt-triggers)

| API/Service | Free-tier quota | Commercial use | Attribution | Auth | License of outputs | Status |
|---|---|---|---|---|---|---|
| Lost Pixel Core (self-hosted) | Unlimited — OSS, runs in your own CI | N/A (self-hosted) | N/A | N/A | N/A | **in** — best zero-cost fit, runs inside free public-repo GH Actions minutes |
| Percy (BrowserStack) | 5,000 screenshots/mo, 30-day build history | Not detailed as restricted | Not detailed | Account | N/A | **adopt:volume/feature-exceeds Lost Pixel Core** |
| Chromatic | 5,000 billed snapshots/mo, no CC required; separate free-for-OSS program | Not detailed as restricted | Not detailed | Account | N/A | **adopt:volume/feature-exceeds Lost Pixel Core** |
| Argos CI | 5,000 screenshots/mo (Hobby) | Positioned "personal projects and experiments" — **unconfirmed for commercial** | Not detailed | Account | N/A | **watch — confirm commercial policy before production use** |
| Microlink / ScreenshotOne / Browserless | 25/day, 100/mo, 1,000 units/mo respectively | Not explicitly banned but framed as prototype-tier | Varies | API key (some) | N/A | **watch** — only for occasional on-demand preview renders (back-office, low volume), not bulk CI; self-hosted headless browser in free GH Actions is cheaper for bulk |
| UptimeRobot | 50 monitors, 5-min checks, 3-mo log retention | Not restricted | None | Account | N/A | **in** — back-office monitoring |
| Sentry (Developer) | 5,000 errors/mo, 5M spans/mo, 50 replays/mo, 1 seat | Not explicitly banned, broadly usable for small commercial projects | None | Account | N/A | **in** — back-office error tracking |
| Better Stack | 10 monitors, 30s checks, 3-day/3GB log retention | Not restricted | None | Account | N/A | **watch — alternative if check-frequency matters more than retention** |

### Stage 6 — Delivery (Vercel origin IS the CDN per ADR-0018; PMTiles pyramids per ADR-0019) — **guest-facing, needs caps**

| API/Service | Free-tier quota (as-of 2026-08-20) | Commercial use | Attribution | Auth | License | Status |
|---|---|---|---|---|---|---|
| Vercel Hobby | 100GB/mo Fast Data Transfer, 1M Edge Requests/mo, 1M function invocations/mo, 4hr Active CPU/mo | **No explicit ban on pricing page, but Hobby ToS "generally restricts to personal/non-commercial" — unresolved, verify directly** | N/A | Account | N/A | **in, with cap monitoring — verify ToS commercial clause before scaling guest traffic; this is the current deployed target per ADR-0018** |
| Cloudflare Pages | 500 builds/mo, unmetered bandwidth (CDN) | Not restricted | N/A | Account | N/A | **adopt:Vercel-100GB-cap-approached** — offload large static bundles |
| Cloudflare R2 | 10GB-mo storage, 1M Class A ops/mo, 10M Class B ops/mo, **free unconditional egress** | Not restricted | N/A | Account | N/A | **adopt:same trigger** — best fit for PMTiles pyramid storage |
| Cloudflare Workers (fronting R2) | **100,000 req/day** — far tighter than R2's own ops caps | Not restricted (verify general ToS) | N/A | Account | N/A | **watch — this cap is the real guest-scaling bottleneck if used as a dynamic front for R2**; needs its own guest-traffic cap plan |
| Cloudflare Images | 5,000 transformations/mo, externally-stored images only | — | — | Account | — | **watch** — not free storage/delivery, transform-only |
| jsDelivr | No bandwidth limit, no premium tier; commit-pinned URLs cached 1yr edge | **Permitted**, used commercially at scale | Not required | None | N/A (public CDN over your own repo/npm content) | **in** — ideal for immutable versioned map-tile/bundle delivery to guests, sidesteps Vercel's 100GB cap entirely |
| GitHub Pages | 1GB site, 100GB/mo soft bandwidth, 10 builds/hr | **Explicitly prohibited** — "cannot be used as a free web-hosting service to run your online business" | N/A | N/A | N/A | **rejected — explicit commercial-use ban** |
| GitHub Releases | 2GiB/asset, 1,000 assets/release, **no aggregate bandwidth cap** | Not restricted | N/A | N/A | N/A | **in** — strong free path for large bundle/tileset distribution |
| GitHub Actions (public repo) | Unlimited minutes (public); 2,000 min/mo + 500MB artifacts (private) | Not restricted | N/A | N/A | N/A | **in** — back-office CI |
| Git LFS | 10GiB storage + 10GiB bandwidth/mo | Not restricted | N/A | N/A | N/A | **watch** — modest cap, fine for back-office, not guest delivery |

### Stage 7 — Live app data (weather, queue times) — **guest-facing, needs caps**

| API/Service | Free-tier quota (as-of 2026-08-20) | Commercial use | Attribution | Auth | License | Status |
|---|---|---|---|---|---|---|
| NOAA/NWS API | Free, no key, "generous... typical use," 429 → retry ~5s | **Explicitly allowed** — "free to use for any purpose" | Not required | User-Agent only | Open data | **in — but US-only coverage**; requires server-side caching to decouple guest request volume from upstream call volume |
| Open-Meteo | 10,000 calls/day free | **"Free API is for non-commercial use"** — explicit non-commercial clause | **Required regardless of tier** (CC BY 4.0) | None (free tier) | CC BY 4.0 | **rejected for free tier — non-commercial trap**; budget paid subscription if serving non-US venues |
| Queue-Times.com | Free, no key; rate limits **undocumented** | **Gray area — not explicitly addressed either way** | **Required**: "Powered by Queue-Times.com" + link | None | N/A | **watch — email maintainer to confirm commercial policy**; must be server-side cached/throttled since guest-facing and quota is unpublished |

---

## 2. Traps

**Non-commercial-only free tiers (the ADR-flagged trap class):**
1. **Open-Meteo** — "The free API is for non-commercial use," explicit clause; CC BY 4.0 attribution required regardless of tier. (https://open-meteo.com/en/pricing)
2. **Stadia Maps** — free tier "explicitly restricted to development, evaluation, and non-commercial/academic use only." (https://stadiamaps.com/pricing/)
3. **Sentinel Hub** — 30-day trial *and* "trial explicitly disallows commercial use." (https://www.sentinel-hub.com/pricing/)
4. **OpenCage** — free tier stated as "testing only," commercial/production use not permitted. (https://opencagedata.com/pricing)
5. **Colormind** — "free for personal and non-commercial use"; commercial requires emailing the maintainer directly. (http://colormind.io/api-access/)

**Explicit resale/geocoding-backbone prohibition:**
6. **Nominatim public instance** — "apps whose primary function is geocoding must self-host Nominatim, not hit the public instance"; reselling geocoding results prohibited outright. (https://operations.osmfoundation.org/policies/nominatim/)

**Explicit commercial-hosting ban:**
7. **GitHub Pages** — "cannot be used as a free web-hosting service to run your online business." Disqualifies it for any delivery role. (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

**One-time credits masquerading as "free tier" (will silently run dry mid-pipeline if wired as a recurring step):**
8. **Fireworks AI** — $1 one-time signup credit, not recurring. (https://fireworks.ai/pricing)
9. **Stability AI** — 25 credits one-time, Google-login-gated only. (search-aggregated, platform.stability.ai)
10. **Together AI** — conflicting reports now suggest a $5 min purchase is required upfront, i.e. possibly no free tier at all as of Aug 2026. (search-aggregated)
11. **Replicate** — confirmed no free tier and no trial credits at all. (https://replicate.com/pricing)

**ToS reaching for rights over your inputs/outputs (provenance risk for the ledger's "original-class" ingest):**
12. **Google Gemini AI Studio (free/"Unpaid" tier)** — "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services"; human reviewers "may read, annotate, and process" I/O. Explicit warning: "Do not submit sensitive, confidential, or personal information." Also geofenced: "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom." (https://ai.google.dev/gemini-api/terms)
13. **Cloudflare Workers AI** — platform ToS grants you output ownership, but the *underlying open-source model* (Flux, SDXL, etc.) "may be subject to open source or other license terms that apply between you and the model provider" — some Flux variants are non-commercial. Verify per-model before a ledger entry, not just the platform terms. (https://developers.cloudflare.com/workers-ai/platform/pricing/)

**Unautomatable / mixed-license source (violates the "every shipped asset license-gated" rule if ingested blindly):**
14. **OpenGameArt.org** — no official API, per-submission mixed licenses including copyleft GPL/CC-BY-SA, no machine-readable license feed; forum itself states there's no supported API path. (https://opengameart.org/forumtopic/opengameart-api)

**Ambiguous commercial policy, needs direct confirmation before production reliance:**
15. **Vercel Hobby** — no explicit commercial ban found in the pricing page text, but "Hobby ToS generally restricts to personal/non-commercial use — verify in Vercel's actual Terms." This matters because Vercel is the actual delivery origin/CDN per ADR-0018. (https://vercel.com/docs/limits/overview)
16. **Queue-Times.com** — commercial use "not explicitly addressed either way," attribution is the only stated condition; rate limits entirely undocumented, a real risk for a guest-facing live-queue feature. (https://queue-times.com/pages/api)
17. **Argos CI / Percy / ScreenshotOne** — commercial-use restrictions "not stated explicitly" on their pricing pages; Argos in particular is framed "for personal projects and experiments." Confirm before treating as a production verification dependency.

---

## 3. Shortlist — wire now vs later

**Frame:** fixed-cost, back-office, build-time steps (stages 1–5) are cheap to wire immediately because their quotas don't multiply by guest count — quality×reach payoff is high and risk is capped to "we self-throttle a shared free API." Stages 6–7 are the guest path, where the *same* quota numbers become variable cost that scales with traffic — those get wired now only where commercial-use is unambiguous and cheap fallback exists, with everything else deferred to an explicit adopt-trigger.

### Wire now
- **Overpass (self-throttled, real UA) + Microsoft Planetary Computer STAC (NAIP)** — truth-data core per ADR-0020, both effectively free at build-time volume, both commercial-clean.
- **LocationIQ or Geoapify** for geocoding — the only two researched geocoders that are both free-tier and commercial-safe with attribution; avoids the Nominatim resale trap entirely.
- **ambientCG + Poly Haven** for CC0 PBR/HDRI — zero-friction, CC0, no attribution burden on assets (record Poly Haven's separate "Powered by" *API-usage* credit).
- **Wikimedia Commons + Smithsonian Open Access + Met Museum (isPublicDomain gate)** for reference art — all keyless or low-friction-key, all machine-checkable per item, matching the sha-pinned ledger's need for per-asset license proof.
- **Google Fonts Developer API / Bunny Fonts / Fontsource** for typography — OFL/Apache across the board, Fontsource's npm-package model is best for bake/compile determinism (no runtime API call at all).
- **Gemini AI Studio, text/vision only, non-EEA** for prompt-engineering/captioning per ADR-0017 — cheap, but log every input as non-sensitive given the training-use clause.
- **Cloudflare Workers AI** for actual image generation — the *only* confirmed recurring free image-gen path found in this survey; wire it now but gate each output on the underlying model's own license (not just Cloudflare's platform terms) before it enters the original-class ledger.
- **Lost Pixel Core self-hosted in GitHub Actions** for visual regression — free, unlimited, runs on already-free public-repo Actions minutes, matches the "local Playwright" certification design directly.
- **Sentry Developer + UptimeRobot** for back-office monitoring — both generous enough (5,000 errors/5M spans/mo; 50 monitors) to cover a small-to-medium app at zero cost.
- **jsDelivr + GitHub Releases** for immutable bundle/PMTiles delivery — unlimited bandwidth, commercial-friendly, sidesteps Vercel's 100GB/month cap for the heaviest guest-facing assets (map tile pyramids) without touching Vercel's own quota.
- **NOAA/NWS** for US-venue weather — free, no key, explicitly commercial-allowed; wire with server-side caching so guest request volume doesn't equal upstream call volume (NOAA rate limit is unpublished — cache regardless).

### Wire later (adopt-trigger)
- **Self-hosted OpenTopoData/Open-Elevation** — trigger: elevation pulls exceed the public instances' 1,000/day (OpenTopoData) or 1,000/month (Open-Elevation) caps.
- **Cloudflare Pages/R2** — trigger: Vercel's 100GB/month Fast Data Transfer is approached, or the Hobby-tier commercial-use ToS ambiguity is confirmed as a real restriction.
- **Percy or Chromatic hosted perceptual diff** — trigger: Lost Pixel Core's self-hosted coverage or CI capacity becomes insufficient.
- **OpenTopography Enterprise key or direct TNM Access** — trigger: elevation volume exceeds OpenTopography's 50 calls/24h non-academic cap, once TNM's own limits are confirmed (open item).
- **Paid weather provider (Open-Meteo Standard, or a commercially-licensed alternative)** — trigger: the factory needs to serve non-US venues, since NOAA is US-only and Open-Meteo's free tier is legally non-commercial.
- **Geoapify/LocationIQ paid tier** — trigger: back-office geocoding volume during venue onboarding exceeds daily free caps (3,000/day and 5,000/day respectively).

### Rejected outright (do not wire, even provisionally)
- Nominatim public instance (resale ban, 1 req/s)
- OpenCage (testing-only)
- Stadia Maps free tier (non-commercial)
- Sentinel Hub free access (trial-only, non-commercial)
- Google Elevation API (no free tier without billing)
- GitHub Pages (explicit commercial-hosting ban)
- OpenGameArt.org (mixed/copyleft licenses, unautomatable)
- Replicate, Together AI, Fireworks AI, Stability AI as *recurring* pipeline dependencies (no standing free tier / one-time credits — violates the no-per-token-fee, standing-pipeline requirement; a one-time evaluation burst is fine, a wired step is not)
- Colormind for commercial palette generation without the maintainer's explicit written OK
- Open-Meteo free tier for any shipped weather feature (non-commercial clause)

---

### Sources
All URLs are as cited inline above; primary source list per dump:
- `geo-data`: wiki.openstreetmap.org/wiki/Overpass_API, operations.osmfoundation.org/policies/nominatim, geoapify.com/pricing, opencagedata.com/pricing, locationiq.com/pricing, stadiamaps.com/pricing, opentopodata.org, open-elevation.com, developers.google.com/maps/documentation/elevation, open-meteo.com/en/pricing, queue-times.com/pages/api, planetarycomputer.microsoft.com/terms, sentinel-hub.com/pricing, opentopography.org/developers, weather.gov/documentation/services-web-api
- `assets-media`: docs.ambientcg.com/api/v2, polyhaven.com/license, github.com/Poly-Haven/Public-API, opengameart.org/forumtopic/opengameart-api, mediawiki.org/wiki/API:Main_page, docs.openverse.org, api.si.edu/openaccess, metmuseum.github.io, github.com/iconify/icon-sets, developers.google.com/fonts/docs/developer_api, fonts.bunny.net/about, fontsource.org, thecolorapi.com/docs, colormind.io/api-access, lospec.com/palettes/api
- `ai-gen`: ai.google.dev/gemini-api/docs/pricing, ai.google.dev/gemini-api/terms, developers.cloudflare.com/workers-ai, huggingface.co/pricing, console.groq.com/docs, together.ai/pricing, fireworks.ai/pricing, replicate.com/pricing, platform.stability.ai/pricing, docs.mistral.ai, openrouter.ai/docs/api-reference/limits
- `infra-verify`: vercel.com/docs/limits/overview, developers.cloudflare.com/pages/platform/limits, developers.cloudflare.com/r2/pricing, developers.cloudflare.com/workers/platform/limits, jsdelivr.com/documentation, docs.github.com (Actions/LFS/Releases/Pages limits), microlink.io/pricing, screenshotone.com/pricing, browserless.io/pricing, percy.io/pricing, chromatic.com/pricing, argos-ci.com/pricing, lost-pixel.com, uptimerobot.com/pricing, betterstack.com/pricing, sentry.io/pricing, vercel.com/docs/analytics/limits-and-pricing

**Open items carried forward (unresolved in the dumps, flag for follow-up):** USGS TNM Access exact rate limits/ToS (fetch failed); Mapillary imagery-source terms (mentioned in ADR-0020 but not covered by any research dump — needs a dedicated pass); Vercel Hobby's exact commercial-use clause (pricing page silent, ToS not directly read); Kenney's license page (site restructured, direct confirmation pending).

---

# Addendum — Game-asset sources deep dive (sprites, textures, 3D, icons, audio)

Dedicated lens on pipeline-fetchable game-art sources; where it overlaps the Stage-3 table above,
the two passes agree (and this addendum resolves the main pass's two open items: **Kenney's CC0 is
confirmed** via the author's own statement + per-pack pages, and **Poly Haven's commercial-friendly
ToS is verified from the primary GitHub ToS.md** — a third-party summary claiming
non-commercial-only is wrong).

## Reconciled rulings

- **OpenGameArt**: the main pass's "rejected for automated pipeline" and this lens's
  "manual-curation-only" are the same ruling — its CC0 search filter is real, but with no API and
  GPL/CC-BY-SA content mixed in, it is a human-vetted batch-import source, never a live endpoint.
- **Two new ledger license rules surfaced**: (1) **GPL art is rejected** alongside AGPL (same
  copyleft spirit; OpenGameArt hosts it); (2) **CC-BY-SA is not CC-BY** — share-alike propagation
  is not covered by the "CC-BY acceptable" rule and is rejected pending an explicit policy
  decision (affects OpenMoji; Twemoji CC-BY 4.0 is the compliant emoji/icon substitute).

## Textures / PBR

- **ambientCG** — CC0 confirmed (docs.ambientcg.com/license, covers files AND previews). Real REST
  API v3: `https://ambientCG.com/api/v3/assets` with `q`, `type` (material/hdri/decal/atlas/
  3d-model/…), `sort`, `id`, `limit` (≤500), `include` field selector; `/categories`,
  `/collections`, `/rss`; legacy v1/v2 CSV/JSON endpoints. No key for reads; rate limits not
  published — cache and be polite. **in** (primary PBR source; this documents the API surface the
  factory should call).
- **Poly Haven** — CC0 everything; full OpenAPI at `api.polyhaven.com` (`/assets`, `/info/{id}`,
  `/files/{id}` with per-file `url`+`md5`+`size` — pin-friendly, `/taxonomy`, `/authors`). No key;
  **must send a unique User-Agent/Referer**. ToS (primary source): commercial use explicitly
  permitted; only obligation is a "Powered by Poly Haven" credit when surfacing API content live
  in a UI — not for downloaded CC0 assets baked into worlds. **in**.
- **textures.com** — **rejected**: proprietary license bans redistribution of raw files and
  forbids release under open licenses; credit-gated, no API.

## 3D models (baking sources)

- **Poly Pizza** — API v1.1 (search by category/license/keyword, curated lists); auth token
  mandatory; licenses are per-model and include NC/ND/SA variants — **adopt for low-poly props
  with a hard `license ∈ {CC0, CC-BY}` ingest filter** and per-asset attribution in the ledger.
- **Sketchfab** — Data API has real `license=cc0`/`by` filters (2,000+ CC0 models; most free
  content CC-BY); glTF/GLB downloads — but the Download API requires an authenticated account
  (OAuth2/service account), so unattended fetch needs credential plumbing. **watch / adopt when a
  service account is provisioned**.
- **Objaverse / Objaverse-XL** — bulk-downloadable Sketchfab mirror (`pip install objaverse`);
  per-object `license` annotation inherited from Sketchfab — **adopt for bulk baking-source
  acquisition only with a per-object license filter** that quarantines anything outside CC0/CC-BY.
- **Quaternius** — CC0 low-poly packs, but itch.io/Drive-hosted with no stable URLs: manual
  batch import, not a live source. **watch**.
- **Photogrammetry** (Smithsonian 3D CC0-badged items · Scan the World mixed-CC ·
  threedscans.com PD-by-reputation but no on-site license text): all manual-curation, no APIs;
  Three D Scans entries must be ledger-flagged "license asserted by consensus, not primary grant".
  **watch**.

## Sprites / tilesheets / icons

- **Kenney** — CC0 confirmed; no API but stable-pattern URLs
  (`kenney.nl/media/pages/assets/<pack>/<contenthash>/kenney_<pack>.zip`) — pin resolved URL +
  sha at fetch; re-resolve from the pack page when a re-fetch 404s (hash rotates on updates).
  All-in-1 itch.io pack (60k+ assets incl. audio/fonts) is a one-time manual import. **in** —
  primary sprite/tilesheet/autotile-stock source.
- **Autotile/dual-grid sets specifically**: no dedicated CC0 autotile API exists; Kenney tile
  kits + OpenGameArt's CC0-filtered tileset tag are the realistic stock, re-sliced by the
  factory's own autotile tooling.
- **Game-icons.net** — 4,170+ CC-BY 3.0 SVGs in a git repo (`github.com/game-icons/icons`):
  clone and pin by commit SHA; attribution wired once. **in**.
- **Twemoji** (jdecked fork) — graphics CC-BY 4.0, code MIT, versioned jsDelivr/npm delivery.
  **in**. **OpenMoji** — CC-BY-**SA** 4.0: rejected pending the share-alike policy call above.
- **itch.io** — real API but storefront-shaped (creator/account ops), no license-filtered catalog
  search; per-creator license heterogeneity. **watch** (individual creators' pages, manually).
- **CraftPix free** — **rejected**: license bans redistribution of raw files (same root reason as
  textures.com).

## Audio (future-proofing)

- **Freesound API v2** — real API; key for search, OAuth2 for original-file downloads; limits
  60/min & 2,000/day (read); license filter has exactly three buckets — `"Creative Commons 0"`,
  `"Attribution"`, `"Attribution NonCommercial"` — the NC bucket must be excluded at ingest.
  **adopt when audio enters scope**. Kenney audio rides the existing CC0 adoption.

---

# Attribution policy — one generated notice (owner decision, 2026-08-20)

**Decision:** attribution is consolidated into a single overarching credits record, GENERATED from
the ledgers — never hand-maintained (scripts-over-instructions). A `credits:build` step walks the
vendor-asset ledger (source, license, sha) and the source registry (APIs, data, attribution terms)
and emits:

1. `NOTICE.md` at the repo root — every source, license, role.
2. A credits JSON the app renders as one **Legal / Credits** screen.

This satisfies CC0 courtesy credits, all plain **CC-BY** obligations (a consolidated credits
screen is attribution "reasonable to the medium"), Copernicus's verbatim Sentinel line, museum and
reference sources, and font licenses (OFL/Apache).

**Two carve-outs that cannot live only in the credits screen:**

- **OpenStreetMap (ODbL):** "© OpenStreetMap contributors" stays visible on or one tap from the
  map itself per OSMF attribution guidance; the corner notice links to the full credits screen.
- **ToS-mandated placed links:** any service whose terms specify a placed "Powered by" link
  (Geoapify / LocationIQ if wired, Queue-Times if adopted, Mapillary logo+link on derived
  detections) carries a `placement` field in its registry row, and the generator emits it into
  the required slot, not the general list.

Registry rows gain an `attribution` field (none / credits-screen / on-map / placed-link:<where>);
the generator refuses to build if a wired source lacks one — attribution becomes a gate, like
licenses. Implementation: Train H (app shell work); generator is a small scripts/lib module +
test per the repo's gate-script pattern.
