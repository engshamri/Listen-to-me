#!/usr/bin/env python3
"""
Measures how reliably voices produce audio: N spaced attempts with the
language's test paragraph, compared with other voices of the same language.

    .cache/voice-qa-venv/Scripts/python scripts/voice-qa/reliability.py da-DK-ChristelNeural sk-SK-LukasNeural [--attempts 10]

Writes .cache/voice-qa/reliability.json (merged into the report by write_report.py).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
import time
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[2]
TEXTS = Path(__file__).resolve().parent / "texts.json"
CATALOG = ROOT / "src" / "data" / "voice-catalog.json"
OUT = ROOT / ".cache" / "voice-qa" / "reliability.json"


def full_name(voice_id: str) -> str:
    locale, name = voice_id.rsplit("-", 1)
    return f"Microsoft Server Speech Text to Speech Voice ({locale}, {name})"


async def attempt(voice_id: str, text: str) -> bool:
    path = os.path.join(tempfile.gettempdir(), f"rel-{os.getpid()}.mp3")
    try:
        await edge_tts.Communicate(text=text, voice=full_name(voice_id)).save(path)
        return os.path.getsize(path) > 1000
    except Exception:  # noqa: BLE001
        return False


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("voices", nargs="+")
    ap.add_argument("--attempts", type=int, default=10)
    args = ap.parse_args()
    texts = json.loads(TEXTS.read_text(encoding="utf-8"))
    catalog = {v["id"]: v for v in json.loads(CATALOG.read_text(encoding="utf-8"))}
    results = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}

    targets: list[str] = []
    for vid in args.voices:
        targets.append(vid)
        lang = catalog[vid]["lang"]
        control = next((c for c in catalog if catalog[c]["lang"] == lang and c not in args.voices and c != vid), None)
        if control and control not in targets:
            targets.append(control)

    for vid in targets:
        text = texts.get(catalog[vid]["lang"], texts["en"])
        ok = 0
        for _ in range(args.attempts):
            ok += await attempt(vid, text)
            await asyncio.sleep(2)
        results[vid] = {"attempts": args.attempts, "successes": ok, "rate": round(ok / args.attempts, 2), "control": vid not in args.voices, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        print(f"{vid:28} {ok}/{args.attempts}{'  (control)' if vid not in args.voices else ''}", flush=True)
    OUT.write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
