#!/usr/bin/env python3
"""
Voice quality audit for every voice in src/data/voice-catalog.json.

For each voice it synthesizes a test paragraph in the voice's language, then:
  * audio checks (ffmpeg): loudness (EBU R128), true peak / clipping, noise
    floor, internal pauses, speaking rate, truncation;
  * intelligibility (faster-whisper speech recognition): character error rate
    between the input text and what the recognizer hears, plus spoken-language
    identification;
  * peer comparison: every metric is judged against the other voices of the
    same language, so recognizer weaknesses in a language are not blamed on a
    voice.
It also tests each multilingual voice on other languages.

Outputs
  .cache/voice-qa/samples/*.mp3     test recordings (not committed)
  .cache/voice-qa/results.json      raw measurements
  .cache/voice-qa/review.html       listening sheet for human rating
  src/data/voice-quality.json       compact verdicts used by the app
  docs/VOICE-QUALITY.md             report

Usage (from the project root):
  python -m venv .cache/voice-qa-venv
  .cache/voice-qa-venv/Scripts/python -m pip install -r scripts/voice-qa/requirements.txt
  .cache/voice-qa-venv/Scripts/python scripts/voice-qa/run_audit.py [--model small] [--device auto]

Automated checks cannot judge naturalness or accent authenticity; use the
listening sheet for that. No voice is disabled on recognizer evidence alone
unless a larger model confirms it against same-language peers.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import html
import json
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CATALOG = ROOT / "src" / "data" / "voice-catalog.json"
TEXTS = HERE / "texts.json"
OUT = ROOT / ".cache" / "voice-qa"
SAMPLES = OUT / "samples"
MULTI = OUT / "multilingual"

ENGLISH_TEXT = (
    "Good morning. Today we are testing how clearly this voice reads a short paragraph. "
    "The weather in the capital is pleasant, and the market opens at nine in the morning. "
    "Could you understand every word of this sentence?"
)
# Hand-written Modern Standard Arabic, with ض ظ ع غ ق ص ط to exercise pronunciation.
ARABIC_TEXT = (
    "صباح الخير. نختبر اليوم وضوح هذا الصوت في قراءة فقرة قصيرة. "
    "الطقس في العاصمة معتدل، ويفتح السوق أبوابه في التاسعة صباحاً، ويصل الضيوف ظهراً قبل الغروب. "
    "هل استطعت أن تفهم كل كلمة؟"
)
# Second, different paragraph used to confirm problems found with the first.
ENGLISH_TEXT_2 = (
    "Please listen carefully. The children are playing in the garden while their grandmother prepares dinner. "
    "Tomorrow we will travel to the coast and visit the old lighthouse."
)
ARABIC_TEXT_2 = "من فضلك استمع جيداً. يلعب الأطفال في الحديقة بينما تُعِدّ جدّتهم طعام العشاء. سنسافر غداً إلى الساحل ونزور المنارة القديمة."
MULTILINGUAL_TEST_LANGS = ["ar", "es", "fr", "de", "it", "pt", "zh-CN", "ja", "ko", "hi", "ru", "tr"]

GOOGLE_CODES = {"he": "iw", "jv": "jw", "fil": "tl", "nb": "no"}
WHISPER_CODES = {"fil": "tl", "nb": "no", "jv": "jw"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ----------------------------------------------------------- test texts ---
def text_key(voice: dict) -> str:
    loc = voice["locale"]
    if loc.startswith("zh-TW") or loc.startswith("zh-HK"):
        return "zh-TW"
    if loc.startswith("zh-"):
        return "zh-CN"
    if loc.startswith("iu-Latn"):
        return "iu-Latn"
    return voice["lang"]


def google_translate(text: str, target: str) -> str:
    code = GOOGLE_CODES.get(target, target)
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={urllib.parse.quote(code)}&dt=t"
    req = urllib.request.Request(url, data=urllib.parse.urlencode({"q": text}).encode(), headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    return "".join(seg[0] for seg in data[0] if seg and seg[0])


def load_texts(keys: set[str], second: bool = False) -> dict[str, str]:
    """Test paragraph per language, cached in texts.json (keys suffixed '#2'
    for the confirmation paragraph). A language is never silently given the
    English text: that would test the wrong thing."""
    source, suffix = (ENGLISH_TEXT_2, "#2") if second else (ENGLISH_TEXT, "")
    texts = json.loads(TEXTS.read_text(encoding="utf-8")) if TEXTS.exists() else {}
    texts = {k: v for k, v in texts.items() if k in ("en", "en#2") or v not in (ENGLISH_TEXT, ENGLISH_TEXT_2)}
    texts.update({"en": ENGLISH_TEXT, "ar": ARABIC_TEXT, "en#2": ENGLISH_TEXT_2, "ar#2": ARABIC_TEXT_2})
    for k in sorted(k for k in keys if k + suffix not in texts):
        for attempt in range(6):
            try:
                texts[k + suffix] = google_translate(source, k)
                log(f"translated test text -> {k}")
                break
            except Exception as e:  # noqa: BLE001
                wait = 5 * 2**attempt
                log(f"translate {k} failed ({e}); retrying in {wait}s")
                time.sleep(wait)
        else:
            raise SystemExit(f"Could not get a test text for '{k}'. Add it to {TEXTS} by hand and re-run.")
        TEXTS.write_text(json.dumps(dict(sorted(texts.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        time.sleep(1.5)
    TEXTS.write_text(json.dumps(dict(sorted(texts.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return {k[: -len(suffix)] if suffix else k: v for k, v in texts.items() if (k.endswith(suffix) if suffix else "#" not in k)}


# ------------------------------------------------------------ synthesis ---
def full_voice_name(voice_id: str) -> str:
    """Same conversion as src/lib/server/edge.ts: works for ids with script/region subtags."""
    locale, name = voice_id.rsplit("-", 1)
    return f"Microsoft Server Speech Text to Speech Voice ({locale}, {name})"


async def synthesize_all(jobs: list[tuple[str, str, Path]], force: bool, concurrency: int = 6) -> dict[str, dict]:
    import edge_tts

    sem = asyncio.Semaphore(concurrency)
    results: dict[str, dict] = {}

    async def one(key: str, voice_id: str, text: str, path: Path) -> None:
        if path.exists() and path.stat().st_size > 1000 and not force:
            results[key] = {"ok": True, "cached": True}
            return
        err = ""
        async with sem:
            for attempt in range(1, 4):
                try:
                    t0 = time.perf_counter()
                    await edge_tts.Communicate(text=text, voice=full_voice_name(voice_id)).save(str(path))
                    if path.stat().st_size > 1000:
                        results[key] = {"ok": True, "latency": round(time.perf_counter() - t0, 2), "attempts": attempt}
                        return
                    err = f"output too small ({path.stat().st_size} bytes)"
                except Exception as e:  # noqa: BLE001
                    err = f"{type(e).__name__}: {e}"
                await asyncio.sleep(2 * attempt)
        path.unlink(missing_ok=True)
        results[key] = {"ok": False, "error": err[:300]}

    await asyncio.gather(*(one(*j) for j in jobs))
    return results


# --------------------------------------------------------- audio checks ---
def num(pattern: str, text: str) -> float | None:
    """Last match as a float; infinities (digital silence) become None so the JSON stays valid."""
    m = re.findall(pattern, text)
    if not m:
        return None
    try:
        v = float(m[-1])
    except ValueError:
        return None
    return None if v in (float("inf"), float("-inf")) else round(v, 2)


def analyze_audio(path: Path) -> dict:
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True)
    duration = float(probe.stdout.strip() or 0)
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "astats=measure_perchannel=none,silencedetect=n=-45dB:d=0.3,ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    err = r.stderr
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    ends = [(float(e), float(d)) for e, d in re.findall(r"silence_end: ([\d.]+) \| silence_duration: ([\d.]+)", err)]
    silences = []
    for i, s in enumerate(starts):
        e, d = ends[i] if i < len(ends) else (duration, duration - s)
        silences.append((max(0.0, s), e, d))
    lead = next((d for s, e, d in silences if s <= 0.05), 0.0)
    trail = next((d for s, e, d in silences if e >= duration - 0.05), 0.0)
    internal = [d for s, e, d in silences if s > 0.05 and e < duration - 0.05]
    return {
        "duration": round(duration, 2),
        "speech": round(max(0.0, duration - lead - trail), 2),
        "leadSilence": round(lead, 2),
        "maxPause": round(max(internal, default=0.0), 2),
        "pauses": len(internal),
        "peakDb": num(r"Peak level dB: (-?[\d.]+|-?inf)", err),
        "rmsDb": num(r"RMS level dB: (-?[\d.]+|-?inf)", err),
        "noiseFloorDb": num(r"Noise floor dB: (-?[\d.]+|-?inf)", err),
        "flatFactor": num(r"Flat factor: (-?[\d.]+|-?inf)", err),
        "lufs": num(r"I:\s+(-?[\d.]+) LUFS", err),
        "truePeak": num(r"Peak:\s+(-?[\d.]+|-?inf) dBFS", err),
    }


# ------------------------------------------------------- intelligibility ---
ARABIC_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي", "ی": "ي", "ک": "ك"})


# Serbian is written in both scripts; the recognizer often answers in Latin.
SERBIAN_TO_LATIN = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ђ": "đ", "е": "e", "ж": "ž", "з": "z", "и": "i", "ј": "j",
    "к": "k", "л": "l", "љ": "lj", "м": "m", "н": "n", "њ": "nj", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "ћ": "ć", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "č", "џ": "dž", "ш": "š",
}
# Languages the recognizer cannot evaluate fairly (it transcribes Lao as Thai).
ASR_UNRELIABLE = {"lo"}


def to_simplified(text: str) -> str:
    """Traditional -> Simplified Chinese, so a correct transcript in the other script isn't counted as errors."""
    try:
        import zhconv
    except ImportError:
        return text
    return zhconv.convert(text, "zh-cn")


