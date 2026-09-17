#!/usr/bin/env node
/**
 * Databricks workspace checklist — full MVP path (beyond free tier).
 * Pre-launch $0 path: npm run databricks:free-setup
 * Decisions: docs/adr/0010a-databricks-ops-free-tier.md
 */

const steps = `
Parkbound Databricks — full MVP (after free tier)

0. Read first (do not relitigate)
   docs/adr/0010a-databricks-ops-free-tier.md
   docs/guide/databricks-decisions.md

1. Free tier (default pre-launch)
   npm run databricks:free-setup

--- When you have durable Postgres + real data ---

2. Vercel Marketplace
   Neon Postgres (free → paid) + optional Upstash Redis

3. Enable job schedules (one at a time) in databricks/databricks.yml dev target
   Remove pause_status: PAUSED per job, redeploy bundle

4. Secrets (workspace secret scope "parkbound")
   DATABASE_URL, GUEST_TRACES_TOKEN, PARKBOUND_API_BASE

5. Optional: Databricks App (steward UI / Lakebase)
   See databricks/apps/README.md — only after ADR-0010a trigger

6. CI (GitHub secrets)
   DATABRICKS_HOST, DATABRICKS_TOKEN (service principal)

Docs: docs/guide/databricks.md
ADR:   docs/adr/0008a-databricks-back-office.md
       docs/adr/0010a-databricks-ops-free-tier.md
`;

console.log(steps.trim());
