# Architecture

Listen to me is a single Next.js 16 application (React 19, App Router, TypeScript, Tailwind CSS 4). Speech synthesis runs through a small Python script using the `edge-tts` package; ffmpeg handles optional format conversion. `server.py` is a launcher only: it does not serve requests itself.

## Directory layout

```
server.py                    Local launcher (checks, installs, builds, supervises Next.js)
scripts/
  edge_synth.py              One synthesis request → MP3 (exit codes classify failures)
  save_voices.py             Refresh src/data/voices.json from the live provider list
  build-voice-catalog.mjs    Enrich voices (localized names, regions, flags) → voice-catalog.json
  generate-brand-assets.mjs  Favicon, social image, MP4 video cover
  copy-vendor-assets.mjs     Copies the pdf.js worker and the OCR engine (tesseract.js worker,
                             WebAssembly cores, Arabic/English data) into public/ (git-ignored)
  live-check.mjs             End-to-end API checks against a running server
  voice-qa/run_audit.py      Voice quality audit (audio checks + speech recognition) → voice-quality.json
  voice-qa/write_report.py   docs/VOICE-QUALITY.md from the audit's raw results
src/
  app/
    layout.tsx               Reads locale/theme cookies → <html lang dir data-theme> (no flash)
    page.tsx                 Renders <Studio/>
    globals.css, themes.css  Design tokens; one block per theme
    api/tts|preview|translate|convert|health/route.ts
  components/
    app/                     Header (language, theme, about), footer, About dialog, logo
    studio/                  The work area (one component per section, see below)
    ui/                      Accessible primitives (Radix-based), token-styled, RTL-aware
  lib/
    i18n/                    Typed dictionaries (en, ar), plural rules, formatters, provider
    theme/                   Theme list, provider, WCAG contrast helpers
    text/                    Chunking, statistics, search normalization, clean-up, line splitting
    files/                   TXT decoding, PDF extraction, OCR of scanned pages, limits
    voices/                  Catalog access/filters, language categories, favorites store,
                             audit verdicts (quality.ts), preview samples, backup-voice mapping
    tts/engine.ts            Client generation engine (concurrency, retry, resume, cancel)
    audio/                   MP3 parsing/duration, exclusive playback, file names
    translate/languages.ts   Target languages, localized labels
    server/                  Config, HTTP helpers, rate limiter, semaphore, process runner,
                             Edge/backup synthesis, translation providers, ffmpeg, health
  data/
    voices.json              Raw provider voice list (322 voices)
    voice-catalog.json       Generated, enriched catalog used by client and server
    voice-quality.json       Audit verdicts per voice + verified multilingual languages
tests/
  unit/                      Vitest: text, files, i18n/catalog, engine, server utilities, themes
  e2e/                       Playwright + axe: layout, i18n/themes, voices, files, generation, a11y
```

## Studio components

| Component | Responsibility |
|---|---|
| `studio.tsx` | Owns text, settings, generation state and results; lays out sections in task order (text → voice → settings → generate → result) so visual, keyboard and screen-reader order match |
| `text-panel.tsx` | Editor, toolbar, stats, translation banner, import chip, script/voice mismatch notice |
| `file-import.tsx` | File picker, drag and drop, TXT decoding, PDF dialog: page range → text layer → OCR offer for image-only pages (recognize / import without them / choose pages) → progress and Stop |
| `translate-control.tsx` | Source detection, searchable target list, long-text translation |
| `voice-panel.tsx` | Selected voice (preview, favorite, clarity note), one-click favorite chips, “Browse all voices” |
| `voice-browser.tsx` | Hierarchical browser in a dialog (full-screen on phones): language group → country flag cards (Arabic grouped by accent region) → voice cards; global search, gender/style/multilingual filters, breadcrumb + Back, Favorites view; remembers where it was left |
| `preview-context.tsx` | One shared preview player for the whole app |
| `settings-panel.tsx` | Speed, pitch, pauses |
| `generate-panel.tsx` | Generate / progress / cancel / failure recovery (sticky bar on mobile) |
| `result-panel.tsx` | Player, metadata, downloads, conversions, session history |
| `hooks.ts` | Settings store (useSyncExternalStore + localStorage), draft autosave, health, timers |

## Generation flow

