# Free / limited-cost backends — Databricks vs Docker vs Postgres vs DuckDB vs Cloudflare vs Vercel

**Date:** 2026-08-25  
**Question:** Within a free or limited-cost constraint, what are the pros/cons and maximum capability of Databricks versus a Docker Postgres (or another hosted service) for Park Bound?

**Does not relitigate ADR-0010.** This note prices the options. Architecture stays: phone never calls a warehouse; PostDB = Postgres; Databricks = optional batch.

Related: [ADR-0008](../adr/0008-databricks-back-office.md), [ADR-0010](../adr/0010-databricks-ops-free-tier.md), [ADR-0024](../adr/0024-postdb-factory-bus.md), [free-tier API catalog](./2026-08-20-free-tier-api-catalog.md) (APIs, not databases).

---

## Consolidated pick (fewest sources to operate)

**Operate two things:** the laptop (Docker Postgres + DuckDB + `venues:*`) and **Vercel** (app + CDN + Neon via Marketplace). Everything else is parked or already a store/auth bill you cannot fold in (Clerk, Apple, Play).

```
Laptop + GitHub Actions     factory PostDB, OSM, DuckDB batch     $0 fixed
Vercel (+ Neon Marketplace) app UI, E0 API, seed public/venues    $0 Hobby / $20 Pro
Cloudflare DNS only         existing domain                       $0
```

**Do not operate:** Databricks, R2, Workers, D1, Lakebase, MotherDuck, Vercel Blob as a second store, jsDelivr as a pipeline.

| | Fixed | Variable (same invoices) | Capability you actually get |
|--|-------|--------------------------|-----------------------------|
| **Hobby + Docker** (pre-commercial) | **$0** | Hard caps (100 GB FDT, Neon 0.5 GB / 100 CU-h). No overage — it pauses. | Four flagship JSON venues, factory, E0 API. Hobby is **non-commercial**. |
| **Pro + Docker** (ship a paid product) | **$20/mo** Vercel (1 seat + $20 credit, **1 TB** FDT, 10M edge req) | FDT ~$0.15/GB after 1 TB; function CPU; Neon Launch if Free fills. Neon CU-hours. | Same factory + real production origin. PMTiles for a small fleet fit in 1 TB. |
| **Add R2** | still $20 + $0 R2 | Almost none on bytes (egress $0) | Same, plus viral tile traffic. **One extra vendor** — only when a Vercel transfer bill appears. |
| **Add Databricks** | $20 + $0 idle jobs | DBUs per run; App is **$100–400/mo** | Spark/UC. **Third vendor** — only when DuckDB/Postgres cannot finish the join. |

**Why this is the consolidation, not “all Cloudflare” or “all Databricks”:** the app is already Next.js on Vercel; Neon is already the E0 Postgres; the factory already speaks `pg`. Folding hosted OLTP + CDN + API into **one Vercel bill** removes Databricks, R2, D1, and Lakebase from the operating model. Moving the app to Workers to “only have Cloudflare” still needs a Postgres (Neon/PlanetScale) and a factory laptop — more migration, not fewer sources.

**Capability you give up by consolidating:** free egress at tile-firehose scale (R2), Spark (Databricks), and a steward lakehouse UI. None of those are required to author or wear four parks.

**Add-a-vendor triggers (do not pre-provision):**

1. Vercel FDT or Blob would bill → Cloudflare **R2** for heavy packs only.  
2. Neon Free suspends or 0.5 GB fills → Neon **Launch** (still one Vercel Marketplace row).  
3. Laptop DuckDB/Postgres melts on traces/OSM → Databricks **one paused job**, run by hand.  
4. Paid product ships → Vercel **Hobby → Pro**. That is a plan flip, not a new source.

### Owner account inventory (2026-08-25)

You already named: **Clerk Pro, Vercel, Cloudflare, Databricks, local Docker, Higgsfield, Meshy, Unreal/Unity/Godot, Claude Code Max, Cursor, Google AI subscription**.

