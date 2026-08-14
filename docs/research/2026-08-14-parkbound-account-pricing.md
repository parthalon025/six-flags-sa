# ParkBound account pricing — cost stack & unit economics

**Date researched:** 2026-08-14  
**Product:** ParkBound (Park Bound: Explore) — PWA / mobile park exploration app  
**Stack in scope:** Next.js on Vercel, Clerk auth, Apple App Store + Google Play  
**Status:** Research complete — primary sources preferred; estimates labeled.

---

## Executive summary

**Decision (2026-08-14):** **Free to download.** **$10.00 / year for a Profile** (guest map / Party-by-name remain free).

Optional later: trip pass **$4.99** or climb to **$19.99–$29.99 / year** when planner/wait value matches comps.

**Why Free + $10 Profile / yr**

1. Owner packaging: download Free; paid unlock is **Profile** at **$10/year**. Cost does **not** require monthly ARPU — baseline fixed is ~**$28–$31/mo**; store take (~15% with Small Business Program) is the main variable.
2. Comps sit higher annually (TouringPlans ~$25, Standby $14.99, MagicDay $19.99, MouseWait $29.99). **$10/yr** undercuts that band as a goodwill Profile price.
3. After 15% store cut: **$8.50** net / year → ~**43** annual Profiles cover ~$360/yr fixed.
4. Maps are baked OSM JSON today → **~$0** map OPEX per user until tile APIs are adopted.

**Caveat:** iOS App Review generally requires digital-feature subscriptions sold *in* the app to use Apple IAP (store take rate applies). Web/Clerk Billing + Stripe can be cheaper on take rate but has product/policy constraints for store-distributed clients.

---

## Fixed costs

Prices as published on cited pages on **2026-08-14** unless noted. Monthly = annual ÷ 12 where the vendor bills yearly.

