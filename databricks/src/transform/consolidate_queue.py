#!/usr/bin/env python3
"""Build gold consolidate queue from silver accepted contributions."""

from __future__ import annotations

import json
import os
import sys
import uuid

from common import ensure_schemas, parse_args, utc_now_iso


def row_to_contribution(row) -> dict:
    payload = row.payload
    if isinstance(payload, str):
        payload = json.loads(payload)
    return {
        "id": row.id,
        "authorId": row.author_id,
        "venueId": row.venue_id,
        "placeId": row.place_id,
        "kind": row.kind,
        "status": row.status,
        "payload": payload or {},
        "lat": row.lat,
        "lng": row.lng,
        "createdAt": row.created_at.isoformat() if hasattr(row.created_at, "isoformat") else str(row.created_at),
    }


def main() -> None:
    args = parse_args()
    from pyspark.sql import SparkSession

    spark = SparkSession.builder.appName("parkbound-consolidate-queue").getOrCreate()
    ensure_schemas(spark, args.catalog)

    silver = f"{args.catalog}.silver.contributions_accepted"
    if not spark.catalog.tableExists(silver):
        contributions = []
    else:
        contributions = [row_to_contribution(r) for r in spark.table(silver).collect()]

    run_id = str(uuid.uuid4())
    export = {
        "contributions": contributions,
        "exportedAt": utc_now_iso(),
        "runId": run_id,
    }

    gold_df = spark.createDataFrame(
        [
            {
                "run_id": run_id,
                "exported_at": export["exportedAt"],
                "payload_json": json.dumps(export),
                "contribution_count": len(contributions),
            }
        ]
    )
    gold_df.write.format("delta").mode("append").saveAsTable(
        f"{args.catalog}.gold.consolidate_queue"
    )

    runs_df = spark.createDataFrame(
        [
            {
                "run_id": run_id,
                "exported_at": export["exportedAt"],
                "contribution_count": len(contributions),
                "status": "exported",
            }
        ]
    )
    runs_df.write.format("delta").mode("append").saveAsTable(
        f"{args.catalog}.gold.consolidate_runs"
    )


if __name__ == "__main__":
    main()
