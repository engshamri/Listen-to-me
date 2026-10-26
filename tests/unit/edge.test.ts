import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import {
  buildSsml,
  EdgeError,
  edgeDate,
  escapeXml,
  fullVoiceName,
  parseBinaryFrame,
  parseWordBoundaries,
  removeIncompatibleCharacters,
  splitByBytes,
  synthesizeEdge,
} from "@/lib/server/edge";
import { adjustClockSkew, SEC_MS_GEC_VERSION, secMsGec, secMsGecAt } from "@/lib/server/edge-drm";

describe("Sec-MS-GEC token", () => {
  // Produced by edge-tts 7.3.1: generate_sec_ms_gec_v2(unix_timestamp=t).
  const golden: [number, string][] = [
    [0, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
    [299.9, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
    [300, "F7535A20A262E331-28675BF85C7106BBF20035A78FCB0B6890813EAD5C3B983EF3424931B720BABB"],
    [1700000000, "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2"],
    [1792970000.5, "0F30EF816944A090-9C545259BEFCA63321448A4DEFF7EDBD99C80844E313A865E2B1108FFA8513CD"],
    [1792970299, "1ADCC4AD63D17A68-1D4F513D3B0A6FCB30F02530A8317AF4BFDFD1DCB7FF847CB76A3EBC7C263F05"],
    [2000000000, "2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E"],
    [4102444800, "DD230DB44FEE2FD7-DA0D4FA797866E36C992FABB81DD2F9DB37EB74D675D63228277003DCD3F9F8C"],
  ];

  it.each(golden)("matches edge-tts for t=%s", (t, token) => {
    expect(secMsGecAt(t)).toBe(token);
  });

  it("uses the current window and the matching version string", () => {
    expect(secMsGec()).toBe(secMsGecAt(Date.now() / 1000));
    expect(SEC_MS_GEC_VERSION).toMatch(/^2-\d+\.\d+\.\d+\.\d+$/);
  });

  it("follows the server clock only when its Date header is valid", () => {
    expect(adjustClockSkew(undefined)).toBe(false);
    expect(adjustClockSkew("not a date")).toBe(false);
    expect(adjustClockSkew(new Date().toUTCString())).toBe(true);
    expect(secMsGec()).toBe(secMsGecAt(Date.now() / 1000));
  });
});

describe("speech request helpers", () => {
  it("builds the service's full voice name, including script and region subtags", () => {
    expect(fullVoiceName("en-US-AvaMultilingualNeural")).toBe("Microsoft Server Speech Text to Speech Voice (en-US, AvaMultilingualNeural)");
    expect(fullVoiceName("iu-Cans-CA-SiqiniqNeural")).toBe("Microsoft Server Speech Text to Speech Voice (iu-Cans-CA, SiqiniqNeural)");
    expect(fullVoiceName("zh-CN-shaanxi-XiaoniNeural")).toBe("Microsoft Server Speech Text to Speech Voice (zh-CN-shaanxi, XiaoniNeural)");
  });

  it("escapes XML and removes characters the service rejects", () => {
    expect(escapeXml(`Tom & Jerry <3 > "q" 'a'`)).toBe(`Tom &amp; Jerry &lt;3 &gt; "q" 'a'`);
    expect(removeIncompatibleCharacters("a\u000bb\u0001c\nd\re\tf")).toBe("a b c\nd\re\tf");
  });

  it("formats the timestamp like Microsoft Edge", () => {
    expect(edgeDate(new Date(Date.UTC(2026, 9, 26, 1, 2, 3)))).toBe("Mon Oct 26 2026 01:02:03 GMT+0000 (Coordinated Universal Time)");
  });

  it("wraps text in SSML with the voice and prosody", () => {
    const ssml = buildSsml("ar-SA-HamedNeural", "+10%", "-5Hz", "مرحبا &amp; أهلاً");
    expect(ssml).toContain("<voice name='Microsoft Server Speech Text to Speech Voice (ar-SA, HamedNeural)'>");
    expect(ssml).toContain("<prosody pitch='-5Hz' rate='+10%' volume='+0%'>مرحبا &amp; أهلاً</prosody>");
  });

  it("reads word boundaries from metadata in seconds, unescaped, ignoring other events", () => {
    const body = JSON.stringify({
      Metadata: [
        { Type: "WordBoundary", Data: { Offset: 4_625_000, Duration: 1_000_000, text: { Text: "&amp;", Length: 5, BoundaryType: "WordBoundary" } } },
        { Type: "SentenceBoundary", Data: { Offset: 0, Duration: 5, text: { Text: "x" } } },
        { Type: "SessionEnd", Data: {} },
      ],
    });
    expect(parseWordBoundaries(body)).toEqual([{ text: "&", start: 0.4625, end: 0.5625 }]);
  });

  it("parses binary frames: 2-byte header length, headers, payload", () => {
    const head = Buffer.from("X-RequestId:abc\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(head.length);
    const { headers, payload } = parseBinaryFrame(Buffer.concat([len, head, Buffer.from([1, 2, 3])]));
    expect(headers).toMatchObject({ Path: "audio", "Content-Type": "audio/mpeg" });
    expect([...payload]).toEqual([1, 2, 3]);
    expect(() => parseBinaryFrame(Buffer.from([0, 50, 1]))).toThrow();
  });
});

describe("splitting text for the service's 4096-byte limit", () => {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  it("keeps every word, in order, within the limit (Arabic is 2 bytes per letter)", () => {
    const text = Array.from({ length: 400 }, (_, i) => `الجملة رقم ${i} في نص عربي طويل.`).join(" ");
    const pieces = splitByBytes(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(bytes(p)).toBeLessThanOrEqual(4096);
    expect(pieces.join(" ")).toBe(text);
  });

  it("prefers line breaks to spaces", () => {
    const para = "word ".repeat(150).trim();
    const pieces = splitByBytes(`${para}\n${para}`, 1000);
    expect(pieces[0]).toBe(para);
  });

  it("never cuts a character when there is no whitespace", () => {
    const pieces = splitByBytes("ب".repeat(5000), 4095);
    for (const p of pieces) {
      expect(bytes(p)).toBeLessThanOrEqual(4095);
      expect(p).not.toContain("�");
    }
    expect(pieces.join("")).toBe("ب".repeat(5000));
  });

  it("never cuts an XML entity", () => {
    // 4,098 bytes: the byte limit falls inside "&amp;", so the cut moves to its "&".
    const pieces = splitByBytes(`${"a".repeat(4092)}&amp;b`, 4096);
    expect(pieces).toEqual(["a".repeat(4092), "&amp;b"]);
  });
});

describe("speech session against a local mock service", () => {
  type Behavior = (ws: WebSocket, ssml: string) => void;
  let server: WebSocketServer;
  let behavior: Behavior;
  let rejectNext: { status: number; date?: string } | null = null;
  let connections = 0;

  const audioFrame = (bytes: number) => {
    const head = Buffer.from("Content-Type:audio/mpeg\r\nPath:audio\r\n");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(head.length);
    return Buffer.concat([len, head, Buffer.alloc(bytes, 7)]);
  };
  const text = (path: string) => `X-RequestId:x\r\nPath:${path}\r\n\r\n{}`;
  /** Real MPEG-2 Layer III frames (24 kHz, 48 kbps, mono: 144 bytes, 24 ms each), so durations can be measured. */
  const mp3Frames = (count: number) => {
    const frame = Buffer.concat([Buffer.from([0xff, 0xf3, 0x64, 0xc4]), Buffer.alloc(140)]);
    const head = Buffer.from("Content-Type:audio/mpeg\r\nPath:audio\r\n");
    const len = Buffer.alloc(2);
    len.writeUInt16BE(head.length);
    return Buffer.concat([len, head, ...Array.from({ length: count }, () => frame)]);
  };
  const wordEvent = (word: string, startSec: number, durSec: number) =>
    `X-RequestId:x\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n` +
    JSON.stringify({ Metadata: [{ Type: "WordBoundary", Data: { Offset: startSec * 1e7, Duration: durSec * 1e7, text: { Text: word, Length: word.length, BoundaryType: "WordBoundary" } } }] });

  beforeAll(async () => {
    server = new WebSocketServer({
      port: 0,
      verifyClient: (_info, done) => {
        connections++;
        if (rejectNext) {
          const r = rejectNext;
          rejectNext = null;
          return done(false, r.status, "rejected", r.date ? { Date: r.date } : {});
        }
        done(true);
      },
    });
    server.on("connection", (ws) => {
      ws.on("message", (data) => {
        const msg = data.toString();
        if (msg.includes("Path:ssml")) behavior(ws, msg.slice(msg.indexOf("\r\n\r\n") + 4));
      });
    });
    await new Promise((r) => server.once("listening", r));
    process.env.EDGE_TTS_URL = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/edge`;
  });

  afterAll(() => {
    delete process.env.EDGE_TTS_URL;
    server.close();
  });

  const run = (t = "Hello", signal?: AbortSignal) => synthesizeEdge({ text: t, voice: "en-US-AvaNeural", rate: "+0%", pitch: "+0Hz", signal });
  const code = (p: Promise<unknown>) => p.then(() => "ok", (e: EdgeError) => e.code);

  it("collects audio frames until turn.end and sends the voice in SSML", async () => {
    let received = "";
    behavior = (ws, ssml) => {
      received = ssml;
      ws.send(text("turn.start"));
      ws.send(audioFrame(400));
      ws.send(audioFrame(400));
      ws.send(text("turn.end"));
    };
    const { audio } = await run("Tom & Jerry");
    expect(audio.length).toBe(800);
    expect(received).toContain("(en-US, AvaNeural)");
    expect(received).toContain("Tom &amp; Jerry");
  });

  it("after a 403, follows the server's clock and retries once", async () => {
    behavior = (ws) => {
      ws.send(audioFrame(600));
      ws.send(text("turn.end"));
    };
    const before = connections;
    rejectNext = { status: 403, date: new Date().toUTCString() };
    expect((await run()).audio.length).toBe(600);
    expect(connections - before).toBe(2);
  });

  it("reports a cut stream as retryable and silence as no audio", async () => {
    behavior = (ws) => {
      ws.send(audioFrame(600));
      ws.close();
    };
    expect(await code(run())).toBe("ENGINE_UNAVAILABLE");
    behavior = (ws) => ws.send(text("turn.end"));
    expect(await code(run())).toBe("NO_AUDIO");
  });

  it("collects word timings and shifts them across 4096-byte pieces by the audio before", async () => {
    let calls = 0;
    behavior = (ws) => {
      calls++;
      const first = calls === 1;
      ws.send(mp3Frames(first ? 50 : 25)); // 1.2 s, then 0.6 s
      ws.send(wordEvent(first ? "Tom" : "&amp;", first ? 0.1 : 0.2, 0.3));
      ws.send(text("turn.end"));
    };
    const long = `${"word ".repeat(900)}${"more ".repeat(10)}`; // over 4096 bytes: two pieces
    const { audio, words } = await run(long);
    expect(calls).toBe(2);
    expect(audio.length).toBe(75 * 144);
    expect(words.map((w) => w.text)).toEqual(["Tom", "&"]);
    expect(words[0].start).toBeCloseTo(0.1, 5);
    expect(words[1].start).toBeCloseTo(1.2 + 0.2, 5);
    expect(words[1].end).toBeCloseTo(1.2 + 0.5, 5);
  });

  it("stops when the caller aborts", async () => {
    behavior = () => {};
    const ctrl = new AbortController();
    const pending = code(run("Hello", ctrl.signal));
    setTimeout(() => ctrl.abort(), 100);
    expect(await pending).toBe("ABORTED");
  });
});