| Cost item | Cadence | Amount (USD) | Monthly equiv. | Notes | Source |
|-----------|---------|--------------|----------------|-------|--------|
| **Vercel Pro** (required for commercial / paid product) | Monthly | $20 / deploying seat | $20.00 | Includes **$20 usage credit**/mo; Hobby is **non-commercial only** | [Vercel Pricing](https://vercel.com/pricing), [Fair Use — commercial](https://vercel.com/docs/limits/fair-use-guidelines), [Pro plan](https://vercel.com/docs/plans/pro-plan) |
| Vercel Fast Data Transfer (included) | Included in Pro | First **1 TB**/mo | — | Overage from **~$0.15/GB** (regional) | [Vercel Pricing](https://vercel.com/pricing), [docs/limits](https://vercel.com/docs/limits) |
| Vercel Edge Requests (included) | Included in Pro | First **10M**/mo | — | Overage from **~$2 per 1M** | [Vercel Pricing](https://vercel.com/pricing) |
| Vercel Web Analytics Plus (optional) | Monthly | $10 | $10.00 | Optional | [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) |
| Vercel Speed Insights (optional) | Monthly / project | $10 | $10.00 | Optional | [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan) |
| **Clerk Hobby** | Free | $0 | $0.00 | **50,000 MRU**/app limit; no MFA / branding removal | [Clerk Pricing](https://clerk.com/pricing) (fetched 2026-08-14) |
| **Clerk Pro** (optional production features) | Monthly / Annual | $25 / $20 billed annually | $25.00 or $20.00 | Same 50k MRU included; MFA, remove branding, etc. | [Clerk Pricing](https://clerk.com/pricing) |
| **Apple Developer Program** | Annual | **$99**/membership year | $8.25 | Required to distribute on App Store | [Apple — Choosing a Membership](https://developer.apple.com/support/compare-memberships/) |
| **Google Play Console** | One-time | **$25** registration | $2.08 in year 1; $0 after | Not a recurring fee | [Play Console Help — Get started](https://support.google.com/googleplay/android-developer/answer/6112435) |
| Domain (`.com` at-cost, **estimated**) | Annual | ~**$10–$12** | ~$0.90 | Cloudflare Registrar at registry cost; exact TLD varies | [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/) — list price not fixed on marketing page; **estimate** from wholesale practice |
| Domain (`.ai`, **estimated**) | Annual | ~**$80–$83**/yr (often multi-year min.) | ~$6.90 | ParkBound currently on subdomain `parkbound.kurat0r.ai` — **incremental domain may be $0** if parent already paid | Cloudflare `.ai` product page (no fixed $ on page); secondary estimates ~$80–$83 — **label: estimate** |
| DNS / CDN / SSL (Cloudflare Free) | Free | $0 | $0.00 | Standard for this stack | [Cloudflare Registrar overview](https://developers.cloudflare.com/registrar/) |
| Transactional email (Resend Free) | Free | $0 | $0.00 | **3,000 emails/mo**, 100/day cap | [Resend Pricing](https://resend.com/pricing) |
| Resend Pro (optional) | Monthly | from $20 | $20.00 | 50k emails | [Resend Pricing](https://resend.com/pricing) |
| Map / tile APIs (ParkBound current architecture) | — | **$0** | $0.00 | Map drawn from **baked OSM venue JSON**, not hosted tile MAUs | App copy / venue pipeline (`OpenStreetMap` in app + `manifest.json` credits) |
| Monitoring (baseline) | Free tiers | $0 | $0.00 | Vercel Observability base; paid Observability Plus optional | [Vercel Pricing](https://vercel.com/pricing) |

### Baseline fixed stack (recommended for pricing model)

Assumes: **Vercel Pro**, **Clerk Hobby** (under 50k MRU), Apple + Play enrollment, Cloudflare DNS, Resend Free, no optional analytics packs, no separate `.ai` renew if using existing subdomain.

| | Annual | Monthly |
|--|--------|---------|
| Vercel Pro | $240 | $20.00 |
| Apple Developer | $99 | $8.25 |
| Google Play (year 1 only) | $25 | $2.08 |
| Domain / DNS / email / maps (baseline) | $0–$12 | $0–$1 |
| **Total year 1** | **~$364–$376** | **~$30–$31** |
| **Total year 2+** (no Play fee) | **~$339–$351** | **~$28–$29** |

**With Clerk Pro (monthly billing):** add **+$25/mo** (+$300/yr) → ~**$55–$56/mo** year 1.

---

## Variable costs

### Per authenticated retained user (Clerk)

Clerk bills **Monthly Retained Users (MRU)** — a user who visits again **at least one day after signup** — not classic MAU.

| Band | Price | Source |
|------|-------|--------|
| First 50,000 MRU / app | **Included** (Hobby limit / Pro included) | [Clerk Pricing](https://clerk.com/pricing) |
| 50,001 – 100,000 | **$0.02** / MRU / mo | same |
| 100,001 – 1,000,000 | **$0.018** / MRU / mo | same |
| 1,000,001 – 10,000,000 | **$0.015** / MRU / mo | same |
| 10,000,001+ | **$0.012** / MRU / mo | same |

**Implication for early ParkBound:** variable auth cost ≈ **$0 / paid user** until ~50k retained users. Above that, Pro is required and overage starts at **$0.02/MRU**.

SMS auth (if enabled on Pro): US/Canada **$0.01/SMS** ([Clerk Pricing](https://clerk.com/pricing)).

Clerk Billing add-on (if used instead of / in addition to store IAP): **0.7% of billing volume** on top of Stripe ([Clerk Pricing](https://clerk.com/pricing)).

### Store / payment take rates (per paid subscriber)

| Channel | Rate on digital IAP / sub | Net keep (pre-tax) | Applies when | Source |
|---------|--------------------------|--------------------|--------------|--------|
| **Apple — standard** | **30%** year 1 of a subscriber’s paid service; **15%** after 1 year paid | 70% → 85% | Auto-renewable subs | [Apple Subscriptions](https://developer.apple.com/app-store/subscriptions/) |
| **Apple — Small Business Program** | **15%** from day one (≤$1M prior-year proceeds) | **85%** | Enroll in SBP | [App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/), [Subscriptions](https://developer.apple.com/app-store/subscriptions/) |
| **Google Play — US/UK/EEA from 2026-06-30** | Recurring: **10% service** + **5% billing** if using Google Play Billing = **15%** on first **$1M** annual earnings | **85%** | New fee model | [Play Console — lower service fees](https://support.google.com/googleplay/android-developer/answer/16954621) |
| **Google Play — above $1M** (recurring) | Still **10% service** + **5% billing** if GPB (per published recurring column) | **85%** | Same doc | same |
| **Stripe (web checkout)** | **2.9% + $0.30** per successful card charge (US online, standard) | ~97% minus fixed $0.30 | Web / Clerk Billing | [Stripe Pricing](https://stripe.com/pricing) |

**Modeling assumption used below:** **15% platform commission** (Apple SBP and/or Google Play first-$1M recurring + GPB). Taxes remitted by the stores are **not** modeled.

### Per paid user — net proceeds at candidate list prices

| List price | Gross / mo | After 15% store | Effective COGS (auth+maps) early stage | Contribution margin / mo |
|------------|------------|-----------------|----------------------------------------|--------------------------|
| $2.99 | $2.99 | **$2.54** | ~$0 | **~$2.54** |
| $4.99 | $4.99 | **$4.24** | ~$0 | **~$4.24** |
| $9.99 | $9.99 | **$8.49** | ~$0 | **~$8.49** |

Annual SKUs (gross → net @ 15%):

| List price / yr | Net / yr | Net / mo equivalent |
|-----------------|----------|---------------------|
| $4.99 | $4.24 | $0.35 |
| **$10.00** | **$8.50** | **$0.71** |
| $19.99 | $16.99 | $1.42 |
| $29.99 | $25.49 | $2.12 |
| $39.99 | $33.99 | $2.83 |
| $49.99 | $42.49 | $3.54 |

### Other variable / semi-variable (usually $0 early)

| Item | Rate | When it bites | Source |
|------|------|---------------|--------|
| Vercel Function Invocations | $0.60 / 1M | After Pro credit exhausted | [Vercel docs/limits](https://vercel.com/docs/limits) |
| Vercel Active CPU | from ~$0.128 / hr (e.g. iad1/pdx1) | Heavy serverless | [Vercel Functions pricing](https://vercel.com/docs/functions/usage-and-pricing) |
| Mapbox Maps (if ever adopted) | Free tier then usage; **not used today** | Only if switching off baked OSM | [Mapbox Pricing](https://www.mapbox.com/pricing) |
| Bandwidth overage | from ~$0.15/GB after 1 TB | Viral traffic / large assets | [Vercel Pricing](https://vercel.com/pricing) |

---

## Competitor price comps

Official App Store / product pages (US unless noted). Fetched or cited **2026-08-14**.

| Product | Model | Price points | Overlap with ParkBound | Source |
|---------|-------|--------------|----------------------|--------|
| **TouringPlans / LINES** | Annual web + IAP | **$24.97/yr** WDW tools (site); App Store **One Year Subscription $24.99** | Wait times, crowd calendar, touring plans (Disney-heavy) | [touringplans.com](https://touringplans.com/), [App Store — Disney World Lines (TP)](https://apps.apple.com/us/app/disney-world-lines-tp/id411091283); historical add-ons $9.97–$11.97/yr per resort ([price increase post](https://touringplans.com/blog/upcoming-touringplans-subscription-price-increase-2/)) |
| **MagicDay** | Monthly / annual / lifetime | **$4.99/mo**, **$19.99/yr**, **$39.99 lifetime** (US listing) | Disney wait times + AI day planner | [App Store — MagicDay](https://apps.apple.com/us/app/magic-day-disney-companion/id6761439427) |
| **Standby** | Trip / annual / lifetime | **Trip $4.99**, **Annual $14.99**, **Lifetime $49.99**, Friends & Family $59.99 | Wait alerts, multi-park | [App Store — Standby](https://apps.apple.com/us/app/standby-theme-park-wait-times/id6756681606) |
| **Ride Ready** | Day / week / month / trip | **Day $7.99**, **Week $14.99**, **Premium $19.99/mo**, Trip $19.99–$24.99 | Wait forecasts + day plans (includes Six Flags parks) | [App Store — Ride Ready](https://apps.apple.com/us/app/ride-ready-theme-park-waits/id6748330847) |
| **Park Queue Times Plus** | Annual (paused new signups) | **£29.99/yr** (~£2.50/mo advertised) | Crowd forecasts, alerts (EU-heavy) | [parkqueuetimes.com/plus](https://parkqueuetimes.com/plus) |
| **MouseWait** (park-specific apps) | Weekly / yearly ALL-ACCESS | e.g. **$4.99/wk** or **$29.99/yr** (Knott’s / Dollywood listings) | Wait times + AI chat | [App Store — MouseWait Knott’s](https://apps.apple.com/us/app/mousewait-knotts-berry-farm/id6602888158) |

**Market read:** Successful park companions usually ship a **free core** (live waits / basic map) and monetize **planning, alerts, offline, or AI**. Annual SKUs often land in the **$15–$30** band; pure monthly passholder SKUs can be higher ($19.99 Ride Ready). Day/trip passes ($4.99–$7.99) capture one-visit tourists.

ParkBound’s differentiation (party co-location, OSM exploration map, collaborative cosmetics) is closer to a **season / account** product than a single-day wait sniper — favoring **annual + monthly**, with optional **trip pass** later.

---

## Recommended ParkBound account price + sensitivity

### Decision

| SKU | Price | Why |
|-----|-------|-----|
| **Download** | **Free** | App Store price stays Free |
| **Primary (decided)** | **Profile — $10.00 / year** | Sign-in, synced progress, Managed Guests; ~**43** payers cover ~$360 fixed @ 15% store |
| **Market climb (later)** | **$19.99–$29.99 / year** | When planner/alerts match MagicDay / TouringPlans / MouseWait value |
| **Optional** | Trip pass **$4.99–$7.99** | Standby / Ride Ready tourist pattern — only if trip entitlement is clear |
| **Free without Profile** | Map explore + Party by name | Guest path; no Profile required |

Do **not** lead with **$4.99/mo** unless passholders need month-to-month and paid entitlements clearly beat free.

**App Store Small Business Program:** enrollment **submitted 2026-08-14** (team `CDHJC4MH4G`). Await Apple status email. 15% rate starts 15 days after the end of the fiscal month of approval. Paid Apps Agreement was **Processing** at submit time (W-9 Active; banking processing ~24h).

### Break-even paid users (contribution ≈ net after 15% store; auth/maps ≈ $0)

Fixed cost scenarios:

| Scenario | Fixed / mo | Description |
|----------|------------|-------------|
| A | **$30** | Baseline year 1 (Vercel Pro + Apple + amortized Play) |
| B | **$28** | Year 2+ baseline |
| C | **$55** | Baseline + Clerk Pro ($25/mo) |
| D | **$75** | C + Resend Pro + Web Analytics Plus (**illustrative**, optional) |

Break-even paid users = `ceil(fixed_monthly / net_per_user)`.

| Price | Net @ 15% | BE @ $30 (A) | BE @ $28 (B) | BE @ $55 (C) | BE @ $75 (D) |
|-------|-----------|--------------|--------------|--------------|--------------|
| **$2.99/mo** | $2.54 | **12** | **12** | **22** | **30** |
| **$4.99/mo** | $4.24 | **8** | **7** | **13** | **18** |
| **$9.99/mo** | $8.49 | **4** | **4** | **7** | **9** |

**Annual-only** subscribers (if all pay annually, no monthly):

| Annual price | Net @ 15% / yr | BE @ $360/yr fixed (~$30/mo) | BE @ $660/yr (~Clerk Pro) |
|--------------|----------------|------------------------------|---------------------------|
| $4.99 | $4.24 | **85** | **156** |
| **$10.00** | **$8.50** | **43** | **78** |
| $19.99 | $16.99 | **22** | **39** |
| $29.99 | $25.49 | **15** | **26** |
| $39.99 | $33.99 | **11** | **20** |

### Sensitivity notes

1. **Mix of free vs paid MRU:** 1,000 free Clerk users cost $0 until 50k MRU. Monetization pressure is **willingness-to-pay**, not Clerk.
2. **If Apple is not on Small Business Program:** year-1 subscribers yield **70%** keep → $4.99 → **$3.49** net → BE at $30 fixed rises to **~9** users (still small).
3. **Web Stripe path:** $4.99 → fee ≈ $0.44 → net ≈ **$4.55** (better than stores), but store clients may still need IAP for digital unlocks.
4. **Seasonality:** Many users buy for a trip then churn. Prefer **annual** or **trip** SKUs so ARPU survives low off-season months.
5. **Scale cliff:** Crossing **50k Clerk MRU** adds Pro ($25) + $0.02/MRU. At 60k MRU: ~$25 + $200 = **$225/mo** auth — still fine if even a few thousand are paid at $4.99.

### Worked example — 100 paying monthly @ $4.99

- Gross: $499/mo  
- Store 15%: −$74.85 → **$424.15** net  
- Fixed A ($30): **~$394** contribution  
- Annual run-rate contribution: **~$4.7k** (ignoring churn, taxes, refunds)

---

## Architecture notes affecting cost

1. **Commercial Vercel is non-negotiable** once accounts are paid or the product is commercial ([Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)).
2. **ParkBound map cost is CAPEX/build-time (venue builder), not OPEX per pan/zoom** — unlike Mapbox (~50k free map loads then usage — [Mapbox Pricing](https://www.mapbox.com/pricing)). Changing to live commercial tiles would add a real per-MAU line item.
3. **Clerk MRU vs MAU:** one-day triers do not inflate the bill ([Clerk Pricing FAQ](https://clerk.com/pricing)).
4. **Google Play fee reform (2026-06-30 US/UK/EEA):** recurring digital goods at **10% + 5% GPB** on the first $1M is more favorable than the historical 30%/15% story; confirm region rollout before modeling ROW ([Play Help](https://support.google.com/googleplay/android-developer/answer/16954621)).

---

## Sources (every claim)

| Claim | URL |
|-------|-----|
| Vercel Hobby $0 / Pro $20; bandwidth & edge request inclusions | https://vercel.com/pricing |
| Vercel Hobby non-commercial; Pro required for commercial | https://vercel.com/docs/limits/fair-use-guidelines |
| Vercel Pro $20 credit, add-ons (Analytics Plus $10, Speed Insights $10) | https://vercel.com/docs/plans/pro-plan |
| Vercel overage table (transfer, invocations, CPU) | https://vercel.com/docs/limits |
| Vercel Fluid Compute regional CPU/memory | https://vercel.com/docs/functions/usage-and-pricing |
| Clerk plans, MRU definition, overage tiers, Billing 0.7% | https://clerk.com/pricing |
| Clerk 50k MRU / plan restructure (2026-02-05) | https://clerk.com/changelog/2026-02-05-new-plans-more-value |
| Apple Developer Program $99/yr | https://developer.apple.com/support/compare-memberships/ |
| Apple Small Business Program 15% | https://developer.apple.com/app-store/small-business-program/ |
| Apple subscription proceeds 70%/85%; SBP 85% always | https://developer.apple.com/app-store/subscriptions/ |
| Google Play $25 one-time registration | https://support.google.com/googleplay/android-developer/answer/6112435 |
| Google Play service + billing fees (2026 model) | https://support.google.com/googleplay/android-developer/answer/16954621 |
| Stripe standard online card pricing | https://stripe.com/pricing |
| Resend Free 3k emails / Pro from $20 | https://resend.com/pricing |
| Cloudflare Registrar at-cost | https://www.cloudflare.com/products/registrar/ , https://developers.cloudflare.com/registrar/ |
| Mapbox pricing (reference only; not current ParkBound path) | https://www.mapbox.com/pricing |
| TouringPlans $24.97/yr WDW | https://touringplans.com/ |
| LINES App Store $24.99/yr | https://apps.apple.com/us/app/disney-world-lines-tp/id411091283 |
| MagicDay IAP prices | https://apps.apple.com/us/app/magic-day-disney-companion/id6761439427 |
| Standby IAP prices | https://apps.apple.com/us/app/standby-theme-park-wait-times/id6756681606 |
| Ride Ready IAP prices | https://apps.apple.com/us/app/ride-ready-theme-park-waits/id6748330847 |
| Park Queue Times Plus £29.99/yr | https://parkqueuetimes.com/plus |
| MouseWait Knott’s $4.99 / $29.99 | https://apps.apple.com/us/app/mousewait-knotts-berry-farm/id6602888158 |
| TouringPlans historical multi-resort add-on prices | https://touringplans.com/blog/upcoming-touringplans-subscription-price-increase-2/ |

**Labeled estimates (not fixed on primary page):** `.com` / `.ai` renewal dollars; optional monitoring pack totals in scenario D; FX for £29.99 → USD.

---

## Suggested next product decisions (out of scope for this brief)

- App Store Small Business Program — **submitted 2026-08-14**; await approval email.
- Choose **IAP-only vs web Stripe vs Clerk Billing** with App Review Guidelines in mind.
- Create ASC subscription product `parkbound_profile_annual` (**Profile**, **$10.00/yr**) once Paid Apps Agreement is **Active**.
- Define Profile entitlements (synced progress, Managed Guests, multi-device) so **$10/yr** is defensible vs free guest explore.
- Revisit pricing if live wait-time APIs or commercial map tiles are added (new variable COGS).
