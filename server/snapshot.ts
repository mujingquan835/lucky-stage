import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import { AppError, type Activity } from "./domain.ts";
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function imageNames(activities: Activity[]) {
  const names = new Set<string>();
  for (const a of activities) {
    const images = [
      a.background,
      a.brandImage,
      ...a.gifts.map((g) => g.image),
      ...a.people.map((p) => p.photo),
      ...(a.stagePool?.participants.map(p => p.photo) ?? []),
      ...(a.stagePool?.gifts.map(g => g.image) ?? []),
      ...a.rounds.flatMap((r) => r.winners.flatMap((w) => [w.giftImage, w.personPhoto])),
    ];
    for (const url of images)
      if (url) {
        const name = url.slice("/api/images/".length);
        if (!/^\/api\/images\/[a-f0-9-]{36}\.webp$/.test(url))
          throw new Error("备份中存在无效图片路径");
        names.add(name);
      }
  }
  return [...names];
}
function audioNames(activities: Activity[]) {
  const names = new Set<string>();
  for (const a of activities) {
    const url = a.stageConfig?.music;
    if (!url) continue;
    if (!/^\/api\/audio\/[a-f0-9-]{36}\.(mp3|wav|ogg)$/.test(url))
      throw new Error("备份中存在无效音频路径");
    names.add(url.slice("/api/audio/".length));
  }
  return [...names];
}
export async function backup(db: Db, uploads: string, target: string) {
  await mkdir(target, { recursive: false, mode: 0o700 });
  const { rows } = await db.query("SELECT data FROM activities ORDER BY id");
  const activities: Activity[] = rows.map((r) => r.data);
  await mkdir(join(target, "images"), { mode: 0o700 });
  const files: Record<string, string> = {};
  for (const name of imageNames(activities)) {
    const buf = await readFile(join(uploads, name));
    files[name] = digest(buf);
    await writeFile(join(target, "images", name), buf, {
      flag: "wx",
      mode: 0o600,
    });
  }
  const audioFiles: Record<string, string> = {};
  await mkdir(join(target, "audio"), { mode: 0o700 });
  for (const name of audioNames(activities)) {
    const buf = await readFile(join(uploads, name));
    audioFiles[name] = digest(buf);
    await writeFile(join(target, "audio", name), buf, {
      flag: "wx",
      mode: 0o600,
    });
  }
  const data = Buffer.from(JSON.stringify(activities));
  await writeFile(join(target, "activities.json"), data, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    join(target, "manifest.json"),
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      activitiesHash: digest(data),
      files,
      audioFiles,
    }),
    { flag: "wx", mode: 0o600 },
  );
  return {
    activities: activities.length,
    images: Object.keys(files).length,
    audio: Object.keys(audioFiles).length,
  };
}
export async function restore(db: Db, uploads: string, source: string) {
  const manifest = JSON.parse(
    await readFile(join(source, "manifest.json"), "utf8"),
  );
  const data = await readFile(join(source, "activities.json"));
  if (manifest.version !== 1 || digest(data) !== manifest.activitiesHash)
    throw new Error("备份版本或数据校验失败");
  const activities: Activity[] = JSON.parse(data.toString());
  if (
    !Array.isArray(activities) ||
    activities.some(
      (a) =>
        typeof a.id !== "string" ||
        !Array.isArray(a.people) ||
        !Array.isArray(a.rounds) ||
        !Array.isArray(a.gifts),
    )
  )
    throw new Error("活动备份结构无效");
  const names = imageNames(activities);
  for (const name of names) {
    const buf = await readFile(join(source, "images", name));
    if (digest(buf) !== manifest.files[name])
      throw new Error("图片校验失败：" + name);
  }
  const audio = audioNames(activities);
  for (const name of audio) {
    const buf = await readFile(join(source, "audio", name));
    if (digest(buf) !== manifest.audioFiles?.[name])
      throw new Error("音频校验失败：" + name);
  }
  await db.transaction(async (sql) => {
    await sql.query("LOCK TABLE activities IN EXCLUSIVE MODE");
    const { rows } = await sql.query("SELECT id FROM activities LIMIT 1");
    if (rows.length)
      throw new AppError(
        "恢复目标必须是空数据库，请使用新数据库，避免覆盖现有活动",
      );
    await mkdir(uploads, { recursive: true });
    for (const name of names)
      await copyFile(join(source, "images", name), join(uploads, name));
    for (const name of audio)
      await copyFile(join(source, "audio", name), join(uploads, name));
    for (const a of activities)
      await sql.query("INSERT INTO activities(id,data) VALUES($1,$2::jsonb)", [
        a.id,
        JSON.stringify(a),
      ]);
    await sql.query("DELETE FROM sessions");
    await sql.query("DELETE FROM participant_sessions");
  });
  return {
    activities: activities.length,
    images: names.length,
    audio: audio.length,
  };
}
