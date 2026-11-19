import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (existsSync(".env")) process.loadEnvFile(".env");
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 配置无效");
const dir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dir, { recursive: true });
const url = `http://localhost:${port}`,
  record = resolve(dir, "local-service.json"),
  log = resolve(dir, "local-service.log"),
  lock = resolve(dir, "local-start.lock");
async function health() {
  try {
    const r = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
const existing = await health();
if (existing) {
  if (existing.service !== "lucky-event")
    throw new Error(`${port} 端口已被其他服务使用，请检查端口。`);
  console.log(`抽奖服务正在运行：${url}`);
  process.exit(0);
}
if (process.argv[2] === "status") {
  console.log(`抽奖服务未运行；执行 npm run local:start 恢复。日志：${log}`);
  process.exit(1);
}
if (!existsSync("dist/index.html"))
  throw new Error("请先执行 npm run build，再启动服务。");
try {
  if (existsSync(lock)) {
    const v = JSON.parse(readFileSync(lock, "utf8"));
    let alive = true;
    try {
      process.kill(v.pid, 0);
    } catch {
      alive = false;
    }
    if (alive) throw new Error("服务正在启动，请稍后执行 npm run local:status");
    unlinkSync(lock);
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), {
    flag: "wx",
    mode: 0o600,
  });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
let child;
try {
  const fd = openSync(log, "a", 0o600);
  child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  writeFileSync(
    record,
    JSON.stringify(
      { pid: child.pid, port, startedAt: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  let ready = false;
  for (let i = 0; i < 80; i++) {
    const h = await health();
    if (h?.service === "lucky-event") {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) {
    console.error(`启动失败，请检查日志：${log}`);
    process.exitCode = 1;
  } else {
    console.log(
      `抽奖服务已在后台运行：${url}\n关闭此终端后仍可访问。\n日志：${log}`,
    );
  }
} finally {
  if (existsSync(lock)) unlinkSync(lock);
}
