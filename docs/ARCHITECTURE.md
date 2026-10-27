# Architecture

Listen to me is a single Next.js 16 application (React 19, App Router, TypeScript, Tailwind CSS 4). Speech synthesis talks to Microsoft Edge's read-aloud service over WebSocket from Node.js, so the server needs no Python and runs unchanged on serverless hosts such as Vercel; ffmpeg handles optional format conversion. `server.py` is a launcher only: it does not serve requests itself.

## Directory layout

```
server.py                    Local launcher (checks, installs, builds, supervises Next.js)
scripts/
  save_voices.py             Refresh src/data/voices.json from the live provider list (Python, edge-tts)
  build-voice-catalog.mjs    Enrich voices (localized names, regions, flags) → voice-catalog.json
  generate-brand-assets.mjs  Favicon, social image, MP4 video cover
  generate-donation-qr.mjs   QR codes for /support (public/donate/*.svg and *.png) from donations.json
  copy-vendor-assets.mjs     Copies pdf.js (legacy-build worker named by version, character maps,
                             standard fonts, image decoders) and the OCR engine (tesseract.js worker,
                             WebAssembly cores, Arabic/English data) into public/ (git-ignored)
  make-protected-pdfs.py     Test fixtures: the lecture PDF with a password, and owner-restricted (needs pypdf)
  old-webkit-check.mjs       PDF import in real older WebKit engines (17.4-26.0) against a running server
  live-check.mjs             End-to-end API checks against a running server (SMOKE=1: the daily subset)
  voice-qa/run_audit.py      Voice quality audit (audio checks + speech recognition) → voice-quality.json
  voice-qa/reliability.py    Repeated synthesis attempts for voices that fail intermittently
  voice-qa/apply_ratings.py  Applies human listening ratings exported from the review sheet
  voice-qa/write_report.py   docs/VOICE-QUALITY.md from the audit's raw results (+ findings.md)
src/
  app/
    layout.tsx               Reads locale/theme cookies → <html lang dir data-theme> (no flash)
    page.tsx                 Renders <Studio/>
    support/page.tsx         Donation page (localized metadata) → components/support
    library/page.tsx         My library (not indexed) → components/library
    globals.css, themes.css  Design tokens; one block per theme
    api/tts|preview|translate|convert|health/route.ts
  components/
    app/                     Header (language, theme, about), footer, About dialog, logo
    studio/                  The work area (one component per section, see below)
    library/                 Library page, player (reading mode + resume), "Continue listening", hooks
    ui/                      Accessible primitives (Radix-based), token-styled, RTL-aware
  lib/
    i18n/                    Typed dictionaries (en, ar), plural rules, formatters, provider
    theme/                   Theme list, provider, WCAG contrast helpers
    text/                    Chunking, statistics, search normalization, clean-up, line splitting,
                             word alignment for read-along (align.ts), chapter detection (chapters.ts)
    files/                   TXT decoding, PDF extraction, OCR of scanned pages, limits
    library/store.ts         Saved recordings in IndexedDB (no dependency), change notifications
    voices/                  Catalog access/filters, language categories, favorites store,
                             audit verdicts (quality.ts), preview samples, backup-voice mapping
    tts/engine.ts            Client generation engine (concurrency, retry, resume, cancel)
    tts/timeline.ts          Read-along timeline: word and sentence times across all parts
    audio/                   MP3 parsing/duration, exclusive playback, file names, SRT/WebVTT
    translate/languages.ts   Target languages, localized labels
    server/                  Config, HTTP helpers, rate limiter, semaphore, process runner,
                             speech service client (edge.ts) and its token (edge-drm.ts),
                             backup voice, translation providers, ffmpeg, health
  data/
    voices.json              Raw provider voice list (322 voices; 315 offered, see VOICE-QUALITY.md)
    voice-catalog.json       Generated, enriched catalog used by client and server
    voice-quality.json       Audit verdicts per voice + verified multilingual languages
    donations.json           Donation addresses: single source for the page, QR codes and tests
tests/
  unit/                      Vitest: text, files, i18n/catalog, engine, server utilities, themes
  e2e/                       Playwright + axe: layout, i18n/themes, voices, files, generation, a11y
```

