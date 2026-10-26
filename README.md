# Listen to me · اسمعني

**Multilingual text-to-speech and translation, running on your own computer.** Type, paste or upload text (TXT, PDF, or scanned PDF through built-in OCR), translate it if you like, pick one of 322 neural voices in 75 languages, and download natural-sounding speech as MP3, M4A, or a real MP4 video.

Created and maintained by **Yousif AL_Shamri** · GitHub [@engshamri](https://github.com/engshamri) · Instagram [@mmmmn](https://www.instagram.com/mmmmn/) · [Support the project](#support-the-project)

The Arabic name اسمعني (*Asma'ni*) means “listen to me”.

> العربية: راجع [README-AR.md](README-AR.md) لدليل التشغيل الكامل باللغة العربية.

![The studio: text editor, selected voice, speech settings and a generated result](docs/screenshots/studio.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/voice-browser.png" alt="Voice browser: Arabic voices grouped by accent region with country flags"></td>
    <td width="50%"><img src="docs/screenshots/pdf-ocr.png" alt="PDF import offering text recognition (OCR) for scanned pages"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/themes-dark.png" alt="Theme gallery in the Midnight dark theme"></td>
    <td width="50%" align="center"><img src="docs/screenshots/mobile-arabic.png" alt="Arabic right-to-left interface on a phone" width="260"></td>
  </tr>
</table>

---

## Project status

Working and tested on Windows 11 (see [Testing](#testing)). Run it on your own computer with `python server.py`, or deploy it to Vercel as a demo with no configuration (see [Deploying on Vercel](#deploying-on-vercel)). Speech and translation use free, keyless public endpoints that can change or rate-limit without notice, so it is not suited to high-traffic production use. See [Limitations](#limitations).

## Features

| Area | What you get |
|---|---|
| **Editor** | Bounded, scrolling editor that stays stable with very long pasted text · character/word counts · estimated audio duration and number of parts · draft autosave and recovery after refresh · Clear with Undo · clean-up tools (tidy spaces, join PDF line breaks, remove links/emoji) · `Ctrl + Enter` to generate |
| **TXT import** | Drag and drop or file picker · UTF-8 (with or without BOM) and UTF-16 detected reliably · legacy Windows-1256 / Windows-1252 recognised and **flagged as a guess**, with a manual encoding picker · binary files rejected |
| **PDF import** | Text extracted **in the browser** (the file is never uploaded) · page count, page ranges, progress and cancel · right-to-left line ordering for Arabic/Hebrew · Arabic presentation forms normalised · clear messages for encrypted and damaged files |
| **Scanned PDFs (OCR)** | Pages without a text layer are detected and **never dropped silently**: you choose to recognize them or import without them · Tesseract OCR (Arabic, English, or both) runs **on your device** in a web worker; the engine and language data are served by this app, so no document or request goes to a third party · per-page progress, Stop, page limits and timeouts · pages with low recognition confidence are named so you can proofread them |
| **Translation** | Searchable list of 100+ target languages · automatic source detection with manual override · paragraph structure preserved · progress for long texts, cancel, Undo / restore original · suggests a matching voice afterwards |
| **Voice browser** | Hierarchical, flag-based navigation: language group (Arabic, English, European, Asian, African, Other) → country cards with SVG flags (Arabic countries grouped by accent region) → voice cards with language/accent, characteristics, preview, favorite and a clear selected state · breadcrumb and Back keep your place · search across the whole library that tolerates Arabic spelling variants (أ/ا, ة/ه, ى/ي, tashkeel) and demonyms (“Iraqi”, “عراقي”) · gender, style and multilingual filters · full-screen on phones |
| **Favorites** | Heart any voice; favorites appear as one-click chips next to the selected voice and in a Favorites view; saved in the browser, synced across tabs |
| **Voice quality** | All 322 voices audited with audio measurements, Whisper large-v3 speech recognition against same-language peers, and reliability tests: 307 verified, 10 audio-checked (languages the recognizer cannot evaluate), 2 kept with a documented flag, 3 disabled for failing most requests; 4 Inuktitut voices that never worked were repaired; verified voices carry a “Clarity verified” badge. See [docs/VOICE-QUALITY.md](docs/VOICE-QUALITY.md) |
| **Speech** | Language-aware sentence splitting (never cuts a word) · paragraph-aware chunking · pauses after headings · speed and pitch · 3 parts in parallel with ordered assembly · retries with back-off · resume from a failed part without regenerating finished parts · real cancellation (the server kills the synthesis process) |
| **Voice consistency** | No silent fallback. If the speech service fails, you choose: retry, keep the finished parts, or explicitly accept a backup voice; any part read by it is listed with the result |
| **Read-along** | While the audio plays, the sentence being read sits in a box, the word being spoken is highlighted, text already read turns dark and text still to come stays grey, so you always know where the voice is · word timings come from Microsoft's speech service itself (estimated, and marked as approximate, only for parts read by the backup voice) · click any sentence to play from there · the text follows the voice and pauses following while you scroll · **full-screen reading mode** with adjustable large text, previous/next sentence, a seek bar and keyboard control (Space, ← →, Esc) · listening speed 0.75×–2× without regenerating · **SRT and WebVTT subtitles** · Arabic right-to-left |
| **My library** | Save a recording with its text and read-along timings, or turn on automatic saving · kept **only in your browser** (IndexedDB), never uploaded · search by title (tolerant of Arabic spelling variants), rename, delete with confirmation · export the audio (MP3), the text (TXT) or subtitles (SRT) · listening opens the full-screen reading mode · **remembers where you stopped**: progress on each recording, and a “Continue listening” card on the main page |
| **Results** | One controlled player (never two sounds at once, no autoplay) · exact duration from the MP3 frames · size, voice, speed, pitch, status · MP3 download · M4A (audio-only AAC) and **MP4 video** (H.264 still cover + audio) on demand · descriptive, timestamped file names · session history (kept only in the tab) |
| **Interface** | English (default) and Arabic with full RTL · 18 themes (10 light, 8 dark) + System in a gallery of live previews; saved and server-rendered (no flash) · WCAG 2.2 AA contrast verified for every theme · responsive layout with a sticky Generate bar on phones · reduced-motion support |
| **Security** | Input validation (zod) · body-size caps · rate limits · cross-site request protection · concurrency caps for speech sessions and ffmpeg · no shell execution · private temp directories deleted after each request · security headers |

## Quick start

**Requirements:** [Node.js 20.9+](https://nodejs.org), and [Python 3.9+](https://www.python.org/downloads/) for the `server.py` launcher (the app itself needs no Python packages). Internet access is needed while generating speech or translating (OCR and PDF/TXT import work offline).

```bash
git clone https://github.com/engshamri/Listen_to_me.git
cd Listen_to_me
python server.py
```

On the first run the launcher installs the npm packages (including a copy of ffmpeg for M4A/MP4 export), builds the app, starts it on <http://localhost:3000> and opens your browser. Later runs start in seconds and rebuild only when the source changed. Stop it with `Ctrl + C`.

| Shell | Command |
|---|---|
| PowerShell | `python server.py` or `.\run.ps1` |
| Command Prompt | `python server.py` or double-click `start.bat` |
| Linux / macOS / WSL | `python3 server.py` or `./run.sh` |

Useful options:

```bash
python server.py --port 8080      # another port (a busy port is skipped automatically)
python server.py --host 0.0.0.0   # reachable from phones/other PCs on your network
python server.py --dev            # development mode with hot reload
python server.py --rebuild        # force a fresh production build
python server.py --check          # only check the environment
python server.py --help
```

### ffmpeg

M4A and MP4 export use ffmpeg from your `PATH` if present, otherwise the copy that `npm install` downloads (the `ffmpeg-static` package). Only if that download is blocked do you need to install it yourself:

- Windows: `winget install Gyan.FFmpeg` (then open a new terminal)
- macOS: `brew install ffmpeg`
- Debian/Ubuntu/WSL: `sudo apt install ffmpeg`

### Manual setup (without the launcher)

```bash
npm install          # also copies the pdf.js and OCR engine files into public/
npm run build
npm start            # http://localhost:3000
# or: npm run dev    # development server
```

## Configuration

Everything works without configuration. To change defaults, copy `.env.example` to `.env.local`. Available settings: site URL for social previews, the ffmpeg path, speech timeout, concurrency, the conversion size limit, rate limits, the translation provider (Google's free endpoint or a self-hosted [LibreTranslate](https://libretranslate.com)), whether the opt-in backup voice is offered, and `TRUST_PROXY` for deployments behind a reverse proxy.

## Deploying on Vercel

Import the repository in Vercel (**Add New → Project**). The Next.js preset, `npm install` and `npm run build` are detected automatically, and no environment variables are required.

What works on Vercel:

- **Speech** for every voice: the app talks to Microsoft's read-aloud service directly from Node.js, so no Python is needed on the server.
- **Voice previews**, cached in the function's temp folder and by Vercel's CDN until the next deployment.
- **Translation**, plus TXT/PDF import and OCR, which run in the visitor's browser.
- **M4A and MP4 export** with the ffmpeg binary that `npm install` downloads during the build. Vercel caps uploads to a function at 4.5 MB, so recordings up to about 4 MB of MP3 (roughly 11 minutes) can be converted; longer ones show a message and stay available as MP3. Converted files are streamed back, so their size is not capped.

Applied automatically when the `VERCEL` variable is present:

| Setting | On Vercel |
|---|---|
| Proxy headers (`TRUST_PROXY`) | Trusted: Vercel sets `X-Forwarded-For` itself, so rate limits apply per visitor |
| Preview cache (`PREVIEW_CACHE_DIR`) | System temp folder (the rest of the file system is read-only) |
| Social preview links (`SITE_URL`) | The project's production domain |
| Conversion size (`CONVERT_MAX_BYTES`) | 4,000,000 bytes |
| Function time limits | Speech and conversion up to 300 s, previews and translation 60 s (needs Fluid compute, the default for new projects; enable it under **Settings → Functions** on older ones) |

Things to know for a public demo: rate limits are kept in memory per function instance, and every visitor shares Microsoft's and Google's free endpoints, which may slow down or refuse requests from busy data-center addresses. Set `SITE_URL` if you add a custom domain.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development, production build, production server |
| `npm run lint` · `npm run typecheck` | ESLint and TypeScript checks (both run clean; the build does not ignore errors) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright + axe accessibility scans). Uses installed Microsoft Edge on Windows; elsewhere run `npx playwright install chromium` once |
| `npm run test:live` | End-to-end API checks against a running server (`BASE_URL=...`) |
| `npm run voices:refresh` | Re-download the provider's voice list and rebuild the catalog (needs `python -m pip install -r requirements.txt`) |
| `scripts/voice-qa/run_audit.py` | Voice quality audit (see docs/VOICE-QUALITY.md; needs its own venv: `pip install -r scripts/voice-qa/requirements.txt`, a GPU recommended) |
| `node scripts/generate-brand-assets.mjs` | Regenerate favicon, social image and video cover |
| `node scripts/generate-donation-qr.mjs` | Regenerate the donation QR codes from `src/data/donations.json` (then run `npm test`, which decodes them) |

## Architecture (short)

```
python server.py  (launcher: checks, installs, builds, supervises Next.js)

Browser (React 19, Next.js App Router)
  ├─ Editor, TXT/PDF import (pdf.js worker), OCR (tesseract.js worker), translation UI
  ├─ Voice library (static catalog + /api/preview)
  ├─ Generation engine: chunk → POST /api/tts ×N (3 in parallel) → join MP3
  └─ Read-along: word timings per part → one timeline → highlighted text, reading mode, subtitles
Next.js route handlers (Node.js)
  ├─ /api/tts        → Microsoft Edge read-aloud service over WebSocket (audio + word timings) | opt-in backup voice
  ├─ /api/preview    → cached sample per voice (.cache/previews, or the temp dir on Vercel)
  ├─ /api/translate  → Google Translate (free endpoint) or LibreTranslate
  ├─ /api/convert    → ffmpeg (system or bundled): M4A audio or MP4 video
  └─ /api/health     → what this installation supports
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

All of the following were run on Windows 11 (Node 24, Microsoft Edge, ffmpeg 9) on 2026-10-26, with the server started without Python. Commands and coverage: [docs/TESTING.md](docs/TESTING.md).

| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | clean, no errors or warnings |
| `npm test` (unit, incl. the speech client against a mock service, read-along alignment, the library store and the donation address/QR checks) | 172 passed |
| `npm run test:e2e` (browser, incl. axe WCAG 2.2 A/AA scans, live generation, read-along, library, OCR) | 80 passed |
| `npm run test:live` (API against a running server, real speech/translation/ffmpeg, word timings) | 26 passed |
| Multi-part audio check (4-part Arabic, 3-part English): decoded with ffmpeg, transcribed with Whisper large-v3 | no decode errors, no gaps > 1.2 s at part boundaries, 98.1 % / 99.2 % of source words recovered in order |
| Vercel mode (`VERCEL=1`, no system ffmpeg) | bundled ffmpeg found, 4 MB conversion limit enforced, conversions streamed, previews cached in the temp folder |
| `npm audit` | 0 vulnerabilities |

Automated tests cannot judge how natural a voice sounds; docs/TESTING.md includes a short listening protocol for that.

A GitHub Actions workflow (`.github/workflows/production-check.yml`) runs a short version of the live checks against the public site every day and opens an issue if speech, translation or the security checks fail. This is the early warning for the day Microsoft changes its connection token.

## Privacy

- To create audio, text is sent to Microsoft's Edge text-to-speech service; translation sends text to Google Translate (or your LibreTranslate server). The interface says so next to the Generate button and in **About → Privacy**.
- TXT and PDF files are read in the browser and never uploaded. OCR also runs in the browser.
- The server keeps no copies of text or audio: each request uses a private temporary folder that is deleted when it finishes. Only voice previews (fixed sample sentences) are cached.
- Drafts, settings, theme and language live in your browser (local storage / cookies). Recordings you save to **My library** are stored in your browser's IndexedDB; clearing the site's data in the browser deletes them.

## Security notes

- Every API input is validated; voices must exist in the catalog; speed/pitch are range-checked.
- Request bodies are capped (`/api/tts` 64 KB, `/api/translate` 256 KB, `/api/convert` 60 MB, 4 MB on Vercel) and rate-limited.
- **Cross-site protection:** requests that browsers mark as coming from another website (`Sec-Fetch-Site`, `Origin`) are refused with 403, so a web page you visit cannot use your local server.
- **Proxy headers are not trusted by default:** without `TRUST_PROXY=true`, `X-Forwarded-For` is ignored (it could be forged to dodge rate limits) and all callers share one budget. Behind a reverse proxy that sets these headers, enable `TRUST_PROXY` for per-client limits (on Vercel this is the default).
- ffmpeg runs with argument arrays (never a shell), with timeouts, concurrency caps and cancellation. Speech sessions are capped too, fail after 45 s without data, and close when the request is cancelled.
- `/api/convert` only accepts MP3 data; uploaded documents never reach the server.
- PDF and OCR work have size, page-count and per-page time limits (50 MB, 500 pages per extraction, 50 pages per OCR run).
- The rate limiter is in memory (bounded): suitable for one local or single-instance deployment; use a shared store for several instances.

## Limitations

- **Free, keyless endpoints.** Speech uses Microsoft Edge's read-aloud service (the protocol documented by the edge-tts project, implemented here in Node.js); its connection token changes when Microsoft updates Edge, and the app then needs an update too; translation uses Google Translate's web endpoint. They are not official, paid APIs: they can be slow, rate-limited, or change without notice. For a public, high-traffic deployment, use an official provider.
- **Voices are synthetic** and translations are machine-generated; neither is guaranteed to be perfect.
- **Arabic regional voices** add an accent; they do not convert Modern Standard Arabic into a dialect. Only two voices in the catalog are tagged by the provider as dialect voices (Liaoning and Shaanxi Mandarin).
- **Coverage** is what the provider offers today: 322 voices, 75 languages (checked against the live list on 2026-10-25; no voices were added or removed upstream). The 12 multilingual voices can read many more languages, with varying quality.
- **OCR** ships with Arabic and English language data only. Accuracy depends on scan quality; recognized text should be proofread. It runs at a few seconds per page on a typical laptop.
- **On Vercel**, conversion to M4A/MP4 is limited to about 11 minutes of audio, and rate limits are per function instance. See [Deploying on Vercel](#deploying-on-vercel).
- **Backup voice** (opt-in) speaks with a single generic voice per language and ignores speed and pitch.
- **Development tooling:** ESLint stays on 9.x (in upstream maintenance) because plugins bundled with Next.js 16's lint config (`import`, `jsx-a11y`, `react`) do not yet support ESLint 10. It is a development-only tool with no known vulnerability.

## Troubleshooting

| Problem | Fix |
|---|---|
| `python` is not recognised | Reinstall Python and tick **Add python.exe to PATH**, or use `py server.py` |
| `Node.js is not installed` | Install the LTS version from nodejs.org and open a new terminal |
| M4A/MP4 buttons are disabled | Run `npm install` again (it downloads ffmpeg), or install ffmpeg and restart |
| “Too long to convert on this server” (Vercel) | Vercel accepts uploads up to 4.5 MB (about 11 minutes of MP3). Download the MP3, or run the app locally |
| Port 3000 is busy | The launcher picks the next free port automatically, or use `--port 8080` |
| “The speech service didn't respond” | Check your internet connection and press **Retry**; finished parts are kept. Microsoft's free service sometimes slows down or drops connections under load |
| Strange characters after importing a TXT | Choose another encoding in the file bar above the editor |
| PDF import or OCR does nothing after a manual install | Run `npm install` (or `node scripts/copy-vendor-assets.mjs`) to copy the engine files into `public/` |
| API calls return 403 behind a reverse proxy | Set `TRUST_PROXY=true` so the public host name from `X-Forwarded-Host` is used |
| PowerShell blocks `run.ps1` | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`, or just run `python server.py` |

## Support the project

Listen to me is free, with no ads and no sign-up. Donations are optional and help pay for development, for maintenance when the speech and translation services change, and for hosting. They are direct wallet transfers: the website doesn't process payments, never asks for private keys or seed phrases, and never connects to a wallet.

**Donation page:** <https://listen-to-me-shamri.vercel.app/support> (addresses, QR codes and step-by-step help, in English and Arabic)

| Asset | Network | Receiving address |
|---|---|---|
| USDT (Tether) | Tron (TRC20) | `TLXRM9ZjDxtk6uEuMiKe3Ek8sHC8SQR845` |
| BTC, received as xBTC (OKX Wrapped BTC) | X Layer (by OKX) | `0x63223abFd548A93b04975b217E2f007be0cf4CFA`<br>OKX Wallet's XKO format of the same address: `XKO63223abFd548A93b04975b217E2f007be0cf4CFA` |

> **Use exactly the network shown.** USDT sent on any network other than Tron (TRC20), or BTC sent on the Bitcoin network or any network other than X Layer, will not arrive and can't be recovered. The BTC address is an X Layer address, **not** a Bitcoin address: from OKX, withdraw BTC and choose the X Layer network (it arrives as xBTC).

## Contact

- Bug reports and questions: [GitHub Issues](https://github.com/engshamri/Listen_to_me/issues)
- Maintainer: Yousif AL_Shamri ([@engshamri](https://github.com/engshamri) on GitHub, [@mmmmn](https://www.instagram.com/mmmmn/) on Instagram)

## License

Copyright © 2026 Yousif AL_Shamri. **All rights reserved.** This repository is public so the code can be viewed; it is **not** released under an open-source license. No permission is granted to copy, modify, distribute or use it commercially without prior written permission from the copyright holder. See [LICENSE](LICENSE).

Third-party components keep their own licenses (Next.js, React, pdf.js, tesseract.js and its language data, ws, ffmpeg-static, flag-icons, Radix UI, and others). Notices for work this project builds on are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
