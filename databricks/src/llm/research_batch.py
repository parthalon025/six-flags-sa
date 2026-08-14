#!/usr/bin/env python3
"""
Batched venue LLM research with Delta prompt cache (token savings vs per-agent calls).
Uses Databricks Foundation Model API when DATABRICKS_HOST + token are set; else no-op.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from common import ensure_schemas, parse_args, sha256_text, utc_now_iso


SYSTEM = """You assist with theme-park venue research for an open-source map builder.
Never invent coordinates or height numbers. Output compact JSON with keys:
aliases, heightCandidates, inventoryGaps, notes, parkMaps.
aliases: [{official, bundle, confidence, reason}]
heightCandidates: [{name, min, alone, max, quote}]
inventoryGaps: [{name, note}]
parkMaps: [{pageUrl, imageUrl, confidence, title, reason}]
notes: string[]"""


def databricks_chat(prompt: str, model: str) -> tuple[str, dict]:
    host = os.environ["DATABRICKS_HOST"].rstrip("/")
    token = os.environ.get("DATABRICKS_TOKEN") or os.environ.get("VENUE_LLM_API_KEY")
    if not token:
        raise RuntimeError("DATABRICKS_TOKEN required")

    body = {
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 1200,
    }
    url = f"{host}/serving-endpoints/{model}/invocations"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        data = json.loads(res.read().decode("utf-8"))
    choices = data.get("choices") or []
    content = (choices[0].get("message") or {}).get("content") if choices else ""
    usage = data.get("usage") or {}
    return content or "", usage


def build_prompt(venue_id: str, summary: dict) -> str:
    """Summary-only context — not full POI dumps (token reduction)."""
    return json.dumps(
        {
            "venueId": venue_id,
            "poiCount": summary.get("poiCount"),
            "unmatchedOfficial": (summary.get("onlyOnSite") or [])[:8],
            "unmatchedApi": (summary.get("onlyOnApi") or [])[:8],
            "inventoryGaps": (summary.get("inventoryGaps") or [])[:12],
            "parkMapRequired": summary.get("parkMapRequired", True),
        },
        separators=(",", ":"),
    )


def main() -> None:
    args = parse_args({
        "--venue": {"default": "kings-island"},
        "--model": {"default": os.environ.get("VENUE_LLM_MODEL", "databricks-meta-llama-3-1-8b-instruct")},
        "--summary-json": {"default": ""},
    })
    from pyspark.sql import SparkSession

    spark = SparkSession.builder.appName("parkbound-llm-research").getOrCreate()
    ensure_schemas(spark, args.catalog)

    summary_path = args.summary_json or os.path.join(
        os.path.dirname(__file__), "..", "..", "fixtures", f"{args.venue}-summary.json"
    )
    if os.path.isfile(summary_path):
        with open(summary_path, encoding="utf-8") as fh:
            summary = json.load(fh)
    else:
        summary = {"poiCount": 0, "inventoryGaps": [], "parkMapRequired": True}

    prompt = build_prompt(args.venue, summary)
    prompt_hash = sha256_text(prompt + args.model)

    cache_table = f"{args.catalog}.gold.llm_cache"
    if spark.catalog.tableExists(cache_table):
        hit = (
            spark.table(cache_table)
            .filter(f"venue_id = '{args.venue}' AND prompt_hash = '{prompt_hash}'")
            .limit(1)
            .collect()
        )
        if hit:
            print(f"Cache hit for {args.venue} {prompt_hash[:12]}")
            return

    if not os.environ.get("DATABRICKS_HOST"):
        print("DATABRICKS_HOST not set — skipping LLM call (dev dry-run)")
        response_json = {"skipped": True, "venueId": args.venue, "summary": summary}
        usage = {}
    else:
        text, usage = databricks_chat(prompt, args.model)
        response_json = {
            "fetched": utc_now_iso()[:10],
            "llm": {"review": text},
            "llmParkMapSearch": {"skipped": False, "mode": "databricks_batch"},
            "venueId": args.venue,
        }

    row = spark.createDataFrame(
        [
            {
                "venue_id": args.venue,
                "prompt_hash": prompt_hash,
                "model": args.model,
                "response_json": json.dumps(response_json),
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "created_at": utc_now_iso(),
            }
        ]
    )
    row.write.format("delta").mode("append").saveAsTable(cache_table)
    print(f"Stored LLM cache for {args.venue}")


if __name__ == "__main__":
    main()
