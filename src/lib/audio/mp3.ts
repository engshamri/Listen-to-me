/**
 * Cheap MP3 sanity check: an ID3v2 tag or an MPEG audio frame-sync word near
 * the start of the data. Used to reject non-audio uploads before ffmpeg sees
 * them, and by tests to validate generated audio.
 */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // "ID3"
  const limit = Math.min(bytes.length - 1, 4096);
  for (let i = 0; i < limit; i++) {
    // 11 set bits of frame sync, MPEG version != reserved, layer != reserved
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0 && (bytes[i + 1] & 0x18) !== 0x08 && (bytes[i + 1] & 0x06) !== 0) return true;
  }
  return false;
}

/** Counts MPEG frame headers by walking frame lengths (MPEG-1/2 Layer III). */
export function countMp3Frames(bytes: Uint8Array): number {
  return scanMp3(bytes).frames;
}

/**
 * Exact duration from the frames themselves. Browsers sometimes report
 * Infinity or an estimate for concatenated MP3 blobs; this never does.
 */
export function mp3DurationSeconds(bytes: Uint8Array): number {
  return scanMp3(bytes).seconds;
}

function scanMp3(bytes: Uint8Array): { frames: number; seconds: number } {
  const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let i = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    i = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]);
  }
  let frames = 0;
  let seconds = 0;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const version = (bytes[i + 1] >> 3) & 0x03;
    const layer = (bytes[i + 1] >> 1) & 0x03;
    const bitrateIdx = bytes[i + 2] >> 4;
    const rateIdx = (bytes[i + 2] >> 2) & 0x03;
    const padding = (bytes[i + 2] >> 1) & 0x01;
    if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) {
      i++;
      continue;
    }
    const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bitrateIdx] * 1000;
    const sampleRate = RATES[version][rateIdx];
    const len = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
    if (len < 4) {
      i++;
      continue;
    }
    frames++;
    seconds += (version === 3 ? 1152 : 576) / sampleRate;
    i += len;
  }
  return { frames, seconds };
}