def normalize(text: str, lang: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower()
    if lang == "sr":
        t = "".join(SERBIAN_TO_LATIN.get(ch, ch) for ch in t)
    elif lang == "zh":
        t = to_simplified(t)
    if lang in ("ar", "fa", "ur", "ps"):
        t = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", t).translate(ARABIC_FOLD)
    t = "".join(ch for ch in t if not unicodedata.category(ch).startswith(("P", "S")))
    return re.sub(r"\s+", "", t)


def cer(reference: str, hypothesis: str, lang: str) -> float:
    a, b = normalize(reference, lang), normalize(hypothesis, lang)
    if not a:
        return 0.0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
    return round(min(1.0, prev[-1] / len(a)), 3)


def expose_cuda_libraries() -> None:
    """Makes pip-installed NVIDIA runtime DLLs (nvidia-cublas-cu12, nvidia-cudnn-cu12) loadable on Windows."""
    import os
    import site

    for base in site.getsitepackages():
        for bin_dir in Path(base).glob("nvidia/*/bin"):
            os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(bin_dir))


def decode(path: Path):
    """16 kHz mono float32 samples via ffmpeg (avoids PyAV version issues)."""
    import numpy as np

    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def load_model(name: str, device: str):
    expose_cuda_libraries()
    from faster_whisper import WhisperModel

    if device in ("auto", "cuda"):
        try:
            m = WhisperModel(name, device="cuda", compute_type="float16")
            list(m.transcribe(decode(next(SAMPLES.glob("*.mp3"))), language="en")[0])
            log(f"speech recognition: {name} on GPU")
            return m
        except Exception as e:  # noqa: BLE001
            if device == "cuda":
                raise
            log(f"GPU unavailable ({type(e).__name__}: {e}); using CPU")
    m = WhisperModel(name, device="cpu", compute_type="int8")
    log(f"speech recognition: {name} on CPU")
    return m


