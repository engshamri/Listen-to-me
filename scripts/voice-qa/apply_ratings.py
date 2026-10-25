#!/usr/bin/env python3
"""
Applies human listening ratings to src/data/voice-quality.json.

1. Run the audit, open .cache/voice-qa/review.html, rate voices (1-5) for
   naturalness, pronunciation and accent, then press "Export ratings".
2. python scripts/voice-qa/apply_ratings.py path/to/voice-ratings.json [--min 3]
3. npm run catalog        (rebuilds the catalog; disabled voices disappear)

A voice is disabled when any of its three ratings is below --min (default 3).
Ratings are stored with the voice so the decision stays documented.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUALITY = ROOT / "src" / "data" / "voice-quality.json"
ASPECTS = ("natural", "pronunciation", "accent")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("ratings", type=Path)
    ap.add_argument("--min", type=int, default=3, help="lowest acceptable rating (1-5)")
    args = ap.parse_args()

    ratings: dict[str, dict] = json.loads(args.ratings.read_text(encoding="utf-8"))
    quality = json.loads(QUALITY.read_text(encoding="utf-8"))
    changed = disabled = 0
    for vid, r in ratings.items():
        entry = quality["voices"].get(vid)
        if entry is None:
            print(f"skip unknown voice {vid}")
            continue
        scores = {k: int(r[k]) for k in ASPECTS if str(r.get(k, "")).isdigit()}
        if not scores:
            continue
        entry["listener"] = {**scores, "notes": r.get("notes", "")}
        changed += 1
        if min(scores.values()) < args.min:
            entry["status"] = "disabled"
            if "listener_rejected" not in entry.setdefault("flags", []):
                entry["flags"].append("listener_rejected")
            disabled += 1
    QUALITY.write_text(json.dumps(quality, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"applied ratings for {changed} voices; {disabled} disabled. Now run: npm run catalog")


if __name__ == "__main__":
    main()
