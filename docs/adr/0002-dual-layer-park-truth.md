# Dual-layer park truth without PostGIS

Near-term park truth is **batch consolidate**, not PostGIS: signed-in contributions land in plain Postgres and client overlays, then a daily/weekly consolidate job writes durable fixes into builder inputs (`data/venues/*`) and rebuilds `public/venues/*.json` — the sole offline map contract. Ephemeral ops (ride down, queue bands) never bake into venue JSON. PostGIS stays optional later if spatial admin outgrows this path.

Expanded write-up: `docs/superpowers/specs/adr-dual-layer-park-truth.md`.
