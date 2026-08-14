"""Shared helpers for Parkbound Databricks jobs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def catalog_name(default: str = "parkbound") -> str:
    return os.environ.get("PARKBOUND_CATALOG", default)


def ensure_schemas(spark, catalog: str) -> None:
    for layer in ("bronze", "silver", "gold"):
        spark.sql(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{layer}")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_args(extra: dict[str, Any] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default=catalog_name())
    if extra:
        for name, spec in extra.items():
            parser.add_argument(name, **spec)
    return parser.parse_args()


def json_dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), sort_keys=True)
