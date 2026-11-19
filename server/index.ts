import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createDb } from "./db.ts";
import { createApp } from "./app.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
const production = process.env.NODE_ENV === "production";
if (!process.env.ADMIN_PASSWORD) {
  if (production) throw new Error("生产环境必须配置 ADMIN_PASSWORD");
  const pass = randomBytes(18).toString("base64url");
  const env = `ADMIN_USER=admin\nADMIN_PASSWORD=${pass}\nAPP_ORIGIN=http://localhost:3000\nPORT=3000\n`;
  writeFileSync(".env", env, { mode: 0o600, flag: "wx" });
  process.loadEnvFile(".env");
  console.log("已生成本地管理员账号，查看项目 .env 文件登录。");
}
if (
  production &&
  (!process.env.DATABASE_URL?.startsWith("postgres") ||
    !process.env.APP_ORIGIN?.startsWith("https://"))
)
  throw new Error(
    "生产环境必须配置 PostgreSQL DATABASE_URL 和 HTTPS APP_ORIGIN",
  );
const dataDir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dataDir, { recursive: true });
const db = await createDb(
  process.env.DATABASE_URL || resolve(dataDir, "pglite"),
);
const app = createApp(db, {
  adminUser: process.env.ADMIN_USER ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD!,
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:3000",
  secureCookies: production,
  trustProxy: process.env.TRUST_PROXY === "1",
  uploadDir: resolve(dataDir, "uploads"),
  distDir: resolve("dist"),
});
const server = app.listen(
  Number(process.env.PORT ?? 3000),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `活动抽奖服务：http://localhost:${process.env.PORT ?? 3000}（${db.kind}）`,
    ),
);
let closing = false;
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), 8000);
    timer.unref();
    server.closeIdleConnections?.();
    server.close(async () => {
      try {
        await db.close();
      } finally {
        clearTimeout(timer);
        process.exit(0);
      }
    });
  });
