// End-to-end API check against a running server (needs internet, and
// ffmpeg/ffprobe for the conversion checks).
//
//   npm run test:live                       # http://127.0.0.1:3000
//   BASE_URL=http://127.0.0.1:3210 npm run test:live
//   SMOKE=1 BASE_URL=https://... node scripts/live-check.mjs   # quick subset (daily production check)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const SMOKE = process.env.SMOKE === "1";
let failures = 0;
const tmp = mkdtempSync(join(tmpdir(), "asmani-live-"));

function looksLikeMp3(b) {
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  for (let i = 0; i < Math.min(b.length - 1, 4096); i++) if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) return true;
  return false;
}

async function check(name, fn, { smoke = false } = {}) {
  if (SMOKE && !smoke) return;
  const t0 = Date.now();
  try {
    const note = await fn();
    console.log(`  ok   ${name}${note ? ` — ${note}` : ""} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function tts(body, signal) {
  return fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

function ffprobe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return JSON.parse(r.stdout);
}

let arabicMp3 = null;

console.log(`Live checks against ${BASE}`);

await check("health reports capabilities", async () => {
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert(typeof h.converter === "boolean", "missing converter");
  assert(Number.isFinite(h.convertMaxBytes) && h.convertMaxBytes > 0, "missing convertMaxBytes");
  return JSON.stringify(h);
}, { smoke: true });

await check("Arabic speech (ar-IQ-RanaNeural) returns valid MP3", async () => {
  const r = await tts({ text: "مرحباً بكم في اسمعني. هذا اختبار للصوت العربي.", voice: "ar-IQ-RanaNeural", rate: "+0%", pitch: "+0Hz" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  assert(r.headers.get("x-engine") === "edge", `engine ${r.headers.get("x-engine")}`);
  const b = new Uint8Array(await r.arrayBuffer());
  assert(b.length > 5000 && looksLikeMp3(b), `bad audio (${b.length} bytes)`);
  arabicMp3 = b;
  return `${b.length} bytes`;
}, { smoke: true });

await check("English speech with speed and pitch returns valid MP3", async () => {
  const r = await tts({ text: "Hello from Listen to me. This is an English test.", voice: "en-US-AvaMultilingualNeural", rate: "+25%", pitch: "-4Hz" });
  assert(r.status === 200, `HTTP ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  assert(looksLikeMp3(b), "not MP3");
  return `${b.length} bytes`;
}, { smoke: true });

await check("word timings come with the audio (read-along)", async () => {
  const r = await tts({ text: "Read along with me. Every word arrives with its own time.", voice: "en-US-AndrewNeural", rate: "+0%", pitch: "+0Hz", marks: true });
  assert(r.status === 200, `HTTP ${r.status}`);
  assert((r.headers.get("content-type") ?? "").startsWith("multipart/form-data"), `content-type ${r.headers.get("content-type")}`);
  const form = await r.formData();
  const audio = new Uint8Array(await form.get("audio").arrayBuffer());
  const words = JSON.parse(form.get("words"));
  assert(looksLikeMp3(audio), "audio is not MP3");
  assert(words.length >= 10, `only ${words.length} words`);
  for (let i = 1; i < words.length; i++) assert(words[i].start >= words[i - 1].start, "times go backwards");
  const seconds = (audio.length * 8) / 48000; // 48 kbps constant bitrate
  assert(words.at(-1).end <= seconds + 0.5, `last word ends at ${words.at(-1).end}s, audio is ${seconds.toFixed(2)}s`);
  return `${words.length} words, "${words[0].text}" at ${words[0].start}s … "${words.at(-1).text}" ends ${words.at(-1).end}s of ${seconds.toFixed(2)}s`;
}, { smoke: true });

await check("Google Arabic voice (second free source) returns MP3 with estimated word timings", async () => {
  const text = "تُعدّ اللغة العربية من أكثر اللغات انتشاراً في العالم، إذ يتحدث بها أكثر من أربعمئة مليون إنسان. وهي إحدى اللغات الست الرسمية في الأمم المتحدة.";
  const r = await tts({ text, voice: "google-ar", marks: true });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  assert(r.headers.get("x-engine") === "google", `engine ${r.headers.get("x-engine")}`);
  const form = await r.formData();
  const audio = new Uint8Array(await form.get("audio").arrayBuffer());
  const words = JSON.parse(form.get("words"));
  assert(looksLikeMp3(audio), "audio is not MP3");
  assert(form.get("timing") === "estimated", "timings not marked as estimated");
  assert(words.length === text.split(/\s+/).length, `${words.length} words for ${text.split(/\s+/).length}`);
  for (let i = 1; i < words.length; i++) assert(words[i].start >= words[i - 1].start, "times go backwards");
  return `${audio.length} bytes, ${words.length} words, last ends at ${words.at(-1).end}s`;
}, { smoke: true });

await check("faster rate produces shorter audio", async () => {
  const text = "The quick brown fox jumps over the lazy dog. ".repeat(4);
  const slow = new Uint8Array(await (await tts({ text, voice: "en-US-GuyNeural", rate: "-30%" })).arrayBuffer());
  const fast = new Uint8Array(await (await tts({ text, voice: "en-US-GuyNeural", rate: "+60%" })).arrayBuffer());
  assert(fast.length < slow.length * 0.85, `fast ${fast.length} vs slow ${slow.length}`);
  return `slow ${slow.length} B, fast ${fast.length} B`;
});

await check("repaired Inuktitut voice (script subtag in its id) produces audio", async () => {
  const r = await tts({ text: "ᐅᓪᓛᒃᑯᑦ", voice: "iu-Cans-CA-SiqiniqNeural" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${await r.text()}`);
  const b = new Uint8Array(await r.arrayBuffer());
  assert(looksLikeMp3(b), "not MP3");
  return `${b.length} bytes`;
});

await check("voice disabled by the quality audit is rejected (400)", async () => {
  const r = await tts({ text: "Hej", voice: "da-DK-ChristelNeural" });
  assert(r.status === 400, `HTTP ${r.status}`);
});

await check("unknown voice is rejected (400)", async () => {
  const r = await tts({ text: "hi", voice: "xx-XX-Nobody", rate: "+0%" });
  assert(r.status === 400, `HTTP ${r.status}`);
});

await check("injection-looking voice is rejected (400)", async () => {
  const r = await tts({ text: "hi", voice: "ar-IQ-RanaNeural; rm -rf /" });
  assert(r.status === 400, `HTTP ${r.status}`);
});

await check("out-of-range rate is rejected (400)", async () => {
  const r = await tts({ text: "hi", voice: "ar-IQ-RanaNeural", rate: "+900%" });
  assert(r.status === 400, `HTTP ${r.status}`);
});

await check("over-long chunk is rejected (413)", async () => {
  const r = await tts({ text: "a ".repeat(3000), voice: "ar-IQ-RanaNeural" });
  assert(r.status === 413, `HTTP ${r.status}`);
});

await check("oversized body is rejected (413)", async () => {
  const r = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(200_000), voice: "ar-IQ-RanaNeural" }) });
  assert(r.status === 413, `HTTP ${r.status}`);
});

await check("backup voice only on explicit request, keeps language", async () => {
  const r = await tts({ text: "مرحبا", voice: "ar-EG-SalmaNeural", engine: "backup" });
  assert(r.status === 200 && r.headers.get("x-engine") === "backup", `HTTP ${r.status} engine ${r.headers.get("x-engine")}`);
});

await check("cancelling a request aborts it and the server keeps working", async () => {
  const ctrl = new AbortController();
  const p = tts({ text: "This request will be cancelled. ".repeat(40), voice: "en-US-GuyNeural" }, ctrl.signal);
  setTimeout(() => ctrl.abort(), 400);
  const outcome = await p.then(() => "completed", (e) => e.name);
  assert(outcome === "AbortError", `request ${outcome}`);
  const after = await tts({ text: "Still working.", voice: "en-US-GuyNeural" });
  assert(after.status === 200, `follow-up HTTP ${after.status}`);
});

await check("voice preview is generated and cached", async () => {
  const t1 = Date.now();
  const r1 = await fetch(`${BASE}/api/preview?voice=ar-SA-HamedNeural`);
  assert(r1.status === 200, `HTTP ${r1.status}`);
  const first = Date.now() - t1;
  const t2 = Date.now();
  const r2 = await fetch(`${BASE}/api/preview?voice=ar-SA-HamedNeural`);
  const b = new Uint8Array(await r2.arrayBuffer());
  assert(r2.status === 200 && looksLikeMp3(b), "bad cached preview");
  return `first ${first} ms, cached ${Date.now() - t2} ms`;
}, { smoke: true });

await check("preview for a language without a hand-written sample (Icelandic)", async () => {
  const r = await fetch(`${BASE}/api/preview?voice=is-IS-GunnarNeural`);
  assert(r.status === 200, `HTTP ${r.status}`);
});

await check("preview rejects unknown voice", async () => {
  const r = await fetch(`${BASE}/api/preview?voice=..%2F..%2Fetc%2Fpasswd`);
  assert(r.status === 400, `HTTP ${r.status}`);
});

await check("language detection", async () => {
  const r = await fetch(`${BASE}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "detect", text: "Bonjour tout le monde, comment allez-vous ?" }) });
  const d = await r.json();
  assert(d.detectedSource === "fr", `detected ${d.detectedSource}`);
  return d.detectedSource;
}, { smoke: true });