def whisper_languages() -> set[str]:
    from faster_whisper.tokenizer import _LANGUAGE_CODES

    return set(_LANGUAGE_CODES)


# Languages the recognizer routinely confuses because they are mutually
# intelligible; detecting one as another is not a voice problem.
EQUIVALENT_LANGS = [{"sr", "hr", "bs"}, {"ms", "id"}, {"zh", "yue"}, {"no", "nn"}]


def same_language(expected: str, detected: str | None) -> bool:
    return detected == expected or any(expected in g and detected in g for g in EQUIVALENT_LANGS)


def transcribe(model, path: Path, expected: str | None) -> dict:
    audio = decode(path)
    segments, info = model.transcribe(audio, language=None, beam_size=5, condition_on_previous_text=False, vad_filter=False)
    text = "".join(s.text for s in segments).strip()
    out = {"detected": info.language, "prob": round(info.language_probability, 3), "text": text}
    if expected and not same_language(expected, info.language):
        segments, _ = model.transcribe(audio, language=expected, beam_size=5, condition_on_previous_text=False, vad_filter=False)
        out["text"] = "".join(s.text for s in segments).strip()
        out["forced"] = True
    return out


# ------------------------------------------------------------- verdicts ---
def median(values: list[float]) -> float | None:
    vals = [v for v in values if v is not None]
    return statistics.median(vals) if vals else None