| Already have | Job it covers | Operate? |
|--------------|---------------|----------|
| Clerk Pro | Profile auth (and Clerk-sent mail) | Yes — required |
| Vercel | App + E0 API + seed CDN | Yes — required |
| Cloudflare | DNS/SSL (and later R2) | DNS yes; R2/Workers **no** until FDT bills |
| Databricks | Parked Spark | **No** — idle; do not add Lakebase/App |
| Local Docker | Factory PostDB | Yes — required |
| Higgsfield (free) | Extra image/video gen | **No** — paid Gemini covers concept stills |
| Meshy.ai (free) | Text/image → 3D mesh | **No** for phone/CI. Beauty-lane only if a mesh is then **Blender-baked** into the world pack; check Meshy ToS before `original`-class ledger (free tiers are often non-commercial) |
| Unreal / Unity subscriptions | Game engines | **No** — ADR-0016 rejects engines anywhere certification or the phone can see. Full per-park scene export is skipped ([industry comparison](./2026-08-24-factory-industry-comparison.md)) |
| Godot | Game engine | **No** on the phone. Only adjacent adopt: **Material Maker** (Godot-based) if a design request needs a PBR graph no CC0 library has |
| Claude Code Max + Cursor | Code + factory briefs | **Yes — one Claude brain.** One session answers each brief. |
| **Google AI subscription** | Gemini vision, concept/reference stills, Train I agent-vision claims | **Yes — Gemini half of ADR-0017**, not a new backend. Paid unlocks image models the free AI Studio tier dropped. Stay on the agent-brief seam (no Gemini API keys in CI). Do not also wire Workers AI / Higgsfield for the same job. **Not** Google Maps Platform — that is a separate key if Train I geocoding fires. |

**3D that *is* on the Park Bound path:** local **Blender** (headless, pinned, E.1) + Node bake → PMTiles/MapLibre. Not an account. OSM2World → glTF is watch. Runtime three.js/KTX2 is deferred.

**On those bills already, or not a new login**

- **GitHub** (repo + Actions CI Postgres) — you have this; it is not extra.
- **Cursor** — factory briefs (`VENUE_LLM_PROVIDER=agent`).
- **Cloudflare DNS** for `parkbound.kurat0r.ai` — already in Cloudflare.

**Required and often missing from that list**

| Account | Why | Fold into |
|---------|-----|-----------|
| **Neon Free** (Vercel Marketplace) | Serverless E0 + hosted PostDB. Docker does not survive Vercel instances. | Same Vercel dashboard |
| **Upstash Redis** (Marketplace, optional until Party must span functions) | Party store on Vercel. Skip only for a single Node process. | Same Vercel dashboard |
| **Apple Developer** ($99/yr) | App Store. SBP enrollment already in the pricing note (team `CDHJC4MH4G`). | Store, not backend |
| **Google Play Console** ($25 once) | Play. | Store, not backend |

**Nice-to-have, do not sign up to “complete the set”**

Resend (Clerk already mails), Sentry, UptimeRobot, Stripe (only if web checkout besides IAP), OpenAI API (rejected — per-token), R2, D1, Lakebase, MotherDuck, Cloudflare Workers AI (paid Gemini covers concept stills).

---

## Verdict by job (if you split the question)

| Job | $0 maximum | Limited-cost maximum (~tens of $/mo) | Databricks unique value |
|-----|------------|--------------------------------------|-------------------------|
| **Factory bus (PostDB)** | Docker Postgres on the laptop + CI `postgres:16` service | Neon Launch (pay-as-you-go, scale-to-zero optional) | **None.** Lakebase is another Postgres with worse auth. |
| **App API (E0)** | Neon Free (0.5 GB, 100 CU-hours) | Neon Launch | **None.** ADR-0010 already forbids Lakebase while the API is on Vercel. |
| **Batch analytics / traces / OSM joins** | **DuckDB files on the laptop** (unlimited within RAM/disk) | MotherDuck Lite overflow, or one Databricks serverless job run | Spark + Unity Catalog **only when data no longer fits DuckDB/Postgres**. |
| **Steward lakehouse UI** | — | Databricks App is **not** limited-cost (~$100–400/mo idle per ADR-0010) | Real, and too expensive for this constraint. |
| **App host (wear-time UI + E0 API)** | Vercel Hobby (non-commercial) | **Vercel Pro $20/mo** (required once the product is commercial) | None. |
| **Delivery blobs (PMTiles / worlds)** | Seed in `public/` + jsDelivr, or Cloudflare R2 (egress $0) | R2 still cheaper than Vercel Blob / Fast Data Transfer | None. |

