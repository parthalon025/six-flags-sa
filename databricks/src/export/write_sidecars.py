#!/usr/bin/env python3
"""Write gold Delta exports to JSON sidecars for the Node venue builder."""

from __future__ import annotations

import json
import os
import sys

from common import parse_args


def main() -> None:
    args = parse_args({
        "--kind": {"required": True, "choices": ["consolidate_queue", "guest_traces", "llm_cache"]},
        "--venue": {"default": "kings-island"},
        "--out-dir": {"default": os.environ.get("PARKBOUND_EXPORT_DIR", "data/consolidate")},
    })
    from pyspark.sql import SparkSession
    from pyspark.sql import functions as F

    spark = SparkSession.builder.appName("parkbound-write-sidecars").getOrCreate()
    os.makedirs(args.out_dir, exist_ok=True)

    if args.kind == "consolidate_queue":
        table = f"{args.catalog}.gold.consolidate_queue"

        row = spark.table(table).orderBy(F.desc("exported_at")).limit(1).collect()
        if not row:
            print("No consolidate_queue rows")
            return
        payload = json.loads(row[0].payload_json)
        out = os.path.join(args.out_dir, "queue.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        print(f"Wrote {out}")

    elif args.kind == "guest_traces":
        table = f"{args.catalog}.gold.guest_trace_candidates"
        rows = spark.table(table).filter(f"venue_id = '{args.venue}'").collect()
        if not rows:
            print("No guest trace candidates")
            return
        payload = json.loads(rows[0].payload_json)
        sidecar_dir = os.environ.get(
            "PARKBOUND_VENUE_DATA",
            os.path.join("packages", "venue-builder", "data", "venues", args.venue),
        )
        os.makedirs(sidecar_dir, exist_ok=True)
        out = os.path.join(sidecar_dir, "guest-traces-cache.json")
        sidecar = {
            "fetched": payload["exported_at"][:10],
            "collection": payload["collection"],
            "candidates": payload["collection"],
        }
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(sidecar, fh, indent=2)
        print(f"Wrote {out}")

    elif args.kind == "llm_cache":
        table = f"{args.catalog}.gold.llm_cache"
        rows = (
            spark.table(table)
            .filter(f"venue_id = '{args.venue}'")
            .orderBy(F.desc("created_at"))
            .limit(1)
            .collect()
        )
        if not rows:
            print("No llm cache rows")
            return
        payload = json.loads(rows[0].response_json)
        sidecar_dir = os.environ.get(
            "PARKBOUND_VENUE_DATA",
            os.path.join("packages", "venue-builder", "data", "venues", args.venue),
        )
        os.makedirs(sidecar_dir, exist_ok=True)
        out = os.path.join(sidecar_dir, "llm-research-cache.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)
        print(f"Wrote {out}")


if __name__ == "__main__":
    main()
