#!/usr/bin/env python3
"""
Cluster guest trace midpoints far from known paths (builder guest-traces adapter parity).
Pure-Python clustering for pytest; Spark job uses same core logic on collected rows.
"""

from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from common import ensure_schemas, parse_args, utc_now_iso


def dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    kx = 111320 * math.cos(math.radians(lat1))
    return math.hypot((lng2 - lng1) * kx, (lat2 - lat1) * 110540)


def dist_to_paths(lat: float, lng: float, path_coords: list[list[list[float]]]) -> float:
    best = float("inf")
    for line in path_coords:
        for c in line:
            d = dist_m(lat, lng, c[1], c[0])
            if d < best:
                best = d
    return best


def grid_key(lat: float, lng: float, cell_m: float = 15.0) -> tuple[int, int]:
    return (int(lat * 110540 / cell_m), int(lng * 111320 / cell_m))


def cluster_segments(segments: list[dict], path_coords: list, gap_m: float = 12.0) -> list[dict]:
    """Group midpoints with gap >= gap_m into grid cells; rank by session count."""
    buckets: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for seg in segments:
        lat, lng = seg["mid_lat"], seg["mid_lng"]
        gap = dist_to_paths(lat, lng, path_coords) if path_coords else float("inf")
        if gap < gap_m:
            continue
        buckets[grid_key(lat, lng)].append({**seg, "gapM": round(gap)})

    ranked = []
    for cell, items in buckets.items():
        sessions = {i.get("session_id") for i in items if i.get("session_id")}
        sample = items[0]
        coords = json.loads(sample["line_json"])
        ranked.append(
            {
                "cell": cell,
                "session_count": len(sessions) or len(items),
                "gapM": sample["gapM"],
                "coordinates": coords,
                "sessionId": sample.get("session_id"),
                "metres": sample.get("metres"),
            }
        )
    ranked.sort(key=lambda r: (-r["session_count"], -r.get("metres") or 0))
    return ranked


def to_geojson(candidates: list[dict], gap_m: float) -> dict:
    features = []
    for c in candidates:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "guest_walkway_candidate",
                    "source": "guest_trace",
                    "gapM": c["gapM"],
                    "sessionId": c.get("sessionId"),
                    "metres": c.get("metres"),
                    "sessionCount": c["session_count"],
                    "note": "Guest walks here; no nearby path in the current venue graph. Review before promoting.",
                },
                "geometry": {"type": "LineString", "coordinates": c["coordinates"]},
            }
        )
    return {
        "type": "FeatureCollection",
        "properties": {
            "source": "parkbound_guest_movement",
            "candidateCount": len(features),
            "gapM": gap_m,
        },
        "features": features,
    }


def main() -> None:
    args = parse_args({
        "--venue": {"default": "kings-island"},
        "--gap-m": {"type": float, "default": 12.0},
        "--paths-json": {"default": ""},
    })
    from pyspark.sql import SparkSession

    spark = SparkSession.builder.appName("parkbound-guest-trace-cluster").getOrCreate()
    ensure_schemas(spark, args.catalog)

    silver = f"{args.catalog}.silver.guest_trace_segments"
    segments = []
    if spark.catalog.tableExists(silver):
        for row in spark.table(silver).filter(f"venue_id = '{args.venue}'").collect():
            segments.append(row.asDict())

    path_coords = []
    if args.paths_json and os.path.isfile(args.paths_json):
        with open(args.paths_json, encoding="utf-8") as fh:
            data = json.load(fh)
            for f in data.get("features") or []:
                g = f.get("geometry") or {}
                if g.get("type") == "LineString":
                    path_coords.append(g.get("coordinates") or [])
                elif g.get("type") == "MultiLineString":
                    path_coords.extend(g.get("coordinates") or [])

    candidates = cluster_segments(segments, path_coords, gap_m=args.gap_m)
    collection = to_geojson(candidates, args.gap_m)
    payload = {
        "venue_id": args.venue,
        "exported_at": utc_now_iso(),
        "collection": collection,
        "candidates": collection,
        "candidate_count": len(candidates),
    }

    gold_df = spark.createDataFrame(
        [
            {
                "venue_id": args.venue,
                "exported_at": payload["exported_at"],
                "payload_json": json.dumps(payload),
                "candidate_count": payload["candidate_count"],
            }
        ]
    )
    gold_df.write.format("delta").mode("overwrite").option(
        "replaceWhere", f"venue_id = '{args.venue}'"
    ).saveAsTable(f"{args.catalog}.gold.guest_trace_candidates")


if __name__ == "__main__":
    main()
