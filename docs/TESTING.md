# Testing

| Suite | Command | Needs | What it covers |
|---|---|---|---|
| Types | `npm run typecheck` | — | Whole project, strict mode (the build no longer ignores type errors) |
| Lint | `npm run lint` | — | Next.js + React Compiler rules, unused code, hook dependencies |
| Unit | `npm test` | — | Cross-site guard and proxy-header handling, bounded rate limiter, page merging for OCR (no content dropped), OCR text tidying, chunking (no cut words, content preserved, CJK), Arabic search normalization, script detection, duration estimate, clean-up, TXT encodings (UTF-8/BOM/UTF-16/Windows-1256/binary), PDF RTL ordering and page ranges, i18n key parity and Arabic plurals, catalog integrity (minus audit-disabled voices) and flags, language categories and Arabic regions, favorites persistence, generation engine (retry, 429 back-off, resume, backup consent, abort), rate limiter, semaphore, body limits, MP3 parsing, WCAG contrast of all 19 theme blocks + System dark |
| Browser (E2E) | `npm run build && npm run test:e2e` | Edge (Windows) or `npx playwright install chromium` | Long paste keeps layout stable; old voice list gone; task order; mobile bar and no horizontal scroll; English default and Arabic RTL (server-rendered); theme gallery (19 options, hover preview, revert, persistence without flash); voice browser (group → 16 Arabic country flags → voices, breadcrumb/Back, remembered place, search with Arabic variants, filters, full-screen on phones); favorites (add/remove, Favorites view, page chips, persistence across reloads, Arabic UI); previews; TXT/PDF import incl. malformed files; scanned PDFs: OCR offer, Stop, English and Arabic recognition, mixed text/scanned documents (skip explicitly or merge in page order), no third-party requests during OCR; empty Arabic editor follows RTL; Undo; draft recovery; generation, replay without extra players, multi-part progress, cancel; axe WCAG 2.2 A/AA scans (EN, AR + dark, every browser level, PDF and OCR dialogs in EN and AR, theme gallery, 16 themes, mobile) |
| Voice audit | `.cache/voice-qa-venv/Scripts/python scripts/voice-qa/run_audit.py` then `python scripts/voice-qa/write_report.py` and `npm run catalog` | Internet, ffmpeg, faster-whisper (GPU recommended) | Every voice: audio measurements + speech-recognition intelligibility vs same-language peers; multilingual voices on 12 languages. Output: `src/data/voice-quality.json`, `docs/VOICE-QUALITY.md`, listening sheet `.cache/voice-qa/review.html` |
| Live API | start the server, then `BASE_URL=http://127.0.0.1:3000 npm run test:live` | Internet, edge-tts, ffmpeg/ffprobe | Arabic and English synthesis produce valid MP3; speed changes duration; validation (unknown voice, injection-like input, ranges, oversized bodies); explicit-only backup voice; cancellation; preview generation and caching; detection and paragraph-preserving translation; M4A has audio only; MP4 has an H.264 video track + AAC; non-MP3 uploads rejected; cross-site requests refused (403) while same-origin ones work; forged `X-Forwarded-For` does not bypass rate limits; security headers |

Set `OFFLINE=1` to skip E2E tests that need the speech service.

## Results of the last full run (2026-10-25)

Windows 11, Node 24.21, Python 3.14 with edge-tts 7.3.1, Microsoft Edge (Playwright `msedge` channel), ffmpeg 9.0.2.

| Check | Result |
|---|---|
| `npm run typecheck` · `npm run lint` · `npm run build` | clean |
| `npm test` | 115 passed |
| `npm run test:e2e` | 49 passed |
| `npm run test:live` | 25 passed |
| `npm audit` | 0 vulnerabilities |
| Multi-part assembly: a 4,550-character Arabic text (4 parts, `ar-SA-HamedNeural`, 7 min 15 s) and a 2,640-character English text (3 parts, `en-US-AndrewNeural`, 2 min 44 s) synthesized through `/api/tts` with the app's chunker and joined like the browser does | ffmpeg decodes both with no errors; joined duration equals the sum of the parts; no silence longer than 1.2 s (`silencedetect -45 dB`); Whisper large-v3 recovered 98.1 % (Arabic) and 99.2 % (English) of the source words in order, so no words are lost at part boundaries |

Integrated loudness of the provider's output is about −20 to −22 LUFS (measured with ffmpeg `ebur128`); the app does not re-normalize it.

## Listening test (subjective naturalness)

Automated tests prove the audio is valid and complete; they cannot judge how natural it sounds. Before a release, have two or three people listen with headphones:

1. **Sentences**: for each main language you support (at least Arabic and English), generate the same 3–4 sentence paragraph with two voices. Rate each 1–5 for clarity, natural rhythm and pronunciation.
2. **Part boundaries**: generate a text of about 5,000 characters (3+ parts). Listen around each part boundary: there should be no clicks, cut words, repeated words or abrupt changes in loudness.
3. **Headings and lists**: text with headings and bullet points, with *Pause at line breaks* on and off; headings should be followed by a short pause when it is on.
4. **Numbers, dates, names, mixed scripts**: e.g. "2026-10-25", "3.5%", an English product name inside Arabic text. Note mispronunciations; these are engine limitations, not app bugs, but worth documenting.
5. **Speed and pitch extremes**: 0.5× and 2×, pitch −20 and +20: speech should stay intelligible.
6. **Arabic regional voices**: the same Standard Arabic paragraph with voices from three regions should sound like Standard Arabic with different accents; a paragraph written in Iraqi or Egyptian dialect should be pronounced closer to that dialect.
7. **Backup voice** (if enabled): confirm the result lists which parts it read.

Record results in a short table (voice, test, score, notes) so regressions are visible when the provider changes its voices.