1. `splitIntoChunks` segments text with `Intl.Segmenter` (sentences, then words), preferring paragraph ends; `prepareForSpeech` adds pauses after unpunctuated lines.
2. `runJob` sends up to three chunks at a time to `POST /api/tts`, keeping results by index. Transient failures retry with back-off; HTTP 429 waits for `Retry-After`.
3. On a permanent failure, scheduling stops but finished chunks are kept. The user can **Retry** (only missing chunks are requested), **use the finished parts**, or **opt in to the backup voice** for parts that fail again.
4. Cancel aborts all requests; the route handler sees `request.signal` abort and kills the Python process.
5. Chunks are joined into one MP3 (same codec settings throughout); duration is measured from the MP3 frames.

## PDF import and OCR

1. `openPdf` checks the signature and size, then pdf.js (in its worker) opens the document; passwords and damage give specific errors.
2. `extractPdfText` reads the text layer of the selected pages and returns every page, marking image-only pages as empty instead of dropping them.
3. If any page is empty, the dialog offers OCR for exactly those pages. `recognizePdfPages` renders each page to a canvas with pdf.js (about 216 dpi, at most 4096 px per side), recognizes it with tesseract.js (LSTM engine, WebAssembly, in a web worker) and releases the canvas before the next page.
4. The engine files and `ara`/`eng` language data are copied from npm packages into `public/ocr` by `scripts/copy-vendor-assets.mjs` and loaded from the app's own origin (`workerPath`, `corePath`, `langPath`), with IndexedDB caching disabled. No third-party server is contacted; an E2E test asserts this.
5. Results are merged with the text-layer pages in page order (`joinPages`). Pages with mean confidence below 70 are listed for proofreading; pages where nothing was recognized are named. Limits: 50 pages per OCR run, 180 s per page; Stop terminates the worker.

## Server safeguards

| Concern | Measure |
|---|---|
| Invalid input | zod schemas; voice must exist in the catalog; rate/pitch ranges |
| Oversized requests | Streaming body reader with hard caps |
| Abuse | Sliding-window rate limits (configurable). Forwarding headers are only trusted with `TRUST_PROXY=true`; otherwise all callers share one budget. The limiter tracks at most 10,000 keys |
| Cross-site use | `crossSiteRejection`: requests a browser marks as coming from another site (`Sec-Fetch-Site` other than same-origin/none, or an `Origin` whose host differs from `Host`) get 403. Command-line clients send neither header and are allowed |
| Resource exhaustion | Semaphores for Python (6) and ffmpeg (2); timeouts; cancellation |
| Command injection | `spawn` with argument arrays, never a shell; text passed via temp file |
| Temp files | `mkdtemp` per request (private), always removed in `finally` |
| Path traversal | Preview cache file names come from catalog ids matching `[\w-]+` |
| Non-audio uploads | `/api/convert` checks for MP3 frame sync / ID3 before ffmpeg |
| Headers | nosniff, frame-deny, referrer policy, permissions policy, COOP, no `X-Powered-By` |

## Favorites

Stored in `localStorage` (`asmani:favorites`, newest first, max 100) by `lib/voices/favorites.ts`, read through `useSyncExternalStore` (safe during hydration) and synced across tabs via `storage` events. Unknown ids (e.g. a voice later disabled) are dropped on load. There are no user accounts, so favorites are per browser.

## Voice quality

`scripts/voice-qa/run_audit.py` records every voice, measures the audio with ffmpeg and transcribes it with Whisper large-v3 (faster-whisper) to compute intelligibility against same-language peers. Verdicts go to `src/data/voice-quality.json`; `npm run catalog` marks voices with a confirmed failure as unavailable. The UI shows a “Clarity verified” chip for verified voices and offers multilingual voices whose reading of Arabic passed the test. Full method and results: [VOICE-QUALITY.md](VOICE-QUALITY.md).

## Theming and localization

- 18 themes + System, each a CSS custom-property block (`[data-theme="…"]`) with surface, text, accent, border, focus, status, shadow and a soft background tint. Components use semantic tokens only (`bg-card`, `text-muted-foreground`, `bg-primary`, …). `tests/unit/themes.test.ts` checks 20 contrast pairs in every theme; the axe browser scan checks rendered contrast.
- The theme gallery renders each theme as a live miniature (tokens are scoped by `data-theme`, so any element can preview a theme). Pointing at or focusing a card previews it on the whole page; colors cross-fade for 300 ms only during a switch (`html.theme-transition`), and not at all with reduced motion.
- Locale and theme are cookies read by the root layout, so the first HTML byte already has the right `lang`, `dir` and `data-theme`.
- Radix components get direction from `DirectionProvider`; layout uses logical properties (`ps-*`, `start-*`), so RTL mirrors correctly.
- Numbers use Western digits in both languages (consistent with Latin labels and identical on server and client). Plurals use `Intl.PluralRules` (Arabic has six forms).
