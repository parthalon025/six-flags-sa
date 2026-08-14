#!/usr/bin/env python3
"""Ingest Postgres contributions domain into Delta bronze/silver."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from common import ensure_schemas, parse_args, utc_now_iso


EPHEMERAL_KINDS = {"experience", "status", "queue_band", "ride_status"}


def jdbc_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("PARKBOUND_DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL required for postgres ingest")
    return url


def main() -> None:
    args = parse_args()
    from pyspark.sql import SparkSession
    from pyspark.sql import functions as F

    spark = SparkSession.builder.appName("parkbound-ingest-postgres").getOrCreate()
    ensure_schemas(spark, args.catalog)
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