RELIABILITY = OUT / "reliability.json"
# Flags that document something about a voice without counting against it.
INFORMATIONAL_FLAGS = {"dialect_voice", "cleared_on_second_text", "asr_unsupported_language", "detector_confused_language"}


def judge(voices: list[dict], results: dict[str, dict]) -> None:
    reliability = json.loads(RELIABILITY.read_text(encoding="utf-8")) if RELIABILITY.exists() else {}
    by_lang: dict[str, list[tuple[dict, dict]]] = {}
    for v in voices:
        by_lang.setdefault(v["lang"], []).append((v, results[v["id"]]))
    for lang, pairs in by_lang.items():
        ok = [r for v, r in pairs if r.get("synth", {}).get("ok")]
        # Dialect voices are not compared with (or included in) standard-language peers.
        standard = [r for v, r in pairs if r.get("synth", {}).get("ok") and "Dialect" not in v.get("categories", [])]
        med_cer = median([r["asr"]["cer"] for r in standard if r.get("asr")])
        med_rate = median([r["rate"] for r in ok if r.get("rate")])
        med_lufs = median([r["audio"]["lufs"] for r in ok if r.get("audio", {}).get("lufs") is not None])
        med_speech = median([r["audio"]["speech"] for r in ok if r.get("audio")])
        for v, r in pairs:
            flags: list[str] = []
            r["peers"] = {"cer": med_cer, "rate": med_rate, "lufs": med_lufs, "count": len(ok)}
            if not r.get("synth", {}).get("ok"):
                rel = reliability.get(v["id"])
                control = next((c for c, e in reliability.items() if e.get("control") and c.split("-")[0] == lang), None)
                control_rate = reliability[control]["rate"] if control else None
                if rel and rel["rate"] < 0.5 and control_rate is not None and control_rate >= 0.9:
                    r["status"], r["flags"] = "disabled", ["synthesis_failed", "unreliable_synthesis"]
                    r["reliability"] = {**rel, "control": control, "controlRate": control_rate}
                else:
                    r["status"], r["flags"] = "review", ["synthesis_failed"]
                continue
            if "Dialect" in v.get("categories", []):
                flags.append("dialect_voice")
            a = r["audio"]
            if med_speech and a["speech"] < 0.5 * med_speech:
                flags.append("truncated")
            if a["maxPause"] > 1.6:
                flags.append("long_pause")
            if a["truePeak"] is not None and a["truePeak"] > -0.1 and (a["flatFactor"] or 0) > 1:
                flags.append("clipping")
            if a["noiseFloorDb"] is not None and a["noiseFloorDb"] > -55:
                flags.append("noise_floor")
            if med_lufs is not None and a["lufs"] is not None and abs(a["lufs"] - med_lufs) > 6:
                flags.append("loudness_outlier")
            if med_rate and r.get("rate") and not (0.65 * med_rate <= r["rate"] <= 1.5 * med_rate):
                flags.append("pacing_outlier")
            asr = r.get("asr")
            if asr:
                # Auto-detection sometimes confuses related languages (Maltese ->
                # Arabic, Sundanese -> Indonesian). That is only a voice problem if
                # recognition in the *correct* language is also poor.
                if not same_language(asr["expected"], asr["detected"]) and asr["prob"] >= 0.6 and asr["cer"] > 0.3:
                    flags.append("language_mismatch")
                elif not same_language(asr["expected"], asr["detected"]):
                    flags.append("detector_confused_language")
                # Dialect voices get an absolute threshold: a standard-language
                # recognizer is expected to miss some dialect pronunciation.
                limit = 0.6 if "dialect_voice" in flags else max(0.3, (med_cer or 0) + 0.2)
                if asr["cer"] > limit:
                    flags.append("low_intelligibility")
            r["flags"] = flags
            problems = [f for f in flags if f not in INFORMATIONAL_FLAGS]
            r["status"] = "review" if problems else ("verified" if asr else "audio_only")
            # Repeated-attempt evidence outweighs one lucky recording: a voice that
            # rarely produces audio is unusable however good that sample sounds.
            rel = reliability.get(v["id"])
            if rel and not rel.get("control"):
                control = next((c for c, e in reliability.items() if e.get("control") and c.split("-")[0] == lang), None)
                control_rate = reliability[control]["rate"] if control else None
                r["reliability"] = {**rel, "control": control, "controlRate": control_rate}
                if control_rate is not None and control_rate >= 0.9:
                    if rel["rate"] < 0.5:
                        r["status"] = "disabled"
                        r["flags"].append("unreliable_synthesis")
                    elif rel["rate"] < 0.9:
                        r["status"] = "review"
                        r["flags"].append("intermittent_synthesis")


