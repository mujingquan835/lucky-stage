import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
function run(env: NodeJS.ProcessEnv, action = "start") {
  return new Promise<{ code: number | null; output: string }>((resolve) => {
    let output = "";
    const p = spawn(process.execPath, ["scripts/local-service.mjs", action], {
      env,
    });
    p.stdout.on("data", (d) => (output += d));
    p.stderr.on("data", (d) => (output += d));
    p.on("exit", (code) => resolve({ code, output }));
  });
}
test("本地服务脱离启动器后继续运行，重复启动复用已有实例", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lottery-service-"));
  const port = 3197;
  const env = {
    ...process.env,
    PORT: String(port),
    APP_ORIGIN: `http://localhost:${port}`,
    ADMIN_PASSWORD: "local-service-test-password",
    DATA_DIR: dir,
  };
  let pid: number | undefined;
  try {
    const result = await run(env);
    assert.equal(result.code, 0, result.output);
    const info = JSON.parse(
      await readFile(join(dir, "local-service.json"), "utf8"),
    );
    pid = info.pid;
    assert.ok(pid);
    const health = (await (
      await fetch(`http://localhost:${port}/api/health`)
    ).json()) as any;
    assert.equal(health.service, "lucky-event");
    const second = await run(env);
    assert.equal(second.code, 0, second.output);
    assert.equal(
      JSON.parse(await readFile(join(dir, "local-service.json"), "utf8")).pid,
      pid,
    );
    assert.equal((await run(env, "status")).code, 0);
  } finally {
    if (pid) {
      process.kill(pid, "SIGTERM");
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(pid, 0);
        } catch {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
});
