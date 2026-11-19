import { AppError } from "./domain.ts";
/** Validate containers, not filenames or the caller-provided Content-Type. */
export function validateAudio(b: Buffer): "wav" | "ogg" | "mp3" {
  const invalid = () => {
    throw new AppError("音频损坏或格式无效，请上传 MP3、WAV 或 OGG");
  };
  if (b.length < 28 || b.length > 15 * 1024 * 1024) return invalid();
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WAVE"
  ) {
    if (b.readUInt32LE(4) + 8 !== b.length) return invalid();
    let format = false,
      data = false;
    for (let p = 12; p + 8 <= b.length; ) {
      const n = b.readUInt32LE(p + 4),
        end = p + 8 + n;
      if (end > b.length) return invalid();
      const id = b.toString("ascii", p, p + 4);
      if (id === "fmt ") {
        if (n < 16) return invalid();
        const encoding = b.readUInt16LE(p + 8),
          channels = b.readUInt16LE(p + 10),
          rate = b.readUInt32LE(p + 12),
          bits = b.readUInt16LE(p + 22);
        if (
          ![1, 3].includes(encoding) ||
          channels < 1 ||
          channels > 8 ||
          rate < 8000 ||
          rate > 192000 ||
          ![8, 16, 24, 32, 64].includes(bits)
        )
          return invalid();
        format = true;
      }
      if (id === "data" && n > 0) data = true;
      p = end + (n % 2);
    }
    if (format && data) return "wav";
    return invalid();
  }
  if (b.toString("ascii", 0, 4) === "OggS") {
    let p = 0,
      pages = 0,
      audio = false;
    while (p < b.length) {
      if (
        p + 27 > b.length ||
        b.toString("ascii", p, p + 4) !== "OggS" ||
        b[p + 4] !== 0
      )
        return invalid();
      const segments = b[p + 26],
        start = p + 27 + segments;
      if (start > b.length) return invalid();
      let n = 0;
      for (let j = 0; j < segments; j++) n += b[p + 27 + j];
      if (start + n > b.length) return invalid();
      if (!pages)
        audio =
          b.toString("ascii", start, start + 8) === "OpusHead" ||
          (b[start] === 1 &&
            b.toString("ascii", start + 1, start + 7) === "vorbis");
      p = start + n;
      pages++;
    }
    if (audio && pages) return "ogg";
    return invalid();
  }
  let p = 0;
  if (b.toString("ascii", 0, 3) === "ID3") {
    if (b.length < 10 || [b[6], b[7], b[8], b[9]].some((v) => v > 127))
      return invalid();
    p =
      10 +
      (b[6] << 21) +
      (b[7] << 14) +
      (b[8] << 7) +
      b[9] +
      (b[5] & 16 ? 10 : 0);
  }
  let frames = 0;
  while (p + 4 <= b.length) {
    if (b.toString("ascii", p, p + 3) === "TAG" && b.length - p === 128) {
      p = b.length;
      break;
    }
    const h = b.readUInt32BE(p);
    if (h >>> 21 !== 0x7ff) return invalid();
    const version = (h >>> 19) & 3,
      layer = (h >>> 17) & 3,
      bitIndex = (h >>> 12) & 15,
      sampleIndex = (h >>> 10) & 3;
    if (
      version === 1 ||
      layer !== 1 ||
      !bitIndex ||
      bitIndex === 15 ||
      sampleIndex === 3
    )
      return invalid();
    const rates =
      version === 3
        ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
        : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const sample =
        [44100, 48000, 32000][sampleIndex] /
        (version === 3 ? 1 : version === 2 ? 2 : 4),
      size =
        Math.floor(
          ((version === 3 ? 144 : 72) * rates[bitIndex] * 1000) / sample,
        ) +
        ((h >>> 9) & 1);
    if (p + size > b.length) return invalid();
    p += size;
    frames++;
  }
  if (frames && p === b.length) return "mp3";
  return invalid();
}
