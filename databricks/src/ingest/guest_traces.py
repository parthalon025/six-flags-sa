#!/usr/bin/env python3
"""Fetch guest traces from Parkbound API into Delta bronze/silver."""

from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from common import ensure_schemas, parse_args, utc_now_iso


def fetch_geojson(base: str, venue_id: str, token: str) -> dict:
    url = f"{base.rstrip('/')}/api/contributions/traces?venueId={venue_id}&format=geojson"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> None:
    args = parse_args({
        "--app-base": {"default": os.environ.get("PARKBOUND_API_BASE", "")},
        "--venue": {"default": "kings-island"},
    })
    token = os.environ.get("GUEST_TRACES_TOKEN") or os.environ.get("METRICS_TOKEN")
    if not args.app_base or not token:
        raise RuntimeError("PARKBOUND_API_BASE and GUEST_TRACES_TOKEN required")

    from pyspark.sql import SparkSession
    from pyspark.sql import functions as F
    from pyspark.sql.types import DoubleType, StringType, StructField, StructType

    spark = SparkSession.builder.appName("parkbound-ingest-guest-traces").getOrCreate()
    ensure_schemas(spark, args.catalog)

    collection = fetch_geojson(args.app_base, args.venue, token)
    ingested_at = utc_now_iso()
    rows = []
    for feature in collection.get("features") or []:
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        props = feature.get("properties") or {}
        if geom.get("type") != "LineString" or len(coords) < 2:
            continue
        mid = coords[len(coords) // 2]
        rows.append(
            {
                "venue_id": args.venue,
                "session_id": props.get("sessionId"),
                "source": props.get("source") or "parkbound_guest_movement",
                "metres": props.get("metres"),
                "mid_lng": mid[0],
                "mid_lat": mid[1],
                "line_json": json.dumps(coords),
                "_ingested_at": ingested_at,
            }
        )

    schema = StructType(
        [
            StructField("venue_id", StringType()),
            StructField("session_id", StringType()),
            StructField("source", StringType()),
            StructField("metres", DoubleType()),
            StructField("mid_lng", DoubleType()),
            StructField("mid_lat", DoubleType()),
            StructField("line_json", StringType()),
            StructField("_ingested_at", StringType()),
        ]
    )
    df = spark.createDataFrame(rows, schema=schema)
    df.write.format("delta").mode("append").saveAsTable(
        f"{args.catalog}.bronze.guest_traces_raw"
    )
    df.write.format("delta").mode("overwrite").saveAsTable(
        f"{args.catalog}.silver.guest_trace_segments"
    )


if __name__ == "__main__":
    main()
