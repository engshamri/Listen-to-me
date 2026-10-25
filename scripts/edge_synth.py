#!/usr/bin/env python3
"""Microsoft Edge neural TTS runner (free, no API key), used by /api/tts.

Usage:
    python edge_synth.py --voice <ShortName> --rate "+0%" --pitch "+0Hz" \
        --text-file <in.txt> --out <out.mp3> [--timeout 90]

Exit codes (read by src/lib/server/edge.ts):
    0  success
    1  service/network error (retryable)
    3  the service returned no audio for this text/voice
    4  the edge-tts package is not installed
    5  timed out
"""
import argparse
import asyncio
import os
import sys


def full_voice_name(voice_id: str) -> str:
    """'iu-Cans-CA-SiqiniqNeural' -> 'Microsoft Server Speech Text to Speech Voice (iu-Cans-CA, SiqiniqNeural)'.

    edge-tts only accepts short ids shaped like 'xx-YY-NameNeural'; voices with
    a script or regional subtag (Inuktitut, Liaoning/Shaanxi Mandarin) must be
    passed by their full service name, which works for every voice.
    """
    if voice_id.startswith("Microsoft Server Speech"):
        return voice_id
    locale, name = voice_id.rsplit("-", 1)
    return f"Microsoft Server Speech Text to Speech Voice ({locale}, {name})"


async def synthesize(edge_tts, voice: str, rate: str, pitch: str, text_path: str, out_path: str) -> int:
    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read()
    communicate = edge_tts.Communicate(text=text, voice=full_voice_name(voice), rate=rate, pitch=pitch)
    await communicate.save(out_path)
    return os.path.getsize(out_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeout", type=int, default=90)
    args = parser.parse_args()

    try:
        import edge_tts  # noqa: PLC0415 - imported here so a missing package gets its own exit code
        from edge_tts.exceptions import NoAudioReceived
    except ImportError as exc:
        print(f"ERR ImportError: {exc}", file=sys.stderr)
        return 4

    try:
        size = asyncio.run(
            asyncio.wait_for(
                synthesize(edge_tts, args.voice, args.rate, args.pitch, args.text_file, args.out),
                timeout=args.timeout,
            )
        )
    except NoAudioReceived as exc:
        print(f"ERR NoAudioReceived: {exc}", file=sys.stderr)
        return 3
    except (asyncio.TimeoutError, TimeoutError):
        print("ERR Timeout", file=sys.stderr)
        return 5
    except Exception as exc:  # noqa: BLE001 - any other failure is reported as retryable
        print(f"ERR {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    if size < 500:
        print(f"ERR output too small ({size} bytes)", file=sys.stderr)
        return 3
    print(f"OK {size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
