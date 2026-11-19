import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../server/db.ts";
import {
  createActivity,
  addPeople,
  saveGift,
  draw,
  state,
  mutate,
  savePersonPhotos,
} from "../server/domain.ts";
import { backup, restore } from "../server/snapshot.ts";
test("备份恢复后名单、库存、中奖快照一致，拒绝覆盖和篡改", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lottery-backup-"));
  const original = await createDb(),
    restored = await createDb();
  try {
    const a = await createActivity(original, { name: "恢复测试" });
    const people = await addPeople(original, a.id, [
      { name: "甲", phone: "0001" },
    ]);
    const filename = "12345678-1234-1234-1234-123456789abc.webp";
    await mkdir(join(dir, "uploads"));
    await writeFile(join(dir, "uploads", filename), "fixture-image-content");
    const portrait = "12345678-1234-1234-1234-123456789def.webp";
    await writeFile(join(dir, "uploads", portrait), "fixture-portrait");
    await savePersonPhotos(original, a.id, [{ personId: people[0].id, photo: "/api/images/" + portrait }]);
    await saveGift(original, a.id, {
      name: "好礼",
      total: 2,
      image: "/api/images/" + filename,
    });
    await draw(original, a.id, {
      requestId: "backup-draw-0001",
      mode: "single",
      personId: people[0].id,
    });
    await savePersonPhotos(original, a.id, [{ personId: people[0].id, photo: "" }]);
    const audioName = "12345678-1234-1234-1234-123456789abc.wav";
    await writeFile(join(dir, "uploads", audioName), "fixture-audio");
    await mutate(original, a.id, (a) => {
      a.stageConfig.music = "/api/audio/" + audioName;
    });
    const target = join(dir, "snapshot");
    await backup(original, join(dir, "uploads"), target);
    assert.equal((await stat(target)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(join(target, "activities.json"))).mode & 0o777,
      0o600,
    );
    await restore(restored, join(dir, "restored-images"), target);
    assert.deepEqual(
      await readFile(join(dir, "uploads", filename)),
      await readFile(join(dir, "restored-images", filename)),
    );
    assert.deepEqual(await state(restored, a.id), await state(original, a.id));
    assert.equal((await readFile(join(dir, "restored-images", portrait))).toString(), "fixture-portrait");
    assert.equal(
      (await readFile(join(dir, "restored-images", audioName))).toString(),
      "fixture-audio",
    );
    await writeFile(join(target, "audio", audioName), "corrupt-audio");
    await assert.rejects(
      restore(restored, join(dir, "restored-images"), target),
      /音频校验/,
    );
    await writeFile(join(target, "audio", audioName), "fixture-audio");
    await assert.rejects(
      restore(restored, join(dir, "restored-images"), target),
      /空数据库/,
    );
    await writeFile(join(target, "images", filename), "tampered");
    await assert.rejects(
      restore(restored, join(dir, "restored-images"), target),
      /图片校验/,
    );
    await writeFile(join(target, "images", filename), "fixture-image-content");
    await writeFile(join(target, "activities.json"), "[]");
    await assert.rejects(
      restore(restored, join(dir, "restored-images"), target),
      /校验/,
    );
  } finally {
    await original.close();
    await restored.close();
    await rm(dir, { recursive: true, force: true });
  }
});
