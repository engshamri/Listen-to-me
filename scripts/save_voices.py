#!/usr/bin/env python3
"""Refresh src/data/voices.json from the live Microsoft Edge TTS voice list.

Usage (from the project root):
    python scripts/save_voices.py

Voices that disappear from the live list are kept (marked "available": false)
so saved user preferences never point at a voice the catalog no longer knows.
Run `npm run catalog` afterwards to rebuild the enriched catalog.
"""
import asyncio
import json
from pathlib import Path

import edge_tts

OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "voices.json"


def to_entry(v: dict) -> dict:
    tag = v.get("VoiceTag") or {}
    return {
        "id": v["ShortName"],
        "gender": v["Gender"],
        "locale": v["Locale"],
        "localeName": v.get("LocaleName", ""),
        "friendlyName": v.get("FriendlyName", v["ShortName"]),
        "personalities": [t.strip() for t in tag.get("VoicePersonalities", []) if t.strip()],
        "categories": [t.strip() for t in tag.get("ContentCategories", []) if t.strip()],
        "available": True,
    }


async def main() -> None:
    live = [to_entry(v) for v in await edge_tts.list_voices()]
    live_ids = {v["id"] for v in live}

    previous = []
    if OUT.exists():
        previous = json.loads(OUT.read_text(encoding="utf-8"))
    kept = []
    for old in previous:
        if old.get("id") not in live_ids:
            old["available"] = False
            kept.append(old)

    voices = live + kept
    voices.sort(key=lambda v: (not v["locale"].startswith("ar-"), v["locale"], v["gender"], v["id"]))
    OUT.write_text(json.dumps(voices, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    arabic = sum(1 for v in voices if v["locale"].startswith("ar-"))
    print(f"saved {len(voices)} voices ({arabic} Arabic, {len(kept)} no longer listed) -> {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