**Databricks is not more capable than Docker for the factory.** It is more capable than Docker for *fleet-scale batch* — and that capability is almost entirely **off** on the free/limited budget.

**Vercel is not an alternative to Databricks or PostDB.** It is the one hosted source to keep. **R2** is the only extra vendor worth adding, and only when Vercel transfer would bill. See **Consolidated pick** above.

---

## 1. Databricks — two different “free” products

Official split: [Free trial vs Free Edition](https://docs.databricks.com/aws/en/getting-started/free-trial-vs-free-edition).

| | **Free Edition** | **Free trial (then PAYG)** |
|--|------------------|----------------------------|
| Cost | Forever $0, daily/fair-use quotas | Up to **$400 credits for 14 days**, then pay-as-you-go |
| Who | Students, hobby, learning | Organizations evaluating commercial use |
| Terms | **Non-commercial.** Databricks may train on your data. Personal email. | Commercial POCs allowed. Work email recommended. |
| Compute | Serverless only, small caps | Full platform during trial; personal-email trials cap serverless at **50 DBUs/hr** |
| After | Stays free, quotas | Card / Marketplace / commit, or stop running jobs |

Park Bound’s workspace (`dbc-e989baa1-6212`) is the **commercial trial / PAYG** path, not Free Edition. Do not move production factory data onto Free Edition.

### Free Edition — maximum capability (not for shipping)

Source: [Free Edition limitations](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations) (updated 2026-07-20).

**You get:** one serverless workspace; notebooks; 1 SQL warehouse (`2X-Small`); **5 concurrent job tasks**; 1 Lakeflow pipeline per type; **1 Lakebase project with scale-to-zero**; up to 3 Apps that **stop after 24 hours**; 1 AI Search unit.

**You do not get:** classic clusters; R/Scala; account console / account APIs; SSO/SCIM; private networking; SLAs; Marketplace provider status. Exceed quota → compute shut off for the rest of the day (or month); data kept.

**Pros:** real Spark/Delta/UC for learning; Lakebase to try Postgres-in-Databricks at $0.  
**Cons:** **illegal for a commercial app**; no SLA; outbound internet restricted unless LinkedIn-verified; Apps are toys (24h kill); Databricks may train on the data.

### Trial / PAYG — maximum capability on a tight budget

Trial credits: [Databricks free trial (GCP docs)](https://docs.databricks.com/gcp/en/getting-started/free-trial) — credits cover **Databricks usage only**. A *classic* workspace still bills the cloud account for VMs/GKE/storage. A **serverless** trial workspace uses Databricks-managed infra (no extra GCP project bill during trial).

After credits: serverless **jobs scale to zero**. Paused schedules ≈ **$0 compute**, which is the ADR-0010 posture. Each manual `databricks bundle run` spends DBUs.

Published serverless job list prices (third-party 2026 roundups of Databricks list SKUs; confirm in `system.billing.list_prices` before budgeting): roughly **$0.35–$0.45 / DBU** for serverless jobs (infra included). A 1 DBU-hour job is pocket change; an always-on SQL warehouse at ~$0.70/DBU is not “limited cost.”

ADR-0010’s own guardrail still holds: **App deployed = $100–400/mo** — outside this constraint. **Scheduled jobs, empty = ~$15–40/mo.**

**Pros at limited cost:** Unity Catalog, Delta time travel, Spark for huge joins, one nightly ingest that exports gold JSON the Node factory already consumes.  
**Cons:** OAuth/M2M friction; no value until there is volume; Model Serving and Apps blow the budget; Lakebase as PostDB adds JWT-as-password without Spark benefit.

### Lakebase specifically

- **Free Edition:** 1 project, scale-to-zero ([limitations](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations)). Non-commercial.  
- **Paid:** CU-hours in DBUs + storage DSUs. Azure docs: Lakebase autoscaling compute **0.213× DBU per CU-hour** ([Azure Databricks pricing SKUs](https://learn.microsoft.com/en-us/azure/databricks/resources/pricing)). Always-On is 25% off baseline if you disable scale-to-zero ([Databricks blog](https://www.databricks.com/blog/introducing-always-pricing-automatic-savings-databricks-lakebase)).  
- **Vs Neon:** same job (OLTP Postgres), worse DX for Vercel, no free commercial tier comparable to Neon’s permanent Free plan.

---

## 2. Docker Postgres — $0, commercial, factory-native

`docker compose up -d db` (this repo) and CI `postgres:16-alpine`.

| | |
|--|--|
| Cost | $0 (your machine / GitHub Actions service) |
| Max capability | Full PostgreSQL 16: JSONB, transactions, FKs, optional PostGIS. Bound by disk/RAM, not a vendor quota. |
| Pros | Exact PostDB engine; no OAuth; works offline; already wired in factory CI. |
| Cons | Not a shared cloud; laptop must be on; no multi-steward hosted URL unless you also run Neon. |
| Fits | **Factory author-time** (ticket 15–16). Does not replace the Vercel API database. |

For four flagship venues of JSON truth + display specs, this is past “enough” — it is the ceiling we need until blob bytes live in object storage, not in Postgres.

---

## 3. Neon Postgres — best hosted OLTP on free/limited cost

Source: [Neon plans](https://neon.com/docs/introduction/plans) (official).

**Free (permanent, not a trial):**

- $0/month, no card  
- 100 projects, 10 branches/project  
- **100 CU-hours / project / month**, autoscale to **2 CU (~8 GB RAM)**  
- Scale-to-zero after **5 minutes** (cannot disable on Free)  
- **0.5 GB storage / project**, **5 GB** public transfer / month  
- 6-hour restore window (1 GB change cap)  
- Hit CU or egress cap → compute **suspends until next month**; hit storage cap → writes that grow storage fail. Data is not deleted.

**Launch (limited cost, no monthly minimum):** $0.106/CU-hour, $0.35/GB-month, 500 GB egress included, autoscale to 16 CU, scale-to-zero **can be disabled**.

**Max at $0:** E0 API + a small PostDB (venue JSON revisions are well under 0.5 GB; **do not put PMTiles/world PNGs in Neon Free**). Cold starts after 5 min idle — fine for factory CLI, annoying for a latency-sensitive API.

**Max at tens of $/mo:** real production Postgres for API + PostDB, still cheaper and simpler than Lakebase.

---

## 4. Other warehouses at $0 / cheap (if the job is analytics, not OLTP)

### DuckDB local (files)

$0, commercial, no account. Max = laptop. Best **batch** engine for OSM/Overture/traces until they no longer fit memory. This is the honest $0 replacement for “we wanted Spark.”

### MotherDuck Lite

Source: [MotherDuck pricing](https://motherduck.com/docs/about-motherduck/billing/pricing/).

- $0 platform fee; **10 GB storage + 10 Pulse CU-hours / month**; 3 users / 2 service accounts; Pulse only; no SLA.  
- Extra Pulse: **$0.60/hour** (us-east-1); extra storage **$0.04/GB-month**.  
- 7-day Business trial, then Lite without a card.  
- Business jumps to **$250/mo** platform fee — outside “limited.”

**Pros vs Databricks Free Edition:** commercial use allowed; 10 GB is more storage than Neon Free; hybrid (local DuckDB + cloud share).  
**Cons:** 10 Pulse hours is a POC, not a nightly fleet job. Not Postgres; cannot be PostDB.

---

## 5. What “maximum capability” means on this budget

**At $0, commercial, for Park Bound:**

1. **Factory:** Docker Postgres (local + CI).  
2. **App API:** Neon Free.  
3. **Heavy batch:** DuckDB on the laptop (or GitHub Actions).  
4. **Databricks:** keep the existing PAYG workspace **idle** (paused jobs). Treat it as a parked capability. Do not use Free Edition for product data. Do not use Lakebase as PostDB.

That stack already exceeds four parks of JSON. The bottleneck is factory *software* (export, freshness), not warehouse horsepower.

**At limited cost (stay under App-deploy money):**

- Upgrade Neon to Launch when Free suspends or 0.5 GB fills.  
- Run Databricks **by hand** when there is a real ingest (contributions/traces). One serverless job, gold JSON out, Node consolidate in.  
- Still skip: Databricks App, always-on SQL warehouse, Model Serving, Lakebase-as-app-DB.

**When Databricks finally beats Docker/DuckDB:** hundreds of worlds, contribution/trace firehose, Unity Catalog audit of batch, Spark spatial joins that melt a laptop. That is not a free-tier problem; it is a volume trigger already listed in ADR-0010.

---

## 6. Cloudflare as an alternative

Cloudflare is not one product. Split it the same way as Databricks vs Docker: **which job?**

Official pricing: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Hyperdrive](https://developers.cloudflare.com/hyperdrive/platform/pricing/), [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/).

### Vs Databricks (batch / lakehouse)

**No.** Workers + R2 is not Spark. There is no Unity Catalog, no Delta jobs, no Foundation Models lakehouse.

Closest CF analogue: **R2 Data Catalog (Iceberg) + R2 SQL** — query Parquet in R2. Included: 10 GB scanned/month, then $0.0025/GB; catalog ops 1M/month free. Fine for small gold tables. Not a substitute for Databricks when traces/OSM no longer fit DuckDB.

**Workers AI:** 10,000 Neurons/day free ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)). Already the ADR-0017 image-gen path. Batch research at fleet scale still belongs on a laptop or a paid LLM, not Databricks Model Serving.

### Vs Docker/Neon (PostDB / E0 API)

**Do not replace Postgres with D1.** D1 is SQLite: 5 GB account storage on Free, 5M row-reads / 100k row-writes per day. No `pg`, no JSONB the factory already uses, no `DATABASE_URL` for Node `venues:*`. Factory CI would break.

**Hyperdrive** (Free: 100k queries/day; Paid: unlimited) is a **pool in front of existing Postgres** (Neon, Docker via Tunnel/VPC). It is how a Worker talks to PostDB — not a database.

**Durable Objects SQLite:** 5 GB total on Free; 10 GB *per object* on Paid. Actor model, not a factory bus.

### Vs Vercel origin / `public/venues` (Delivery)

**This is where Cloudflare wins on a free/limited budget** — and the repo already said so ([factory industry comparison](./2026-08-24-factory-industry-comparison.md) Q20: API manifest + R2).

| Piece | Free | Limited ($5 Workers Paid) |
|-------|------|---------------------------|
| **R2 blobs** (PMTiles, worlds, truth JSON) | 10 GB, 1M Class A, 10M Class B, **egress $0** | Same free allotment, then $0.015/GB-month; egress still $0 |
| **Workers** (manifest API) | **100,000 req/day**, 10 ms CPU | $5/mo: 10M req + 30M CPU-ms |
| **Static assets** on Workers | Free, unlimited | Same |
| **Containers** (run factory image) | **Not on Free** | Included allotment on Paid; sleep when idle |

Direct R2 / `r2.dev` / S3 API: **no egress fee**. Fronting R2 with a Worker burns the 100k/day Free cap — already flagged in the [API catalog](./2026-08-20-free-tier-api-catalog.md). Prefer public R2 or custom domain cache for guest GETs; Worker only for signed/head manifests.

Cloudflare **complements** Docker/Neon/Vercel. It does **not** replace Databricks until R2 SQL is enough (it is not, yet, for Spark-scale traces). It **does** beat Vercel Hobby/Pro bandwidth for large venue packs because R2 egress is free. Under **Consolidated pick**, that win is a later trigger — do not add R2 until Vercel transfer would bill.

---

## 7. Vercel as an alternative

Vercel is not one product either, and it is **already in the stack**: Next.js `apps/party-tracker` deploys here; E0 API routes run as Fluid Compute functions; seed bundles live under `public/venues/` and ride the same CDN ([ADR-0018](../adr/0018-factory-interaction-and-delivery.md), [ADR-0010](../adr/0010-databricks-ops-free-tier.md)).

Official: [Hobby](https://vercel.com/docs/plans/hobby), [Pro](https://vercel.com/docs/plans/pro-plan), [pricing](https://vercel.com/pricing), [Fair Use](https://vercel.com/docs/limits/fair-use-guidelines), [Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing). Repo cost sheet: [parkbound-account-pricing](./2026-08-14-parkbound-account-pricing.md).

### Vs Databricks (batch / lakehouse)

**No.** Functions are request/cron workers (Hobby **300s** max; Pro default 300s, configurable to 800s, beta 1800s). That is not Spark, Unity Catalog, or Delta. Vercel Sandbox/Workflows do not become a lakehouse. Keep Databricks parked at volume; keep DuckDB on the laptop until then.

Do **not** run `venues:build` / OSM consolidates on Vercel Functions or as the production build. Builds are for the app; the factory stays Docker + CI Postgres (`scripts/vercel-ignore.sh` already skips factory-only commits).

### Vs Docker/Neon (PostDB / E0 API)

**Vercel Postgres and Vercel KV are gone.** Storage is Marketplace: Neon Postgres + optional Upstash — already the ADR-0010 E0 choice. PostDB for the factory remains Docker locally / CI `postgres:16`; hosted PostDB = the same Neon, not a Vercel-native engine.

Cron or a Function can *call* `venues:export` against Neon. That is a trigger, not moving the factory onto Vercel.

### Vs Cloudflare R2 (Delivery) — this is the real comparison

ADR-0018 still ships seed packs with the app origin. Large PMTiles/worlds should **not** stay on that origin once guest traffic is real.

| | **Vercel origin / Blob** | **Cloudflare R2** |
|--|-------------------------|-------------------|
| Hobby storage | Blob **1 GB**; `public/` counts as Fast Data Transfer | **10 GB** |
| Transfer | Hobby FDT **100 GB/mo**; Blob transfer **10 GB/mo**. Pro FDT **1 TB** then ~**$0.15/GB**; Blob Data Transfer from **$0.05/GB** | **$0 egress** (all plans) |
| Cache | Blob cache max **512 MB** per object — larger PMTiles are a cache MISS + Fast Origin Transfer on every GET | No 512 MB CDN-cache cliff |
| Commercial | Hobby is **non-commercial only** ([Fair Use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)). Paid product → **Pro $20/mo** + $20 usage credit | R2 free tier is commercial-usable (account ToS) |
| Deploys | Hobby **100/day** (this repo already reserves 25 for the owner) | N/A for blob PUT |

**Keep Vercel** for the app UI, E0 API, and seed JSON. Do not add R2 or Blob until transfer would bill. Do not put the factory bus or Spark on Vercel.

Same operating model as **Consolidated pick** (top of this note).

---

## Sources

- Databricks Free vs trial: https://docs.databricks.com/aws/en/getting-started/free-trial-vs-free-edition  
- Free Edition limits: https://docs.databricks.com/aws/en/getting-started/free-edition-limitations  
- Trial credits / serverless vs classic billing: https://docs.databricks.com/gcp/en/getting-started/free-trial  
- Lakebase DBU multiplier: https://learn.microsoft.com/en-us/azure/databricks/resources/pricing  
- Lakebase Always-On: https://www.databricks.com/blog/introducing-always-pricing-automatic-savings-databricks-lakebase  
- Neon plans: https://neon.com/docs/introduction/plans  
- MotherDuck pricing: https://motherduck.com/docs/about-motherduck/billing/pricing/  
- Cloudflare Workers pricing / limits: https://developers.cloudflare.com/workers/platform/pricing/ , https://developers.cloudflare.com/workers/platform/limits/  
- Cloudflare R2 pricing (free egress): https://developers.cloudflare.com/r2/pricing/  
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/  
- Cloudflare Hyperdrive pricing: https://developers.cloudflare.com/hyperdrive/platform/pricing/  
- Vercel Hobby / Pro / pricing: https://vercel.com/docs/plans/hobby , https://vercel.com/docs/plans/pro-plan , https://vercel.com/pricing  
- Vercel Fair Use (Hobby non-commercial): https://vercel.com/docs/limits/fair-use-guidelines  
- Vercel Blob pricing (512 MB cache, BDT): https://vercel.com/docs/vercel-blob/usage-and-pricing  
- Repo cost lock: [ADR-0010](../adr/0010-databricks-ops-free-tier.md) , [parkbound-account-pricing](./2026-08-14-parkbound-account-pricing.md)
