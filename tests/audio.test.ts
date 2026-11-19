import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAudio } from "../server/audio.ts";
test("音频按容器验证，拒绝伪装扩展名、截断和非音频Ogg", () => {
  const wav = Buffer.alloc(48);
  wav.write("RIFF");
  wav.writeUInt32LE(40, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4, 40);
  assert.equal(validateAudio(wav), "wav");
  assert.throws(() => validateAudio(wav.subarray(0, 47)), /无效/);
  assert.throws(
    () => validateAudio(Buffer.from("<html>" + ".".repeat(100))),
    /无效/,
  );
  const mp3 = Buffer.alloc(417);
  mp3.set([0xff, 0xfb, 0x90, 0]);
  assert.equal(validateAudio(mp3), "mp3");
  assert.throws(() => validateAudio(mp3.subarray(0, 416)), /无效/);
  const ogg = Buffer.alloc(36);
  ogg.write("OggS");
  ogg[26] = 1;
  ogg[27] = 8;
  ogg.write("OpusHead", 28);
  assert.equal(validateAudio(ogg), "ogg");
  ogg.write("theoraXX", 28);
  assert.throws(() => validateAudio(ogg), /无效/);
});
