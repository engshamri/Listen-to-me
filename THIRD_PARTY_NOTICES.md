# Third-party notices

Listen to me is © Yousif AL_Shamri, all rights reserved (see [LICENSE](LICENSE)). It depends on the open-source packages listed in `package.json` (and, for maintenance scripts only, `requirements.txt`), each under its own license. This file records the notices for work this project's own code builds on.

## msedge-tts (MIT License)

`src/lib/server/edge-drm.ts` computes the Sec-MS-GEC version 2 checksum with the multiplier constants and word-pair structure published in [msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS).

```
MIT License

Copyright (c) 2023 Migushthe2nd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## edge-tts (reference only)

`src/lib/server/edge.ts` speaks the same WebSocket protocol as [edge-tts](https://github.com/rany2/edge-tts) (LGPLv3), which documents Microsoft Edge's read-aloud service and served as the reference for its message formats. No edge-tts code is included in the app. The expected tokens in `tests/unit/edge.test.ts` were produced by running edge-tts 7.3.1. The maintenance scripts in `scripts/` (`save_voices.py`, `voice-qa/`) use edge-tts as an installed Python package.

## ffmpeg

M4A and MP4 export run ffmpeg as a separate program: the one on the system `PATH`, or else the static build that the optional [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) npm package downloads at install time. Those builds are licensed under the GPL; see the license files the package installs next to the binary. No ffmpeg binary is stored in this repository.
