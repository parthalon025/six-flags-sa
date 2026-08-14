"""Tests for Databricks transform logic (no Spark required)."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "transform"))

from guest_trace_cluster import cluster_segments, to_geojson  # noqa: E402


def test_cluster_segments_flags_gap():
    segments = [
        {
            "session_id": "a",
            "mid_lat": 39.342,
            "mid_lng": -84.268,
            "line_json": json.dumps([[-84.27, 39.34], [-84.268, 39.342]]),
            "metres": 100,
        }
    ]
    # Path far from midpoint (~>12m)
    path_coords = [[[-84.28, 39.33], [-84.275, 39.335]]]
    ranked = cluster_segments(segments, path_coords, gap_m=12.0)
    assert len(ranked) == 1
    assert ranked[0]["session_count"] >= 1
    geo = to_geojson(ranked, 12.0)
    assert geo["properties"]["candidateCount"] == 1
    assert geo["features"][0]["properties"]["kind"] == "guest_walkway_candidate"


def test_cluster_skips_near_path():
    segments = [
        {
            "session_id": "a",
            "mid_lat": 39.33,
            "mid_lng": -84.28,
            "line_json": json.dumps([[-84.28, 39.33], [-84.275, 39.335]]),
            "metres": 50,
        }
    ]
    path_coords = [[[-84.28, 39.33], [-84.275, 39.335]]]
    ranked = cluster_segments(segments, path_coords, gap_m=12.0)
    assert ranked == []
