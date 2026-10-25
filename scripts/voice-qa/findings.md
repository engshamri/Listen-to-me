## Investigations behind the verdicts

These checks were run by hand (scripts in `scripts/voice-qa/`) to confirm or reject what the automated pass suggested.

### Repaired: Inuktitut (4 voices)
`iu-Cans-CA-SiqiniqNeural`, `iu-Cans-CA-TaqqiqNeural`, `iu-Latn-CA-SiqiniqNeural`, `iu-Latn-CA-TaqqiqNeural` always failed with `ValueError: Invalid voice`. The edge-tts library only accepts short ids shaped like `xx-YY-NameNeural` and rejects ids with a script subtag. Passing the service's full voice name (`Microsoft Server Speech Text to Speech Voice (iu-Cans-CA, SiqiniqNeural)`) works. `scripts/edge_synth.py` now always uses the full name, so these voices produce audio in the app for the first time. They pass the audio checks; Whisper cannot recognize Inuktitut, so their intelligibility is unmeasured.

### Disabled: unreliable synthesis (3 voices)
`da-DK-ChristelNeural`, `el-GR-AthinaNeural`, `sk-SK-LukasNeural` returned "No audio was received" for most requests. Two separate reliability runs, hours apart, each made 10 spaced attempts with the test paragraph: **0/10 and 0/10 for all three**, while another voice of the same language succeeded **10/10** each time (`da-DK-JeppeNeural`, `el-GR-NestorasNeural`, `sk-SK-ViktoriaNeural`). Short phrases occasionally succeed and length or punctuation made no consistent difference, so the problem is on the service side for these voices. They stay in the data and can be re-enabled by re-running `reliability.py` and the audit if the service recovers. Danish, Greek and Slovak each keep at least one working voice.

### Kept, flagged: intermittent synthesis
`th-TH-PremwadeeNeural` failed 10/10 in the first reliability run but succeeded 6/10 in the second (control `th-TH-NiwatNeural` 10/10 both times). It is kept available: the app retries each part up to three times, but long documents may occasionally need a manual retry.

### Kept, flagged: long pause in paragraphs
`gu-IN-DhwaniNeural` leaves a **4.55 s silence** after the second sentence of the test paragraph, reproduced in a fresh recording. Each sentence read on its own has no pause, and `gu-IN-NiranjanNeural` never pauses longer than 1.2 s on the same text. Dhwani is also noticeably slower (26.1 s versus 20.1 s for the paragraph). Kept so that Gujarati keeps a female voice; listeners should judge whether it is acceptable.

### False alarms corrected (not voice problems)
The first automated pass wrongly marked 11 more voices as failing. Each was traced to the method and fixed before the final verdicts:
- **Serbian** (`sr-RS-SophieNeural`, `sr-RS-NicholasNeural`): the recognizer transcribed correctly but in Latin script while the reference was Cyrillic. Serbian is now transliterated before comparison. Both are verified.
- **Chinese, Taiwan and Hong Kong** (`zh-TW-HsiaoChenNeural`, `zh-TW-HsiaoYuNeural`, `zh-TW-YunJheNeural`, `zh-HK-WanLungNeural`): correct transcripts in Simplified characters were compared with a Traditional reference. Text is now converted to Simplified first. Two had also been disabled because their *confirmation* recording failed to download; a failed or peer-less confirmation is now treated as inconclusive, never as proof.
- **Lao** (`lo-LA-KeomanyNeural`, `lo-LA-ChanthavongNeural`): Whisper transcribes Lao speech as Thai (the transcripts carry the right meaning in Thai script). Lao is treated as not measurable by the recognizer, so these voices receive audio checks only.
- **Maltese** (`mt-MT-GraceNeural`, `mt-MT-JosephNeural`) and **Sundanese** (`su-ID-TutiNeural`, `su-ID-JajangNeural`): auto-detection guessed Arabic and Indonesian, but recognition in the correct language matched the text (8–15 % character errors, in line with each other). A detector mix-up only counts against a voice when the correct-language transcript is also poor.
- **Shaanxi Mandarin** (`zh-CN-shaanxi-XiaoniNeural`, tagged *Dialect* by the provider) is no longer compared with standard-Mandarin voices; it passes the absolute threshold.

### Network outage during one re-run
One re-run coincided with a DNS outage (`Cannot connect to host speech.platform.bing.com`). Recordings made then (`gu-IN-DhwaniNeural`, `iu-Latn-CA-TaqqiqNeural`) were discarded and re-recorded once the connection was healthy; no verdict relies on data from the outage.
