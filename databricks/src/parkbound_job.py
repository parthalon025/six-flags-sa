#!/usr/bin/env python3
"""Unified entry point for serverless spark_python_task jobs (no __file__ in exec)."""

from __future__ import annotations

import argparse
import importlib
import os
import sys


def find_src_root() -> str:
    """Locate deployed bundle src/ (contains common.py)."""
    seeds: list[str] = [os.getcwd()]
    if os.environ.get("PARKBOUND_BUNDLE_FILES"):
        seeds.insert(0, os.environ["PARKBOUND_BUNDLE_FILES"])

    # Walk up from cwd — serverless cwd is often under .../files/...
    cur = os.getcwd()
    for _ in range(12):
        seeds.append(cur)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent

    # Typical bundle deploy layout on workspace
    seeds.append("/Workspace/Users")
    for user_root in ("/Workspace/Users",):
        if os.path.isdir(user_root):
            for entry in os.listdir(user_root):
                bundle_src = os.path.join(
                    user_root,
                    entry,
                    ".bundle",
                    "parkbound",
                    "dev",
                    "files",
                    "src",
                )
                seeds.append(bundle_src)

    seen: set[str] = set()
    for base in seeds:
        if not base or base in seen:
            continue
        seen.add(base)
        for rel in ("", "src", os.path.join("files", "src")):
            root = os.path.normpath(os.path.join(base, rel)) if rel else os.path.normpath(base)
            if os.path.isfile(os.path.join(root, "common.py")):
                return root
    raise RuntimeError("Could not locate bundle src/ (common.py)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", required=True, help="Python module under src/, e.g. ingest.postgres")
    args, remainder = parser.parse_known_args()

    src_root = find_src_root()
    if src_root not in sys.path:
        sys.path.insert(0, src_root)

    sys.argv = [args.module, *remainder]
    mod = importlib.import_module(args.module)
    if not hasattr(mod, "main"):
        raise RuntimeError(f"{args.module} has no main()")
    mod.main()


if __name__ == "__main__":
    main()
