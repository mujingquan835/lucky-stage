import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDb } from "../server/db.ts";
import { backup, restore } from "../server/snapshot.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
const [mode, path] = process.argv.slice(2);
if (!["backup", "restore"].includes(mode) || !path) {
  console.error(
    "用法：npm run backup -- /绝对路径/新备份目录；npm run restore -- /绝对路径/备份目录",
  );
  process.exit(1);
}
const data = resolve(process.env.DATA_DIR ?? "data");
if (
  !process.env.DATABASE_URL?.startsWith("postgres") &&
  process.env.CONFIRM_LOCAL_STOPPED !== "yes"
)
  throw new Error(
    "PGlite 备份或恢复前必须停止本地服务，并设置 CONFIRM_LOCAL_STOPPED=yes",
  );
const db = await createDb(process.env.DATABASE_URL ?? resolve(data, "pglite"));
try {
  const result = await (mode === "backup" ? backup : restore)(
    db,
    resolve(data, "uploads"),
    resolve(path),
  );
  console.log(mode === "backup" ? "备份完成" : "恢复完成", result);
} finally {
  await db.close();
}
