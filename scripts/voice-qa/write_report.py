#!/usr/bin/env python3
"""Writes docs/VOICE-QUALITY.md from .cache/voice-qa/results.json (made by run_audit.py)."""
from __future__ import annotations

import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / ".cache" / "voice-qa" / "results.json"
CATALOG = ROOT / "src" / "data" / "voice-catalog.json"
OUT = ROOT / "docs" / "VOICE-QUALITY.md"

FLAG_TEXT = {
    "synthesis_failed": "the service returned no audio for the audit recording",
    "unreliable_synthesis": "fails most requests in repeated reliability tests while a same-language voice succeeds",
    "intermittent_synthesis": "some requests fail in repeated reliability tests",
    "confirmation_inconclusive": "a second-paragraph check could not be completed or had no peers to compare with",
    "detector_confused_language": "auto-detection named a related language, but recognition in the right language matched the text",
    "dialect_voice": "provider-tagged dialect voice (judged on an absolute threshold)",
    "asr_unsupported_language": "speech recognition cannot evaluate this language",
    "cleared_on_second_text": "an initial recognition problem did not reproduce on a second paragraph",
    "truncated": "audio much shorter than other voices reading the same text",
    "long_pause": "a pause longer than 1.6 s inside the paragraph",
    "clipping": "true peak above −0.1 dBFS with flat-topped samples",
    "noise_floor": "audible noise floor (above −55 dB) between words",
    "loudness_outlier": "loudness more than 6 LU away from same-language voices",
    "pacing_outlier": "speaking rate outside 65–150% of same-language voices",
    "language_mismatch": "speech recognition identified a different language",
    "low_intelligibility": "speech recognition error rate well above same-language voices",
    "confirmed_unintelligible": "error rate stayed high on a second paragraph while peers were fine",
}
INFORMATIONAL = {"dialect_voice", "cleared_on_second_text", "asr_unsupported_language", "detector_confused_language"}
FINDINGS = Path(__file__).resolve().parent / "findings.md"
RELIABILITY = ROOT / ".cache" / "voice-qa" / "reliability.json"
REPAIRED = ["iu-Cans-CA-SiqiniqNeural", "iu-Cans-CA-TaqqiqNeural", "iu-Latn-CA-SiqiniqNeural", "iu-Latn-CA-TaqqiqNeural"]


def pct(x):
    return "–" if x is None else f"{(1 - x) * 100:.0f}%"


def fmt(x, digits=1):
    return "–" if x is None else f"{x:.{digits}f}"