await check("translation preserves paragraphs", async () => {
  const text = "مرحبا بكم.\n\nهذه فقرة ثانية.\nوهذا سطر ثالث.";
  const r = await fetch(`${BASE}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "translate", text, source: "auto", target: "en" }) });
  const d = await r.json();
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(d.text.split("\n\n").length === 2 && d.text.split("\n").length === 4, `structure lost: ${JSON.stringify(d.text)}`);
  assert(d.detectedSource === "ar", `detected ${d.detectedSource}`);
  return JSON.stringify(d.text);
}, { smoke: true });

await check("translation rejects bad target", async () => {
  const r = await fetch(`${BASE}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "translate", text: "hi", target: "../../x" }) });
  assert(r.status === 400, `HTTP ${r.status}`);
});

for (const format of ["m4a", "mp4"]) {
  await check(`convert to ${format}`, async () => {
    assert(arabicMp3, "no MP3 from earlier check");
    const r = await fetch(`${BASE}/api/convert?format=${format}`, { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: arabicMp3 });
    if (r.status === 503) return "skipped: ffmpeg not installed";
    assert(r.status === 200, `HTTP ${r.status}`);
    const out = Buffer.from(await r.arrayBuffer());
    const file = join(tmp, `out.${format}`);
    writeFileSync(file, out);
    const info = ffprobe(file);
    if (!info) return `${out.length} bytes (ffprobe unavailable)`;
    const types = info.streams.map((s) => `${s.codec_type}:${s.codec_name}${s.width ? `@${s.width}x${s.height}` : ""}`);
    if (format === "mp4") assert(types.some((t) => t.startsWith("video:h264")), `no H.264 video track: ${types}`);
    else assert(!types.some((t) => t.startsWith("video")), `unexpected video track: ${types}`);
    assert(types.some((t) => t.startsWith("audio:aac")), `no AAC audio: ${types}`);
    return `${types.join(", ")}, ${Number(info.format.duration).toFixed(1)} s`;
  });
}

