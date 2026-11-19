/** Isolated HTTP load test. Never opens the normal data directory or a remote server. */
import { fork } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir, cpus, totalmem, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import assert from "node:assert/strict";
const filename = fileURLToPath(import.meta.url);
if (process.argv[2] === "--server") {
  const { createDb } = await import("../server/db.ts"),
    { createApp } = await import("../server/app.ts");
  const dir = process.argv[3],
    db = await createDb(join(dir, "pglite"));
  const app = createApp(db, {
    adminUser: "pressure-admin",
    adminPassword: process.env.PRESSURE_PASSWORD,
    appOrigin: "http://pressure.test",
    uploadDir: join(dir, "uploads"),
    secureCookies: false,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.on("listening", r));
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  let previous = process.cpuUsage(),
    at = performance.now(),
    maxCpu = 0,
    maxRss = 0,
    maxHeap = 0;
  const sampler = setInterval(() => {
    const t = performance.now(),
      usage = process.cpuUsage(),
      memory = process.memoryUsage();
    maxCpu = Math.max(
      maxCpu,
      (usage.user - previous.user + (usage.system - previous.system)) /
        (t - at) /
        10,
    );
    maxRss = Math.max(maxRss, memory.rss);
    maxHeap = Math.max(maxHeap, memory.heapUsed);
    previous = usage;
    at = t;
  }, 500);
  process.on("message", async (m) => {
    if (m === "metrics")
      process.send?.({
        type: "metrics",
        rssPeakMiB: maxRss / 1048576,
        heapPeakMiB: maxHeap / 1048576,
        cpuPeakPercentOneCore: maxCpu,
        eventLoopP95Ms: lag.percentile(95) / 1e6,
        eventLoopMaxMs: lag.max / 1e6,
      });
    if (m === "stop") {
      clearInterval(sampler);
      lag.disable();
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
    }
  });
  process.send?.({
    type: "ready",
    port: server.address().port,
    pid: process.pid,
  });
} else {
  const dir = await mkdtemp(join(tmpdir(), "lottery-pressure-")),
    password = randomBytes(24).toString("hex");
  const child = fork(filename, ["--server", dir], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, PRESSURE_PASSWORD: password },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const report = {
    createdAt: new Date().toISOString(),
    scope:
      "Local loopback HTTP / isolated child server / persistent temporary PGlite / synthetic data only; not Tencent production",
    hardware: {
      os: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCores: cpus().length,
      memoryGiB: totalmem() / 1073741824,
      node: process.version,
    },
    concurrency: 20,
    fixturePeople: 1000,
    phases: {},
    checks: {},
    errors: [],
  };
  let errorLog = "",
    base = "",
    admin = "",
    stagePath = "",
    stagePoll,
    healthPoll,
    mePoll,
    measurements = {},
    polls = [];
  child.stderr.on("data", (d) => {
    errorLog = (errorLog + d).slice(-3000);
  });
  const exited = new Promise((r) =>
    child.once("exit", (code, signal) => r({ code, signal })),
  );
  function message(type, timeout = 15000) {
    return new Promise((r, j) => {
      const timer = setTimeout(() => {
        child.off("message", listener);
        j(new Error("Worker " + type + " timeout"));
      }, timeout);
      function listener(m) {
        if (m.type === type) {
          clearTimeout(timer);
          child.off("message", listener);
          r(m);
        }
      }
      child.on("message", listener);
    });
  }
  async function req(
    label,
    path,
    method = "GET",
    body,
    cookie = admin,
    allowed = [200],
  ) {
    const start = performance.now();
    let status = 0;
    try {
      const res = await fetch(base + path, {
        method,
        headers: {
          Origin: "http://pressure.test",
          "X-Requested-With": "lottery",
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      status = res.status;
      const data = await res.json();
      (measurements[label] ??= []).push(performance.now() - start);
      if (!allowed.includes(status)) {
        report.errors.push({
          label,
          status,
          error: data.error ?? "HTTP error",
        });
        throw new Error(label + " HTTP " + status);
      }
      return {
        data,
        status,
        cookie: res.headers.get("set-cookie")?.split(";")[0],
      };
    } catch (e) {
      if (status === 0) report.errors.push({ label, status: 0, error: e.name });
      throw e;
    }
  }
  async function phase(label, fn) {
    const start = performance.now();
    const result = await fn();
    report.phases[label] = { wallMs: performance.now() - start };
    return result;
  }
  function startPoll(fn, ms) {
    let busy = false;
    return setInterval(() => {
      if (busy) return;
      busy = true;
      const task = fn()
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
      polls.push(task);
    }, ms);
  }
  let success = false;
  try {
    const ready = await message("ready");
    base = "http://127.0.0.1:" + ready.port + "/api";
    admin = (
      await req(
        "setup_login",
        "/auth/login",
        "POST",
        { username: "pressure-admin", password },
        "",
      )
    ).cookie;
    const activity = (
      await req("setup_activity", "/activities", "POST", {
        name: "虚构20人压力测试",
      })
    ).data;
    stagePath = "/activities/" + activity.id + "/self/stage";
    const activityPath = "/activities/" + activity.id;
    await req("setup_people", activityPath + "/people", "POST", {
      rows: Array.from({ length: 1000 }, (_, i) => ({
        name: "虚构压力客户" + i,
        phone: "PRESSURE-" + i,
        store: "虚构测试门店" + (i % 5),
      })),
    });
    await req("setup_gift", activityPath + "/gifts", "POST", {
      name: "压力测试礼品",
      total: 1000,
      singleEnabled: true,
    });
    await req("setup_window", activityPath + "/self", "PUT", {
      enabled: true,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const codes = (
      await req("setup_codes", activityPath + "/self/codes", "POST", {})
    ).data;
    const publicPath = "/participate/" + activity.id;
    stagePoll = startPoll(() => req("stage_poll", stagePath), 1500);
    healthPoll = startPoll(() => req("health_poll", "/health"), 1000);
    const users = await phase("20_simultaneous_logins", () =>
      Promise.all(
        codes.slice(0, 20).map(async (c) => ({
          code: c.code,
          cookie: (
            await req(
              "participant_login",
              publicPath + "/login",
              "POST",
              { code: c.code },
              "",
            )
          ).cookie,
          requestId: randomUUID(),
        })),
      ),
    );
    const first = await phase("20_simultaneous_draws", () =>
      Promise.all(
        users.map((u) =>
          req(
            "draw",
            publicPath + "/draw",
            "POST",
            { requestId: u.requestId },
            u.cookie,
          ),
        ),
      ),
    );
    const repeated = await phase("20_simultaneous_retries", () =>
      Promise.all(
        users.map((u) =>
          req(
            "draw_retry",
            publicPath + "/draw",
            "POST",
            { requestId: u.requestId },
            u.cookie,
          ),
        ),
      ),
    );
    assert.deepEqual(
      first.map((r) => r.data),
      repeated.map((r) => r.data),
    );
    report.checks.retriesReturnOriginal = true;
    assert.equal(
      (await req("stage_before_reveal", stagePath)).data.winners.length,
      0,
    );
    report.checks.noPrematureStageResult = true;
    await phase("20_simultaneous_stops", () =>
      Promise.all(
        users.map((u) =>
          req(
            "reveal",
            publicPath + "/reveal",
            "POST",
            { requestId: u.requestId },
            u.cookie,
          ),
        ),
      ),
    );
    assert.equal(
      (await req("stage_after_reveal", stagePath)).data.winners.length,
      20,
    );
    mePoll = startPoll(
      () =>
        Promise.all(
          users.map((u) =>
            req(
              "participant_poll",
              publicPath + "/me",
              "GET",
              undefined,
              u.cookie,
            ),
          ),
        ),
      5000,
    );
    await phase("20_workers_9_more_draws_each", () =>
      Promise.all(
        Array.from({ length: 20 }, (_, worker) =>
          (async () => {
            for (let wave = 1; wave <= 9; wave++) {
              const c = codes[wave * 20 + worker],
                cookie = (
                  await req(
                    "participant_login",
                    publicPath + "/login",
                    "POST",
                    { code: c.code },
                    "",
                  )
                ).cookie,
                requestId = randomUUID();
              await req(
                "draw_sustained",
                publicPath + "/draw",
                "POST",
                { requestId },
                cookie,
              );
              await req(
                "reveal_sustained",
                publicPath + "/reveal",
                "POST",
                { requestId },
                cookie,
              );
            }
          })(),
        ),
      ),
    );
    await phase(
      "60_seconds_20_online_polling",
      () => new Promise((r) => setTimeout(r, 60000)),
    );
    clearInterval(mePoll);
    clearInterval(stagePoll);
    clearInterval(healthPoll);
    await Promise.all(polls);
    const state = (await req("verification", activityPath)).data;
    assert.equal(state.rounds.length, 200);
    assert.equal(state.summary.winnerCount, 200);
    assert.equal(state.gifts[0].remaining, 800);
    report.checks.completedDraws = 200;
    report.checks.remainingStock = 800;
    report.checks.inventoryAndRecordCountsCorrect = true;
    // Twenty different people compete for one last item in a second isolated activity.
    const race = (
        await req("setup_race", "/activities", "POST", {
          name: "虚构最后一份库存争抢",
        })
      ).data,
      rp = "/activities/" + race.id,
      pp = "/participate/" + race.id;
    await req("setup_race", rp + "/people", "POST", {
      rows: Array.from({ length: 20 }, (_, i) => ({
        name: "虚构争抢" + i,
        phone: "RACE-" + i,
      })),
    });
    await req("setup_race", rp + "/gifts", "POST", {
      name: "最后一份",
      total: 1,
      singleEnabled: true,
    });
    await req("setup_race", rp + "/self", "PUT", {
      enabled: true,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 60000).toISOString(),
    });
    const raceCodes = (await req("setup_race", rp + "/self/codes", "POST", {}))
      .data;
    const raceCookies = await Promise.all(
      raceCodes.map(
        async (c) =>
          (await req("race_login", pp + "/login", "POST", { code: c.code }, ""))
            .cookie,
      ),
    );
    const raced = await phase("20_compete_for_last_item", () =>
      Promise.all(
        raceCookies.map((cookie) =>
          req(
            "last_item_race",
            pp + "/draw",
            "POST",
            { requestId: randomUUID() },
            cookie,
            [200, 400],
          ),
        ),
      ),
    );
    assert.equal(raced.filter((r) => r.status === 200).length, 1);
    assert.equal(raced.filter((r) => r.status === 400).length, 19);
    const raceState = (await req("verification", rp)).data;
    assert.equal(raceState.rounds.length, 1);
    assert.equal(raceState.gifts[0].remaining, 0);
    report.checks.lastItem = {
      successful: 1,
      expectedOutOfStock: 19,
      remaining: 0,
    };
    const metrics = message("metrics");
    child.send("metrics");
    report.serverMetrics = await metrics;
    report.checks.serverHealthy =
      (await req("final_health", "/health")).status === 200;
    success = report.errors.length === 0;
    report.passed = success;
  } catch (e) {
    report.passed = false;
    report.failure = e.message;
    console.error(e.message);
    if (errorLog) console.error(errorLog);
  } finally {
    clearInterval(mePoll);
    clearInterval(stagePoll);
    clearInterval(healthPoll);
    await Promise.allSettled(polls);
    if (child.connected) child.send("stop");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await exited;
    await rm(dir, { recursive: true, force: true });
    for (const [label, times] of Object.entries(measurements)) {
      times.sort((a, b) => a - b);
      report.phases[label] = {
        ...(report.phases[label] ?? {}),
        requests: times.length,
        meanMs: times.reduce((a, b) => a + b, 0) / times.length,
        p50Ms: times[Math.ceil(times.length * 0.5) - 1],
        p95Ms: times[Math.ceil(times.length * 0.95) - 1],
        maxMs: times.at(-1),
      };
    }
    await mkdir(resolve("outputs"), { recursive: true });
    const output = resolve("outputs/pressure-test-20-users.json");
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          passed: report.passed,
          concurrency: 20,
          checks: report.checks,
          draw: report.phases.draw,
          drawSustained: report.phases.draw_sustained,
          reveal: report.phases.reveal,
          poll: report.phases.participant_poll,
          stage: report.phases.stage_poll,
          health: report.phases.health_poll,
          serverMetrics: report.serverMetrics,
          errors: report.errors.length,
          report: output,
        },
        null,
        2,
      ),
    );
    if (!success) process.exitCode = 1;
  }
}
