"""Shared helpers for Parkbound Databricks jobs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any


def bootstrap_import_path() -> None:
    """Serverless spark_python_task exec() has no __file__ — locate src/ on sys.path."""
    for base in filter(None, (os.getcwd(), os.environ.get("PARKBOUND_BUNDLE_FILES"))):
        for rel in ("src", "files/src"):
            root = os.path.abspath(os.path.join(base, rel))
            if os.path.isfile(os.path.join(root, "common.py")):
                if root not in sys.path:
                    sys.path.insert(0, root)
                return
    try:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if root not in sys.path:
            sys.path.insert(0, root)
    except NameError:
        pass


def bundle_files_root() -> str:
    """Root of deployed bundle files (fixtures/, src/)."""
    for base in filter(None, (os.getcwd(), os.environ.get("PARKBOUND_BUNDLE_FILES"))):
        for rel in ("", "files"):
            root = os.path.abspath(os.path.join(base, rel)) if rel else os.path.abspath(base)
            if os.path.isdir(os.path.join(root, "fixtures")):
                return root
    for entry in sys.path:
        parent = os.path.dirname(entry)
        if os.path.basename(entry) == "src" and os.path.isdir(os.path.join(parent, "fixtures")):
            return parent
    return os.getcwd()


def fixture_mode(catalog: str | None = None) -> bool:
    """Use bundled fixtures when explicitly enabled or on dev cloud (workspace catalog)."""
    env = os.environ.get("PARKBOUND_E2E_FIXTURES", "").lower()
    if env in ("1", "true", "yes"):
        return True
    if env in ("0", "false", "no"):
        return False
    cat = catalog or catalog_name()
    return cat == "workspace"


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