await check("convert rejects non-MP3 bodies (415)", async () => {
  const r = await fetch(`${BASE}/api/convert?format=mp4`, { method: "POST", body: new TextEncoder().encode("#!/bin/sh\necho not audio\n".repeat(50)) });
  assert(r.status === 415, `HTTP ${r.status}`);
});

await check("requests from other websites are refused (403)", async () => {
  const body = JSON.stringify({ text: "test", voice: "en-US-AvaNeural" });
  // A page on another site posting text/plain (no CORS preflight needed) is the realistic attack.
  const cross = await fetch(`${BASE}/api/tts`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" }, body });
  assert(cross.status === 403, `cross-site HTTP ${cross.status}`);
  const oldBrowser = await fetch(`${BASE}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ mode: "detect", text: "hello" }) });
  assert(oldBrowser.status === 403, `origin-only HTTP ${oldBrowser.status}`);
  const preview = await fetch(`${BASE}/api/preview?voice=en-US-AvaNeural`, { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert(preview.status === 403, `preview HTTP ${preview.status}`);
  const same = await fetch(`${BASE}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE, "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ mode: "detect", text: "hello" }) });
  assert(same.status === 200, `same-origin HTTP ${same.status}`);
}, { smoke: true });

await check("forged X-Forwarded-For does not bypass rate limits", async () => {
  // Without TRUST_PROXY every caller shares one budget, so rotating fake IPs gains nothing.
  // Detection is cheap and limited to 30/min by default: 40 requests must hit the limit.
  let limited = 0;
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${BASE}/api/translate`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.0.${i}.1` }, body: JSON.stringify({ mode: "detect", text: "" }) });
    if (r.status === 429) limited++;
  }
  assert(limited > 0, "never rate limited");
  return `${limited}/40 limited`;
});

await check("security headers present", async () => {
  const r = await fetch(`${BASE}/`);
  assert(r.headers.get("x-content-type-options") === "nosniff", "nosniff missing");
  assert(r.headers.get("x-frame-options") === "DENY", "frame options missing");
  assert(!r.headers.get("x-powered-by"), "x-powered-by exposed");
}, { smoke: true });

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll live checks passed");
process.exit(failures ? 1 : 0);
