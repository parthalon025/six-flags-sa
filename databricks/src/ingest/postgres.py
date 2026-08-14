#!/usr/bin/env python3
"""Ingest Postgres contributions domain into Delta bronze/silver."""

from __future__ import annotations

import json
import os
import sys

from common import (
    bundle_files_root,
    ensure_schemas,
    fixture_mode,
    parse_args,
    utc_now_iso,
)

EPHEMERAL_KINDS = {"experience", "status", "queue_band", "ride_status"}


def jdbc_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("PARKBOUND_DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL required for postgres ingest")
    return url


def ingest_fixtures(spark, catalog: str) -> None:
    from pyspark.sql import functions as F

    path = os.path.join(bundle_files_root(), "fixtures", "sample-contributions.json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    ingested_at = utc_now_iso()

    for table in (
        "contributions",
        "confirmations",
        "score_events",
        "observations",
        "profiles",
    ):
        rows = data.get(table) or []
        if not rows:
            continue
        df = spark.createDataFrame(rows).withColumn("_ingested_at", F.lit(ingested_at))
        df.write.format("delta").mode("overwrite").saveAsTable(
            f"{catalog}.bronze.{table}_raw"
        )

    contrib = spark.table(f"{catalog}.bronze.contributions_raw")
    silver = (
        contrib.filter(F.col("status") == "accepted")
        .filter(~F.col("kind").isin(list(EPHEMERAL_KINDS)))
        .dropDuplicates(["id"])
    )
    silver.write.format("delta").mode("overwrite").saveAsTable(
        f"{catalog}.silver.contributions_accepted"
    )
    print(f"Fixture ingest complete from {path}")


def main() -> None:
    args = parse_args()
    from pyspark.sql import SparkSession
    from pyspark.sql import functions as F

    spark = SparkSession.builder.appName("parkbound-ingest-postgres").getOrCreate()
    ensure_schemas(spark, args.catalog)

    if fixture_mode(args.catalog):
        ingest_fixtures(spark, args.catalog)
        return

    ingested_at = utc_now_iso()
    tables = [
        "contributions",
        "confirmations",
        "score_events",
        "observations",
        "profiles",
    ]

    for table in tables:
        df = (
            spark.read.format("jdbc")
            .option("url", jdbc_url())
            .option("dbtable", table)
            .option("driver", "org.postgresql.Driver")
            .load()
            .withColumn("_ingested_at", F.lit(ingested_at))
        )
        target = f"{args.catalog}.bronze.{table}_raw"
        df.write.format("delta").mode("append").saveAsTable(target)

    contrib = spark.table(f"{args.catalog}.bronze.contributions_raw")
    silver = (
        contrib.filter(F.col("status") == "accepted")
        .filter(~F.col("kind").isin(list(EPHEMERAL_KINDS)))
        .dropDuplicates(["id"])
    )
    silver.write.format("delta").mode("overwrite").saveAsTable(
        f"{args.catalog}.silver.contributions_accepted"
    )


if __name__ == "__main__":
    main()