## Studio components

| Component | Responsibility |
|---|---|
| `studio.tsx` | Owns text, settings, generation state and results; lays out sections in task order (text → voice → settings → generate → result) so visual, keyboard and screen-reader order match |
| `text-panel.tsx` | Editor, toolbar, stats, translation banner, import chip, script/voice mismatch notice |
| `file-import.tsx` | File picker, drag and drop, TXT decoding, PDF dialog: password (if any) → pages (all, one page, From/To, or several ranges) → text layer → OCR offer for image-only pages (recognize / import without them / choose pages) → progress and Stop |
| `translate-control.tsx` | Source detection, searchable target list, long-text translation |
| `voice-panel.tsx` | Selected voice (preview, favorite, clarity note), one-click favorite chips, “Browse all voices” |
| `voice-browser.tsx` | Hierarchical browser in a dialog (full-screen on phones), opening on all language groups: language group → country flag cards (Arabic grouped by accent region) → voice cards; global search, gender/style/multilingual filters, breadcrumb + Back, Favorites view; remembers where it was left |
| `preview-context.tsx` | One shared preview player for the whole app |
| `settings-panel.tsx` | Speed, pitch, pauses |
| `generate-panel.tsx` | Generate / progress / cancel / failure recovery (sticky bar on mobile) |
| `result-panel.tsx` | Player, listening speed, read-along section, metadata, downloads, subtitles, conversions, session history |
| `read-along.tsx` | `useReadAlong` (current sentence and word from the audio element) and the highlighted text view |
| `reading-mode.tsx` | Full-screen reading dialog: large text, size control, seek bar, previous/next sentence, keyboard |
| `hooks.ts` | Settings store (useSyncExternalStore + localStorage), draft autosave, health, timers |

## Generation flow

1. `splitIntoChunks` segments text with `Intl.Segmenter` (sentences, then words), preferring paragraph ends; `prepareForSpeech` adds pauses after unpunctuated lines.
2. `runJob` sends up to three chunks at a time to `POST /api/tts`, keeping results by index. Transient failures retry with back-off; HTTP 429 waits for `Retry-After`.
3. On a permanent failure, scheduling stops but finished chunks are kept. The user can **Retry** (only missing chunks are requested), **use the finished parts**, or **opt in to the backup voice** for parts that fail again.
4. Cancel aborts all requests; the route handler sees `request.signal` abort and closes its connection to the speech service.
5. Chunks are joined into one MP3 (same codec settings throughout); duration is measured from the MP3 frames.

## Study workspace

`/study` lists courses and lectures; `/study/[id]` is the workspace. It is all client-side: the PDF never reaches the server.

- **Storage** (`lib/study/store.ts`, IndexedDB `asmani-study`, separate from the library):

  | Store | Holds |
  |---|---|
  | `courses` | Course names |
  | `docs` | Lecture metadata and reading progress (last page, pages visited, completed, scanned pages) |
  | `files` | The PDF's bytes (an ArrayBuffer; lectures saved before 2026-10-27 as a Blob, still read): WebKit doesn't store Blobs in IndexedDB in every configuration |
  | `pages` | Paragraphs and saved translations, keyed `[docId, page]` |
  | `annotations` | Highlights, notes and bookmarks |
  | `glossary` | Preferred translations of terms |
  | `cards` | Flashcards with their spaced-repetition schedule and review history (version 2) |
  | `quizzes` | Quiz results with their questions and answers (version 2) |

  It uses the shared IndexedDB helpers in `lib/idb.ts`, like the library. Version 2 added `cards` and `quizzes` in place; deleting a lecture deletes its pages, notes, cards and results in one transaction.