# --------------------------------------------------------------- report ---
def write_review_html(voices: list[dict], results: dict[str, dict]) -> None:
    rows = []
    for v in voices:
        r = results[v["id"]]
        asr = r.get("asr") or {}
        a = r.get("audio") or {}
        player = f'<audio controls preload="none" src="samples/{v["id"]}.mp3"></audio>' if r.get("synth", {}).get("ok") else "failed"
        rows.append(
            f"<tr data-id='{v['id']}'><td><b>{html.escape(v['name'])}</b><br><small>{v['id']}</small></td>"
            f"<td>{html.escape(v['languageName']['en'])}<br><small>{html.escape((v.get('countryName') or {}).get('en', ''))}</small></td>"
            f"<td>{player}</td>"
            f"<td>{r.get('status')}<br><small>{', '.join(r.get('flags', []))}</small></td>"
            f"<td>{asr.get('cer', '–')}</td><td>{a.get('lufs', '–')}</td><td>{a.get('maxPause', '–')}</td>"
            + "".join(f"<td><select data-k='{k}'><option></option>{''.join(f'<option>{i}</option>' for i in range(1, 6))}</select></td>" for k in ("natural", "pronunciation", "accent"))
            + "<td><input data-k='notes' size=24></td></tr>"
        )
    page = f"""<!doctype html><meta charset=utf-8><title>Voice listening review</title>
<style>body{{font:14px system-ui;margin:24px}}table{{border-collapse:collapse}}td,th{{border:1px solid #ddd;padding:6px;vertical-align:top}}th{{background:#f4f4f4;position:sticky;top:0}}audio{{width:220px}}</style>
<h1>Voice listening review</h1><p>Rate 1 (poor) to 5 (excellent). Ratings are saved in this browser; use Export to save them as JSON.</p>
<button id=exp>Export ratings</button>
<table><tr><th>Voice</th><th>Language</th><th>Sample</th><th>Automated</th><th>CER</th><th>LUFS</th><th>Max pause s</th><th>Natural</th><th>Pronunciation</th><th>Accent</th><th>Notes</th></tr>{''.join(rows)}</table>
<script>
const KEY='voice-review';const data=JSON.parse(localStorage.getItem(KEY)||'{{}}');
document.querySelectorAll('tr[data-id]').forEach(tr=>{{const id=tr.dataset.id;tr.querySelectorAll('[data-k]').forEach(el=>{{el.value=(data[id]||{{}})[el.dataset.k]||'';el.onchange=()=>{{(data[id]??={{}})[el.dataset.k]=el.value;localStorage.setItem(KEY,JSON.stringify(data))}}}})}});
document.getElementById('exp').onclick=()=>{{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,1)],{{type:'application/json'}}));a.download='voice-ratings.json';a.click()}};
</script>"""
    (OUT / "review.html").write_text(page, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="large-v3", help="faster-whisper model (large-v3 needs a GPU to be practical; use 'small' on CPU)")
    ap.add_argument("--confirm-model", default="large-v3", help="model used to re-check flagged voices on a second paragraph")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--force", action="store_true", help="re-synthesize samples even if cached")
    ap.add_argument("--only", help="comma-separated voice ids (debugging)")
    ap.add_argument("--reuse", action="store_true", help="re-score transcripts from the previous run instead of re-recognizing unchanged recordings")
    args = ap.parse_args()

    SAMPLES.mkdir(parents=True, exist_ok=True)
    MULTI.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    voices = [v for v in catalog if not args.only or v["id"] in args.only.split(",")]
    texts = load_texts({text_key(v) for v in voices} | set(MULTILINGUAL_TEST_LANGS))
    wl = whisper_languages()

    # 1) synthesis
    jobs = [(v["id"], v["id"], texts[text_key(v)], SAMPLES / f"{v['id']}.mp3") for v in voices]
    multi_voices = [v for v in voices if v.get("multilingual")]
    multi_jobs = [(f"{v['id']}|{L}", v["id"], texts[L], MULTI / f"{v['id']}__{L}.mp3") for v in multi_voices for L in MULTILINGUAL_TEST_LANGS]
    log(f"synthesizing {len(jobs)} voice samples + {len(multi_jobs)} multilingual samples")
    synth = asyncio.run(synthesize_all(jobs + multi_jobs, args.force))
    failed = [k for k, s in synth.items() if not s["ok"]]
    if failed:  # second chance, sequentially, for transient network errors
        log(f"retrying {len(failed)} failed samples")
        retry = asyncio.run(synthesize_all([j for j in jobs + multi_jobs if j[0] in failed], True, concurrency=1))
        synth.update(retry)

    # 2) audio measurements
    results: dict[str, dict] = {}
    for v in voices:
        r = results[v["id"]] = {"synth": synth[v["id"]]}
        path = SAMPLES / f"{v['id']}.mp3"
        if synth[v["id"]]["ok"]:
            r["audio"] = analyze_audio(path)
            letters = len(normalize(texts[text_key(v)], v["lang"]))
            r["rate"] = round(letters / r["audio"]["speech"], 2) if r["audio"]["speech"] else None
    log("audio measurements done")

    # 3) intelligibility. With --reuse, transcripts from the previous run are
    #    re-scored (e.g. after a normalization fix) instead of re-recognized,
    #    as long as the recording itself was not re-made.
    previous = json.loads((OUT / "results.json").read_text(encoding="utf-8")) if args.reuse and (OUT / "results.json").exists() else {"voices": {}, "multilingual": {}}
    model = None

    def get_model():
        nonlocal model
        model = model or load_model(args.model, args.device)
        return model

    t0 = time.time()
    for i, v in enumerate(voices, 1):
        r = results[v["id"]]
        expected = WHISPER_CODES.get(v["lang"], v["lang"])
        if not r["synth"]["ok"]:
            continue
        if expected not in wl or v["lang"] in ASR_UNRELIABLE:
            r["asrSkipped"] = "unsupported" if expected not in wl else "unreliable"
            continue
        old = previous["voices"].get(v["id"], {}).get("asr")
        if old and synth[v["id"]].get("cached"):
            tr = {k: old[k] for k in ("detected", "prob", "text") if k in old} | ({"forced": True} if old.get("forced") else {})
        else:
            tr = transcribe(get_model(), SAMPLES / f"{v['id']}.mp3", expected)
        r["asr"] = {**tr, "expected": expected, "cer": cer(texts[text_key(v)], tr["text"], v["lang"]), "model": args.model}
        if i % 25 == 0:
            log(f"recognized {i}/{len(voices)} ({time.time() - t0:.0f}s)")
    judge(voices, results)
    for v in voices:  # document why some languages only got audio checks
        if results[v["id"]].get("asrSkipped") == "unreliable":
            results[v["id"]]["flags"].append("asr_unsupported_language")

    # 4) confirm flagged intelligibility problems on a second, different paragraph, against same-language peers
    flagged = [v for v in voices if {"low_intelligibility", "language_mismatch"} & set(results[v["id"]].get("flags", []))]
    if flagged:
        log(f"confirming {len(flagged)} flagged voices on a second paragraph")
        texts2 = load_texts({text_key(v) for v in flagged}, second=True)
        big = get_model() if args.confirm_model == args.model else load_model(args.confirm_model, args.device)
        confirm_dir = OUT / "confirm"
        confirm_dir.mkdir(exist_ok=True)
        for v in flagged:
            expected = WHISPER_CODES.get(v["lang"], v["lang"])
            peers = [p for p in voices if p["lang"] == v["lang"] and p["id"] != v["id"] and results[p["id"]].get("status") == "verified"][:3]
            jobs2 = [(x["id"], x["id"], texts2[text_key(x)], confirm_dir / f"{x['id']}.mp3") for x in [v, *peers]]
            synth2 = asyncio.run(synthesize_all(jobs2, False, concurrency=1))

            def check(x):
                """CER on the second paragraph, or None when no recording could be made (inconclusive)."""
                if not synth2[x["id"]]["ok"]:
                    return None, {"detected": None, "prob": 0, "text": ""}
                tr = transcribe(big, confirm_dir / f"{x['id']}.mp3", expected)
                return cer(texts2[text_key(x)], tr["text"], x["lang"]), tr

            c, tr = check(v)
            peer_cers = [pc for pc in (check(p)[0] for p in peers) if pc is not None]
            peer_med = statistics.median(peer_cers) if peer_cers else None
            r = results[v["id"]]
            r["confirm"] = {"model": args.confirm_model, "text2": True, "cer": c, "detected": tr["detected"], "prob": tr["prob"], "peerCer": peer_med, "heard": tr["text"]}
            if c is None or peer_med is None:
                # Without a second recording, or without passing peers to compare
                # against, the evidence cannot separate a voice problem from a
                # recognizer problem: keep the voice and leave it for listening.
                r["flags"].append("confirmation_inconclusive")
            elif c >= 0.5 and peer_med <= 0.2:
                r["status"] = "disabled"
                r["flags"].append("confirmed_unintelligible")
            elif c <= max(0.3, peer_med + 0.2):
                r["flags"] = [f for f in r["flags"] if f not in ("low_intelligibility", "language_mismatch")]
                r["flags"].append("cleared_on_second_text")
                if not [f for f in r["flags"] if f not in INFORMATIONAL_FLAGS]:
                    r["status"] = "verified"

    # 5) multilingual capability
    def native_cer(L: str) -> float | None:
        """Median CER of verified native (non-multilingual) voices for a test language."""
        vals = []
        for v in voices:
            same = text_key(v) == L if "-" in L else v["lang"] == L
            r = results[v["id"]]
            if same and not v.get("multilingual") and r.get("status") == "verified" and r.get("asr"):
                vals.append(r["asr"]["cer"])
        return median(vals)

    native = {L: native_cer(L) for L in MULTILINGUAL_TEST_LANGS}
    multilingual: dict[str, dict] = {}
    for v in multi_voices:
        entry = multilingual[v["id"]] = {}
        for L in MULTILINGUAL_TEST_LANGS:
            key = f"{v['id']}|{L}"
            base = L.split("-")[0]
            if not synth[key]["ok"]:
                entry[L] = {"ok": False, "error": synth[key].get("error")}
                continue
            old = previous.get("multilingual", {}).get(v["id"], {}).get(L)
            if old and old.get("text") is not None and synth[key].get("cached"):
                tr = {"detected": old["detected"], "prob": old["prob"], "text": old["text"]}
            elif old and "cer" in old and synth[key].get("cached") and "text" not in old:
                entry[L] = old  # earlier run without stored transcript: keep its verdict
                continue
            else:
                tr = transcribe(get_model(), MULTI / f"{v['id']}__{L}.mp3", base)
            c = cer(texts[L], tr["text"], base)
            limit = max(0.2, (native[L] or 0) * 1.5 + 0.05)
            entry[L] = {"cer": c, "detected": tr["detected"], "prob": tr["prob"], "text": tr["text"], "nativeCer": native[L], "verified": c <= limit and same_language(base, tr["detected"])}
        log(f"multilingual {v['id']}: " + ", ".join(L for L, e in entry.items() if e.get("verified")))

    # 6) outputs
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    (OUT / "results.json").write_text(json.dumps({"generatedAt": stamp, "texts": texts, "voices": results, "multilingual": multilingual}, ensure_ascii=False, indent=1), encoding="utf-8")
    compact = {
        "generatedAt": stamp,
        "method": {"asrModel": args.model, "confirmModel": args.confirm_model, "samples": "one paragraph per voice, same content in every language"},
        "voices": {
            v["id"]: {
                "status": results[v["id"]].get("status"),
                "flags": results[v["id"]].get("flags", []),
                "cer": (results[v["id"]].get("confirm") or results[v["id"]].get("asr") or {}).get("cer"),
                "langProb": (results[v["id"]].get("asr") or {}).get("prob"),
                "lufs": (results[v["id"]].get("audio") or {}).get("lufs"),
                "maxPause": (results[v["id"]].get("audio") or {}).get("maxPause"),
                "rate": results[v["id"]].get("rate"),
            }
            for v in voices
        },
        "multilingual": {vid: sorted(L.split("-")[0] for L, e in m.items() if e.get("verified")) for vid, m in multilingual.items()},
    }
    (ROOT / "src" / "data" / "voice-quality.json").write_text(json.dumps(compact, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    write_review_html(voices, results)
    counts: dict[str, int] = {}
    for r in results.values():
        counts[r.get("status", "?")] = counts.get(r.get("status", "?"), 0) + 1
    log(f"done: {counts}")


if __name__ == "__main__":
    sys.exit(main())