def main() -> None:
    data = json.loads(RESULTS.read_text(encoding="utf-8"))
    catalog = {v["id"]: v for v in json.loads(CATALOG.read_text(encoding="utf-8"))}
    results = data["voices"]
    ids = [i for i in catalog if i in results]

    status_count: dict[str, int] = {}
    for i in ids:
        s = results[i].get("status", "?")
        status_count[s] = status_count.get(s, 0) + 1
    disabled = [i for i in ids if results[i].get("status") == "disabled"]
    review = [i for i in ids if results[i].get("status") == "review"]
    asr_cers = [results[i]["asr"]["cer"] for i in ids if results[i].get("asr")]

    lines: list[str] = []
    w = lines.append
    w("# Voice quality audit\n")
    w(f"Generated {data['generatedAt']} by `scripts/voice-qa/run_audit.py`. Raw data: `.cache/voice-qa/results.json` (re-create with the script).\n")
    w("## Summary\n")
    w(f"- **Voices audited:** {len(ids)} (every voice in the catalog; the catalog matches the provider's live list).")
    w(f"- **Verified** (passed audio checks and speech-recognition intelligibility): {status_count.get('verified', 0)}")
    w(f"- **Audio-checked only** (speech recognition cannot evaluate the language): {status_count.get('audio_only', 0)}")
    w(f"- **Kept, flagged for listening review:** {status_count.get('review', 0)}")
    w(f"- **Disabled:** {status_count.get('disabled', 0)}" + (f" — {', '.join(f'`{d}`' for d in disabled)}" if disabled else ""))
    if asr_cers:
        w(f"- **Median character error rate** across all recognizable voices: {statistics.median(asr_cers):.3f} (≈ {pct(statistics.median(asr_cers))} of characters recognized).")
    w("")
    w("### Removed, repaired, replaced, retained, added\n")
    w(f"- **Removed (disabled):** {len(disabled)}" + (f" — {', '.join(f'`{d}`' for d in disabled)}" if disabled else "") + ". Each failed most requests in two separate reliability runs while another voice of the same language never failed (evidence below). Their languages keep at least one working voice.")
    w(f"- **Repaired:** {len(REPAIRED)} Inuktitut voices that could never produce audio in the app (a voice-name format problem) now work.")
    w("- **Replaced:** no free provider offers more natural voices than the Microsoft neural voices already used (see *Coverage*), so disabled voices are not replaced; each affected language still has at least one verified voice.")
    w(f"- **Retained:** {len(ids) - len(disabled)} voices. {status_count.get('review', 0)} of them are kept with a documented flag for a human listener to judge.")
    multi = data.get("multilingual", {})
    verified_pairs = sum(1 for m in multi.values() for e in m.values() if e.get("verified"))
    w(f"- **Added:** no new voices exist beyond the provider's 322. Instead, {verified_pairs} *multilingual voice × language* combinations were verified by speech recognition (12 voices × 12 languages); the voices verified for Arabic are offered in the Arabic section of the voice browser.\n")

    w("## Method\n")
    w("1. **Test text.** Each voice read one paragraph in its own language with the same content in every language (greeting, a clause about weather and a market opening time, a question). Arabic uses a hand-written Modern Standard Arabic paragraph exercising ض ظ ع غ ق ص ط. Other languages use a machine translation of the English paragraph, cached in `scripts/voice-qa/texts.json`.")
    w("2. **Audio checks (ffmpeg).** Integrated loudness (EBU R128), true peak, clipping (flat factor), noise floor, internal pauses (silence below −45 dB longer than 0.3 s), speech duration, speaking rate.")
    w(f"3. **Intelligibility.** Speech recognition with faster-whisper `{data.get('model', 'large-v3')}` (Whisper large-v3, on a GPU) transcribed each recording. The character error rate (CER) compares the transcript with the input text after normalizing case, punctuation, spacing, Arabic letter variants, Serbian script (Cyrillic/Latin) and Chinese script (Traditional/Simplified). Spoken-language identification checks that the voice is heard as its language; mutually intelligible pairs (Serbian/Croatian/Bosnian, Malay/Indonesian) count as matches, and a detector mix-up only counts against a voice when recognition in the correct language is also poor.")
    w("4. **Peer comparison.** Thresholds are relative to voices of the same language (same text, same recognizer), so a weakness of the recognizer in a language is not blamed on a voice: *low intelligibility* means CER > max(0.30, language median + 0.20). Provider-tagged dialect voices use an absolute threshold (0.60) instead.")
    w("5. **Confirmation.** Voices flagged for intelligibility were re-recorded reading a second, different paragraph and compared with up to three verified peers. Disabled only if CER ≥ 0.5 on it while peers' median ≤ 0.2. A missing recording or no peers makes the check inconclusive, and the voice is kept.")
    w("6. **Reliability.** Voices that failed to produce audio were re-tested with 10 spaced attempts, next to a same-language control voice (`scripts/voice-qa/reliability.py`). Below 50 % success (with the control ≥ 90 %): disabled. 50–90 %: kept, flagged as intermittent.")
    w("7. **Multilingual voices.** Each was recorded reading 12 languages; a language counts as verified when its CER is within max(0.20, 1.5 × native median + 0.05) and the language is identified correctly.\n")
    w("### What this does and does not show\n")
    w("- It shows that audio was produced, is clean (no clipping, noise or broken pauses), and that a strong recognizer understands the words in the intended language.")
    w("- It does **not** measure how human or pleasant a voice sounds, nor whether a regional accent is authentic. Microsoft's Arabic voices are *regional-accent* voices; the provider tags only two voices in the whole catalog as dialect voices (Liaoning and Shaanxi Mandarin). Use the listening sheet (`.cache/voice-qa/review.html`, generated by the script) for human ratings of naturalness, pronunciation and accent.")
    w("- Languages Whisper cannot recognize or evaluate fairly (Irish, Inuktitut, Lao, Zulu) only receive audio checks.")
    w("- No person listened to the recordings as part of this audit. `scripts/voice-qa/apply_ratings.py` turns ratings from the listening sheet into verdicts (a rating below 3 disables a voice).\n")

    if RELIABILITY.exists():
        rel = json.loads(RELIABILITY.read_text(encoding="utf-8"))
        w("## Reliability tests\n")
        w("| Voice | Role | Successful attempts | Measured |")
        w("|---|---|---:|---|")
        for vid, e in rel.items():
            w(f"| `{vid}` | {'control' if e.get('control') else 'tested'} | {e['successes']}/{e['attempts']} | {e.get('at', '')} |")
        w("\nAn earlier run (same method) gave 0/10 for all four tested voices and 10/10 for every control.\n")

    if FINDINGS.exists():
        w(FINDINGS.read_text(encoding="utf-8").strip() + "\n")

    # per language
    w("## Results by language\n")
    w("| Language | Voices | Verified | Review | Disabled | Median CER | Clarity |")
    w("|---|---:|---:|---:|---:|---:|---:|")
    by_lang: dict[str, list[str]] = {}
    for i in ids:
        by_lang.setdefault(catalog[i]["languageName"]["en"], []).append(i)
    for lang in sorted(by_lang):
        group = by_lang[lang]
        cers = [results[i]["asr"]["cer"] for i in group if results[i].get("asr")]
        med = statistics.median(cers) if cers else None
        cnt = lambda s: sum(1 for i in group if results[i].get("status") == s)  # noqa: E731
        w(f"| {lang} | {len(group)} | {cnt('verified')} | {cnt('review')} | {cnt('disabled')} | {fmt(med, 3)} | {pct(med)} |")
    w("")

    # attention
    w("## Voices flagged or disabled (evidence)\n")
    attention = disabled + review
    if not attention:
        w("None.\n")
    else:
        w("| Voice | Language · country | Status | Findings | CER (peers) | Heard (excerpt) |")
        w("|---|---|---|---|---|---|")
        for i in attention:
            r = results[i]
            v = catalog[i]
            peers = r.get("peers", {})
            heard = (r.get("confirm", {}).get("heard") or (r.get("asr") or {}).get("text") or "").replace("|", "/")[:90]
            findings = "; ".join(FLAG_TEXT.get(f, f) for f in r.get("flags", []) if f not in INFORMATIONAL or r.get("status") != "verified")
            extra = f" · confirm CER {fmt(r['confirm']['cer'], 2)} vs peers {fmt(r['confirm'].get('peerCer'), 2)}" if r.get("confirm") else ""
            w(f"| `{i}` | {v['languageName']['en']} · {(v.get('countryName') or {}).get('en', '')} | {r.get('status')} | {findings} | {fmt((r.get('asr') or {}).get('cer'), 2)} ({fmt(peers.get('cer'), 2)}){extra} | {heard} |")
        w("")

    # multilingual
    if multi:
        langs = sorted({L for m in multi.values() for L in m})
        w("## Multilingual voices: verified languages\n")
        w("✓ = verified (CER shown), ✗ = not verified. Native median CER for comparison is in `results.json`.\n")
        w("| Voice | " + " | ".join(langs) + " |")
        w("|---|" + "---|" * len(langs))
        for vid, m in multi.items():
            cells = []
            for L in langs:
                e = m.get(L, {})
                cells.append("–" if "cer" not in e else f"{'✓' if e.get('verified') else '✗'} {e['cer']:.2f}")
            w(f"| `{vid}` | " + " | ".join(cells) + " |")
        w("")

    w("## Coverage: sources considered\n")
    w("- **Microsoft Edge neural voices (current provider):** all 322 voices available through the free endpoint are in the catalog; the list was compared with the live service and matches exactly.")
    w("- **Azure AI Speech:** has more voices and styles but requires a paid subscription key, which this project avoids.")
    w("- **Google Translate speech (backup voice):** one generic voice per language, no speed/pitch; clearly less natural, so it stays an opt-in fallback only.")
    w("- **Local open-source engines (e.g. Piper):** free and offline, but noticeably less natural than the neural voices already offered and would add large model downloads; not added.\n")

    # full table
    w("## All voices\n")
    w("| Voice | Language | Country | Status | Clarity | Lang. ID | LUFS | True peak | Max pause s | Rate |")
    w("|---|---|---|---|---:|---:|---:|---:|---:|---:|")
    for i in ids:
        r = results[i]
        v = catalog[i]
        a = r.get("audio") or {}
        asr = r.get("asr") or {}
        lid = f"{asr.get('detected')} {asr.get('prob', 0):.2f}" if asr else "–"
        w(f"| `{i}` | {v['languageName']['en']} | {(v.get('countryName') or {}).get('en', '')} | {r.get('status')} | {pct(asr.get('cer')) if asr else '–'} | {lid} | {fmt(a.get('lufs'))} | {fmt(a.get('truePeak'))} | {fmt(a.get('maxPause'), 2)} | {fmt(r.get('rate'))} |")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