- **Import** (`lib/study/import.ts`): pdf.js reads every page's text items in the browser, up to 600 pages. The title comes from the PDF's Title field when it is a real one (not "Untitled", a file name or a web address), otherwise from the file name.
- **Layout** (`lib/study/layout.ts`): `pageParagraphs` turns text items into paragraphs. Each paragraph keeps its box on the page (fractions of the page), which links the text panel, translations and the PDF. Kinds:
  - **heading:** larger text;
  - **list:** a marker, or a short line ending a sentence (list items drawn without bullet characters);
  - **code:** monospace fonts, with indentation rebuilt from the character width;
  - **math:** math symbols and few words;
  - **table:** three or more cells, separated by wide gaps or the wide whitespace items some producers write between cells; rows are kept as "cell | cell";
  - **text:** everything else; wrapped lines are joined and words hyphenated at line ends rejoined.

  Right-to-left lines are ordered right to left, and diacritics drawn as separate items attach to the nearest letter. Persian and Urdu letter forms that fonts often emit for Arabic (ی ک ھ) become the Arabic letters, unless the text has Persian- or Urdu-only letters. `tests/unit/study-pdf.test.ts` checks all of this on a real PDF (`tests/fixtures/lecture-enzymes.pdf`, made by `scripts/make-test-lecture.mjs`).
- **Viewer** (`components/study/pdf-viewer.tsx`):
  - **Rendering:** every page is a box of the right size. Only pages within about one screen of the visible area are drawn (canvas plus pdf.js `TextLayer` for selection, at most about 6 megapixels each); the rest are released.
  - **Current page:** the page under the upper third of the viewer.
  - **Stable position:** when page sizes change (measured, zoom, window width), the view stays on the same spot.
  - **Overlays:** highlights sit under the transparent text layer, so text can still be selected over them; search matches are marked in the text layer.
- **Translation** (`lib/study/translate.ts`):
  - **What is sent:** paragraphs (of several pages) go in requests of at most about 12,000 characters, joined with blank lines and split back afterwards. If the translator merges paragraphs, that batch is redone one paragraph at a time. Code and formulas are never sent.
  - **Glossary:** terms become `[[n]]` placeholders, which the translator leaves untouched (verified), and come back as the preferred translation, optionally with the original term in brackets.
  - **Whole lecture:** translated in groups of 8 pages, each group saved before the next; HTTP 429 waits for `Retry-After`.
- **OCR:** scanned pages use the existing on-device Tesseract engine. A new option returns paragraphs with their boxes and confidence; pages are recognized 5 at a time, saved after each group, and labelled with their confidence.
- **Consent** (`components/study/consent.tsx`): before the first translation or listening, a dialog names the service (Google Translate, Microsoft) and what is sent. The answer is kept per service in this browser and can be withdrawn on the Study page.
- **Listening** (`components/study/study-player.tsx`): the existing engine generates the audio (an Arabic voice for Arabic text, else the student's English voice). It shows the current sentence and word (`useReadAlong`), previous/next and repeat sentence, and listening speed, and can bookmark the sentence being read.
- **Ask your lecture** (`lib/study/search-index.ts`, `components/study/ask-panel.tsx`): BM25 over paragraphs (code and formulas left out), with English and Arabic stop words and light stemming on the Arabic-normalized text. A paragraph counts as found only when it contains at least half of the question's terms; otherwise the panel says "Not found in the provided material." Course scope loads the other lectures' pages from IndexedDB; their results link to `/study/[id]?page=N`. When the question's script differs from the lecture's, the question can be translated (after consent) and the translated query is shown.
- **Practice** (`lib/study/definitions.ts`, `quiz.ts`, `srs.ts`; `components/study/practice-panel.tsx`, `quiz-panel.tsx`, `flashcards.tsx`):
  - **Definitions:** sentence patterns in English ("is defined as", "refers to", "means", "is a/the …", a plural with a relative clause, "term: …") and in Arabic on the text without diacritics (يُعرَّف … بأنه, يُقصد بـ, … هو/هي, "term: …"), skipping pronoun subjects and vague openings. Each keeps its sentence, page and paragraph box.
  - **Quizzes:** built only from those definitions, so every answer and explanation is the lecture's own sentence; wrong options are other terms or definitions of the same lecture. A seeded generator (mulberry32) makes a quiz reproducible. Multiple choice needs 4 definitions, true/false 2; the panel says when fewer questions than asked could be made.
  - **Flashcards:** SM-2 scheduling (Again → 10 minutes; ease never below 1.3; new cards are due at once); one card per lecture and front (case and spacing ignored). CSV export uses Anki's `#separator`/`#columns` header lines.
  - None of this is AI, and the panels say so.
- **Backup** (`lib/study/backup.ts`): one JSON file (`format: "listen-to-me/study-backup"`, `version: 1`) with every store, and optionally the PDFs in base64 (written in pieces, so large files never become one huge string). Restoring checks the whole file first with zod (types, sizes, every page/note/card/result belonging to a lecture in the file, PDFs starting with `%PDF`) and only then writes, in one transaction; records with the same id are replaced. A lecture restored without its PDF opens with its text and asks for the file, which must have the same number of pages.
- **Security:** files must be PDFs of at most 50 MB and 600 pages; pdf.js 6 runs in its worker and has no `eval` code path; document text is always rendered as text, never as HTML.

## Read-along

The browser asks `/api/tts` for word timings with `"marks": true`. The response is then `multipart/form-data` with two parts: `audio` (the MP3) and `words` (JSON `[{ text, start, end }]`, seconds). Without `marks` the response stays plain `audio/mpeg`, so other callers are unaffected. The backup voice returns an empty `words` list.

1. **On the server**, `edge.ts` turns on `wordBoundaryEnabled` in `speech.config` and reads the `audio.metadata` frames: each `WordBoundary` event has an offset and a duration in 100 ns ticks and the word as written (XML-escaped). When the text is split into 4,096-byte pieces, each piece's times are shifted by the measured length of the audio before it.
2. **In the studio**, the text is snapshotted when generation starts, with the chunks as displayed (before `prepareForSpeech` adds pauses).
3. **`buildTimeline`** (`lib/tts/timeline.ts`) shifts each chunk's words by the running MP3 duration of the earlier chunks (`mp3DurationSeconds`; joined length equals the sum of the parts). `alignWords` (`lib/text/align.ts`) then matches each word to the next occurrence in the displayed text, looking at most 160 characters ahead and skipping words it can't find, such as the full stops added for pauses. Sentences come from the same `splitSentences` used for chunking; each runs until the next one starts. Chunks without words (backup voice) are estimated in proportion to their characters, and the timeline is marked `approximate`.
4. **`ReadAlong`** renders memoized sentence spans and splits only the current sentence into words, so very long texts stay fast. While playing, a `requestAnimationFrame` loop finds the sentence and word with a binary search (`locate`) and re-renders only when they change. The current sentence carries `aria-current`. Auto-scroll pauses for 4 s after the reader scrolls and doesn't animate with reduced motion.
5. **Reading mode** and the result panel control the same `<audio>` element, so exclusive playback still holds. Listening speed uses `playbackRate` with `preservesPitch`. Playback controls stay left-to-right in Arabic, as in media players.
6. **Subtitles** (`lib/audio/subtitles.ts`): one cue per sentence. Sentences over 84 characters are split at word times, and lines wrap at 42 characters.

## Listening while generating

When a text has several parts, "Listen now" appears as soon as the first part is ready. It opens reading mode on the finished leading parts (`contiguousPrefix`) while the rest are still being generated (`components/studio/live-listen.tsx`).

- The player holds the ready parts as one MP3 blob, and the read-along timeline is rebuilt as parts arrive.
- When more parts are ready and less than 20 s of the held audio is left, it switches to the longer blob at the same second, at the pause before the next sentence (`switchSource`). If a part only arrives as the audio ends, it switches there. If the listener reaches the end before the next part exists, playback waits and resumes when it arrives.
- Measured with real speech, a switch landed inside a 0.44 s pause between sentences and played on with a 0.08 s stall.
- **Why not MediaSource?** Streaming through MediaSource would avoid the switch, but browsers cap buffered audio at about 12 MB (around 30 minutes at 48 kbit/s), which long lectures exceed. The blob approach works the same in every browser, including iPhone Safari.

## Google voice

`google-ar` (provider `google`) uses Google Translate's free speech endpoint through `lib/server/backup-tts.ts`, the same code as the opt-in backup voice.

- **Splitting:** the endpoint reads at most about 200 characters per request. Text is split into pieces of at most 180 characters, ending at a sentence end when possible, else after a comma or semicolon, else between words. The voice pauses at the end of each request, so mid-clause cuts would sound unnatural.
- **Timings:** the pieces' MP3 frames are joined. The endpoint reports no word timings, so each word gets a time in proportion to its length within its piece (`estimatePieceWords`). The multipart response says `timing: estimated`, and the read-along timeline is marked approximate.
- **Speed and pitch:** the endpoint ignores both. The settings sliders are disabled for this voice, and the result records normal speed and pitch.
- **Failures:** there is no fallback of its own (the backup voice is the same service), so failures report `fallbackAvailable: false`.

## Speech service client

`src/lib/server/edge.ts` implements the WebSocket protocol of Microsoft Edge's read-aloud service (the one the edge-tts project documents):

1. The text is cleaned of control characters the service rejects, XML-escaped, and split into pieces of at most 4,096 bytes (at a line break or space, never inside a character or an entity).
2. Each piece opens a connection to `speech.platform.bing.com` with the browser's origin and user agent, a random `muid` cookie and a `Sec-MS-GEC` token. `edge-drm.ts` derives the token from the current five-minute window: a SHA-256 and a 64-bit checksum over Microsoft's copyright line, the window in Windows file-time ticks and the public client token. Unit tests compare it with tokens produced by edge-tts.
3. The client sends a `speech.config` message (48 kbit/s mono MP3, word boundaries on) and the SSML, then collects binary `audio` frames and `audio.metadata` word timings until `turn.end`.
4. Failures map to the API's error codes: a 403 handshake re-syncs the token clock with the server's `Date` header and retries once; a connection closed before `turn.end` is retryable; `turn.end` with no audio is `NO_AUDIO`; 45 s without any data is a stall (`TIMEOUT`); the whole request is capped by `TTS_TIMEOUT_SECONDS` (240).

When Microsoft ships a new Edge version the token scheme can change; `CHROMIUM_FULL_VERSION` and the token code in `edge-drm.ts` are the places to update. The daily workflow `.github/workflows/production-check.yml` runs `scripts/live-check.mjs` with `SMOKE=1` against the public site and opens (or comments on) an issue titled "Production check failed" when a check fails. GitHub turns off scheduled workflows in a public repository after 60 days without activity; re-enable it on the Actions tab if that happens.

## Running on Vercel

Nothing in the request path needs Python or a writable project folder. With `VERCEL=1` the server trusts Vercel's forwarding headers, caches previews in the temp folder, uses the production domain for social links, and caps `/api/convert` uploads at 4,000,000 bytes (Vercel rejects request bodies over 4.5 MB). Conversions stream their response, which Vercel does not cap. `next.config.ts` keeps `ws` and `ffmpeg-static` as external packages and traces the ffmpeg binary and the video cover into the convert function. Routes declare `maxDuration` (speech and conversion 300 s, previews and translation 60 s); preview responses carry `s-maxage` so Vercel's CDN serves repeat requests.

## Support page

`/support` lists two optional donation methods from `src/data/donations.json`: USDT on Tron (TRC20) and BTC on X Layer, received as xBTC (OKX Wrapped BTC, contract `0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f` on X Layer, chain ID 196). Each card shows the asset, the network and a wrong-network warning before the QR code and the address. The X Layer address is shown in the universal `0x` form, with OKX Wallet's `XKO` display of the same address underneath.

- The page is static: no wallet connection, no payment processing, no tracking, nothing stored. Copy uses `navigator.clipboard`; if the browser refuses, the address is selected for a manual copy and the visitor is told so.
- QR codes are generated once by `scripts/generate-donation-qr.mjs` (the `qrcode` package, a development dependency) as black-on-white SVG for display and a 1024 px PNG for download. The tile stays white in dark themes because scanners read inverted codes poorly.
- `tests/unit/donations.test.ts` pins the addresses, checks the Tron base58check checksum and the EIP-55 checksum of the X Layer address, checks that the XKO and 0x forms match, decodes every QR file with jsQR, and validates `.github/FUNDING.yml`.
- Entry points: a heart icon in the header, a footer link and a section in the About dialog. `.github/FUNDING.yml` points GitHub's Sponsor button at the page.

## PDF import and OCR

1. **Choosing a file.** The kind comes from the file's first bytes (`lib/files/kind.ts`): `%PDF-` makes a PDF whatever the name or reported type (phones often report none, or `application/octet-stream`), `.txt` or text bytes make a TXT, anything else is refused with a message. Desktop pickers filter to PDF and TXT; on touch devices the filter also allows the generic binary type, because Android and iOS pickers grey out documents whose provider reports it, so a real PDF could not be tapped. The input is cleared after each choice, so the same file can be chosen again.
2. **Opening.** `openPdf` checks the signature and size, then pdf.js opens the document in its worker. The app uses pdf.js's **legacy build**: the modern build calls the newest JavaScript built-ins without fallbacks (`Uint8Array#toHex`, `Map#getOrInsertComputed`, `Math.sumPrecise`, …), so Safari before 26.2 (any iPhone not on the latest iOS), Chrome before 145 and Firefox before 144 failed on every PDF, and the app reported it as a damaged file. The legacy build bundles polyfills for them. The worker file is named after the library version (`/pdfjs/pdf.worker-<version>.min.mjs`), so a cached worker can't pair with another version. Character maps (`cMapUrl`), standard fonts and the JBIG2/JPEG 2000 decoders (`wasmUrl`) are served from `/pdfjs/` too.
3. **Errors.** `classifyPdfError` gives each failure its own code and message (`lib/files/pdf-messages.ts`): password needed or wrong (the dialog asks for it; it stays in memory), damaged structure, a feature pdf.js can't handle, a browser without the needed built-ins, the reader failing to load, out of memory, a file the browser can't read (e.g. a cloud file not downloaded), no page readable, cancelled, unexpected. The underlying message goes to the browser console for diagnosis; the document's text never does.
4. **Pages.** All pages, a single page, a range with two number fields (From/To: the phone's number keypad is enough, no hyphen needed) or several ranges in a text field (a text keyboard, so iPhone users can type `-` and `,`). `parsePageSelection` accepts Arabic-Indic digits, the Arabic comma and any dash, sorts and de-duplicates, and refuses with a reason anything malformed, zero, reversed or past the last page; it never substitutes another range. The dialog shows the count and the pages selected.
5. `extractPdfText` reads the text layer of the selected pages one at a time, releasing each page, and returns every page, marking image-only pages as empty instead of dropping them. A page pdf.js fails on is left out and named afterwards; the others are kept. Arabic lines get Arabic letter forms and diacritics on the right letter (`orderLineItems`, shared with the study workspace).
   - **Text is read with the stream's reader** (`readTextContent`), not pdf.js's `page.getTextContent()`: that method loops over a `ReadableStream` with `for await…of`, which Safari supports only from version 27 (WebKit 26.5 in Playwright) and the legacy build doesn't polyfill. On iPhones the document opened (page count shown) and then every page failed with `TypeError: undefined is not a function (near '...t of e...')`. Reproduced and fixed in real WebKit 17.4, 18.0, 18.2 and 26.0 engines (`npm run test:old-webkit`). The study workspace's text layer already used `getReader()`.
   - **Diagnostics** (`lib/files/pdf-diagnostics.ts`): every failure records its stage (loading pdf.js, opening in the worker, loading a page, reading text, OCR) and the original exception. The dialog, the study import and the lecture viewer offer "Copy diagnostic report": the stage, error code, exception and first stack lines, pdf.js version and worker URL, app build (Vercel commit), browser and its features, file size and page count. Never the file name or document text; nothing is sent by the app.
   - **`/pdf-check`** (not indexed, linked from PDF errors): runs each stage on a sample lecture (`public/samples/pdf-check.pdf`), reads pages 1 and 5, closes, reopens and reads page 2, releases the document, and shows which stage passes or fails; a student can also test their own file (only page and character counts are shown) and copy the report.
6. If any page is empty, the dialog offers OCR for exactly those pages (OCR needs WebAssembly: without it, e.g. in iPhone Lockdown Mode, the app says so instead of starting; worker errors are caught, and an engine that hasn't started within 2 minutes is reported, never left loading). `recognizePdfPages` renders each page to a canvas with pdf.js (about 216 dpi, at most 4096 px per side), recognizes it with tesseract.js (LSTM engine, WebAssembly, in a web worker) and releases the canvas before the next page.
7. The engine files and `ara`/`eng` language data are copied from npm packages into `public/ocr` by `scripts/copy-vendor-assets.mjs` and loaded from the app's own origin (`workerPath`, `corePath`, `langPath`), with IndexedDB caching disabled. No third-party server is contacted; an E2E test asserts this.
8. Results are merged with the text-layer pages in page order (`joinPages`). Pages with mean confidence below 70 are listed for proofreading; pages where nothing was recognized are named. Limits: 50 pages per OCR run, 180 s per page; Stop terminates the worker.

## Server safeguards

| Concern | Measure |
|---|---|
| Invalid input | zod schemas; voice must exist in the catalog; rate/pitch ranges |
| Oversized requests | Streaming body reader with hard caps |
| Abuse | Sliding-window rate limits (configurable). Forwarding headers are only trusted with `TRUST_PROXY=true`; otherwise all callers share one budget. The limiter tracks at most 10,000 keys |
| Cross-site use | `crossSiteRejection`: requests a browser marks as coming from another site (`Sec-Fetch-Site` other than same-origin/none, or an `Origin` whose host differs from `Host`) get 403. Command-line clients send neither header and are allowed |
| Resource exhaustion | Semaphores for speech sessions (6) and ffmpeg (2); idle and total timeouts; cancellation |
| Command injection | ffmpeg via `spawn` with argument arrays, never a shell; speech text is XML-escaped inside SSML |
| Temp files | `mkdtemp` per request (private), always removed in `finally` |
| Path traversal | Preview cache file names come from catalog ids matching `[\w-]+` |
| Non-audio uploads | `/api/convert` checks for MP3 frame sync / ID3 before ffmpeg |
| Headers | nosniff, frame-deny, referrer policy, permissions policy, COOP, no `X-Powered-By` |

## Chapters

`lib/text/chapters.ts` finds headings line by line:

1. **Markdown** `#` to `####` headings.
2. **Keyword lines** (Chapter, Lesson, Lecture, Unit, Part, Section, Module, Week or Topic + a number, and الفصل، الدرس، المحاضرة، الوحدة، الباب، الجزء، القسم، المبحث، الموضوع، الأسبوع). They must start a block, and a longer line that ends like a sentence is not a heading.
3. **Numbered headings** ("2.1 Light") alone between blank lines.
4. **Fallback**, only when none of the above exist: short lines alone between blank lines, without sentence-ending punctuation.

Headings with only blank lines between them merge ("Part 1 · Chapter 1"). Text before the first heading becomes its own chapter when it is at least 80 characters; otherwise it is the document's title and joins the first chapter. Fewer than two chapters means no chapter UI.

- **Before generating:** the text panel shows the chapter count and a picker. The choice is stored with the exact text it was made for, so any edit resets it. `chaptersText` joins the chosen chapters in document order, and that becomes the generation snapshot.
- **In reading mode:** chapters are detected again on the recording's text. `chapterStarts` maps each one to its first sentence's start time (null when that part was not generated).

## Library

Saved recordings live in the browser's IndexedDB (database `asmani-library`), never on the server. `lib/library/store.ts` is a small promise wrapper over three object stores keyed by the item id, so the list loads without text or audio:

| Store | Holds |
|---|---|
| `items` | Title, a short excerpt, voice and settings, duration and size, listening position, bookmarks |
| `content` | The read-along timeline (text, sentence and word times) |
| `audio` | The MP3 blob |

- Every write runs in one transaction and then notifies listeners in this tab and, through a `BroadcastChannel`, in other tabs. `useLibraryItems` re-reads the list on each change.
- Saving is explicit ("Save to library") or automatic (`autoSave` setting). The first save asks for persistent storage (`navigator.storage.persist()`), so the browser is less likely to evict it. A full disk shows a clear message (`QuotaExceededError` → `QUOTA`).
- `LibraryPlayer` loads a recording, plays it in the reading mode with a hidden `<audio>` element, and starts from the saved position. `useSavePosition` writes the position every 5 s while playing and on pause, seek, end and page hide. A result in the studio does the same once it is saved.
- The main page shows "Continue listening" for the most recent recording that was started but not finished.
- **Bookmarks** are stored on the item: time (the sentence's start), the sentence's offset in the text, a short excerpt, and a note. `useBookmarks` reads them and writes each change in one transaction. From a studio result that is not saved yet, the first bookmark saves the recording. The Save button and bookmarking share one save per result. Reading mode adds a bookmark with the button or the B key (ignored while typing in a note). It reports the addition in a status line, because a toast would cover the header on phones. Notes save 0.8 s after typing stops, on blur, and when the list closes. `lib/library/notes.ts` builds the Markdown export.
- `tests/unit/library.test.ts` runs the store against `fake-indexeddb` (a development dependency only).

## Favorites

Stored in `localStorage` (`asmani:favorites`, newest first, max 100) by `lib/voices/favorites.ts`, read through `useSyncExternalStore` (safe during hydration) and synced across tabs via `storage` events. Unknown ids (e.g. a voice later disabled) are dropped on load. There are no user accounts, so favorites are per browser.

## Voice quality

`scripts/voice-qa/run_audit.py` records every voice, measures the audio with ffmpeg and transcribes it with Whisper large-v3 (faster-whisper) to compute intelligibility against same-language peers. Verdicts go to `src/data/voice-quality.json`; `npm run catalog` marks voices with a confirmed failure as unavailable. The UI shows a “Clarity verified” chip for verified voices and offers multilingual voices whose reading of Arabic passed the test. Full method and results: [VOICE-QUALITY.md](VOICE-QUALITY.md).

## Navigation

- **Header** (`components/app/app-header.tsx`): Study, My library, interface language, theme, Support and About. Below the `sm` breakpoint each control shows a short name under its icon (as wide as the name needs, at least 40 × 48 px; 10 px names below 360 px) and the logo stands for the app name, which stays in the link for screen readers. From `sm` up the compact desktop look stays, with tooltips on the icon-only buttons. Every visible name is part of the control's accessible name.
- **Back** (`components/app/back-button.tsx`) at the top of Study, My library, Support, the PDF check and flashcard review (the lecture workspace keeps its toolbar link to all lectures). `lib/nav-history.ts` records, per tab in sessionStorage, the pages shown (returning to the page before is a pop, anything else a push). Back calls `router.back()` when this tab showed another page of the app just before; otherwise it opens the page's parent (`/`, or `/study` for flashcard review), so a page opened from a bookmark or another site never leads out of the app. It is a real link to that parent, so it works before scripts load and in a new tab. Dialogs keep their own close button and Escape.

## Theming and localization

- 18 themes + System, each a CSS custom-property block (`[data-theme="…"]`) with surface, text, accent, border, focus, status, shadow and a soft background tint. Components use semantic tokens only (`bg-card`, `text-muted-foreground`, `bg-primary`, …). `tests/unit/themes.test.ts` checks 20 contrast pairs in every theme; the axe browser scan checks rendered contrast.
- The theme gallery renders each theme as a live miniature (tokens are scoped by `data-theme`, so any element can preview a theme). Pointing at or focusing a card previews it on the whole page; colors cross-fade for 300 ms only during a switch (`html.theme-transition`), and not at all with reduced motion.
- Locale and theme are cookies read by the root layout, so the first HTML byte already has the right `lang`, `dir` and `data-theme`.
- Radix components get direction from `DirectionProvider`; layout uses logical properties (`ps-*`, `start-*`), so RTL mirrors correctly.
- Numbers use Western digits in both languages (consistent with Latin labels and identical on server and client). Plurals use `Intl.PluralRules` (Arabic has six forms).
