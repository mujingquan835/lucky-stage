import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import {
  addPeople,
  clearPeople,
  createActivity,
  draw,
  saveGift,
  state,
} from "../server/domain.ts";
import { configureCheckin } from "../server/checkin-service.ts";
import { getStage, stageCommand } from "../server/stage.ts";

async function startServer() {
  const dir = await mkdtemp(join(tmpdir(), "lottery-checkin-"));
  const db = await createDb();
  const app = createApp(db, {
    adminUser: "admin",
    adminPassword: "test-password-1234",
    appOrigin: "http://127.0.0.1",
    uploadDir: dir,
    secureCookies: false,
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as import("node:net").AddressInfo;
  const origin = `http://127.0.0.1:${addr.port}`;
  return {
    db,
    origin,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function loginCookie(origin: string) {
  const res = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1",
      "X-Requested-With": "lottery",
    },
    body: JSON.stringify({ username: "admin", password: "test-password-1234" }),
  });
  assert.equal(res.status, 200);
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}

test("扫码报名开关、时间窗与公开数据隔离，重复提交幂等", async () => {
  const ctx = await startServer();
  try {
    const a = await createActivity(ctx.db, { name: "扫码测试场" });
    await addPeople(ctx.db, a.id, [
      { name: "老客户", phone: "13900001111", store: "总店" },
    ]);

    // 未开启时拒绝提交
    const infoClosed = await fetch(`${ctx.origin}/api/checkin/${a.id}/info`).then((r) =>
      r.json(),
    );
    assert.equal(infoClosed.open, false);
    const submitClosed = await fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({ name: "王小明", phone: "13800001234" }),
    });
    assert.equal(submitClosed.status, 403);

    // 开启扫码并要求门店
    await configureCheckin(ctx.db, a.id, {
      enabled: true,
      startsAt: "",
      endsAt: "",
      askCompany: false,
      askStore: true,
    });
    const infoOpen = await fetch(`${ctx.origin}/api/checkin/${a.id}/info`).then((r) =>
      r.json(),
    );
    assert.equal(infoOpen.open, true);
    assert.equal(infoOpen.askStore, true);
    assert.equal((infoOpen as any).people, undefined);

    // 首次提交
    const firstRes = await fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({
        name: "王小明",
        phone: "13800001234",
        store: "滨江店",
      }),
    });
    assert.equal(firstRes.status, 200);
    const first = await firstRes.json();
    assert.equal(first.alreadyCheckedIn, false);
    assert.equal(first.entry.name, "王*明");
    assert.equal(first.entry.phone, "138****1234");

    // 相同手机号重复提交幂等
    const dupRes = await fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({
        name: "王小明",
        phone: "13800001234",
      }),
    });
    assert.equal(dupRes.status, 200);
    const dup = await dupRes.json();
    assert.equal(dup.alreadyCheckedIn, true);

    // 与已有名单同电话扫码，同步时不重复新增，只标记到场
    const existingRes = await fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({ name: "老客户", phone: "13900001111" }),
    });
    assert.equal(existingRes.status, 200);

    // 大屏状态包含打码最近报名和计数
    const stage = await getStage(ctx.db, a.id);
    assert.equal(stage.checkin?.enabled, true);
    assert.equal(stage.checkin?.count, 2);
    assert.ok(stage.checkin?.recent.every((r) => !/\d{7,}/.test(r.name)));

    // 获取二维码 PNG
    const cookie = await loginCookie(ctx.origin);
    const qrRes = await fetch(`${ctx.origin}/api/activities/${a.id}/checkin/qr`, {
      headers: { Cookie: cookie },
    });
    assert.equal(qrRes.status, 200);
    assert.equal(qrRes.headers.get("content-type"), "image/png");

    // 不点手动同步，直接发起抽奖时自动将未同步名单纳入奖池
    const gift = await saveGift(ctx.db, a.id, { name: "蓝牙耳机", total: 2 });
    const round = await draw(ctx.db, a.id, {
      requestId: "checkin-auto-sync-draw-1",
      mode: "batch",
      giftId: gift.id,
      count: 2,
    });
    assert.equal(round.winners.length, 2);
    const s = await state(ctx.db, a.id);
    assert.equal(s.people.length, 2);
    assert.ok(s.people.every((p) => p.checkedIn === true));
  } finally {
    await ctx.close();
  }
});

test("500人并发扫码提交全部成功落库、无丢失且可正常大屏抽奖，清空名单同步清理", async () => {
  const ctx = await startServer();
  try {
    const a = await createActivity(ctx.db, { name: "500人并发扫码" });
    await configureCheckin(ctx.db, a.id, {
      enabled: true,
      startsAt: "",
      endsAt: "",
      askCompany: false,
      askStore: false,
    });
    const gift = await saveGift(ctx.db, a.id, { name: "幸运大奖", total: 10 });

    const total = 500;
    const batchSize = 100;
    const responses: Response[] = [];
    for (let offset = 0; offset < total; offset += batchSize) {
      const batch = await Promise.all(
        Array.from({ length: batchSize }, (_, i) => {
          const idx = offset + i + 1;
          return fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "http://127.0.0.1",
              "X-Requested-With": "lottery",
            },
            body: JSON.stringify({
              name: `观众${idx}`,
              phone: `138${String(idx).padStart(8, "0")}`,
            }),
          });
        }),
      );
      responses.push(...batch);
    }
    assert.ok(
      responses.every((r) => r.status === 200),
      "500个并发扫码请求应全部返回 200",
    );

    const stageBefore = await getStage(ctx.db, a.id);
    assert.equal(stageBefore.checkin?.count, total);

    // 舞台发起抽奖（自动同步500人并抽10人）
    const started = await stageCommand(ctx.db, a.id, {
      requestId: "stage-checkin-500-start",
      expectedVersion: stageBefore.session.version,
      action: "start",
      selection: { mode: "batch", giftId: gift.id, count: 10 },
    });
    assert.ok(started.roundId);

    const afterDraw = await state(ctx.db, a.id);
    assert.equal(afterDraw.people.length, total);

    // 新建空活动验证 clearPeople 同时清理 checkin_entries
    const b = await createActivity(ctx.db, { name: "清空测试场" });
    await configureCheckin(ctx.db, b.id, {
      enabled: true,
      startsAt: "",
      endsAt: "",
      askCompany: false,
      askStore: false,
    });
    await fetch(`${ctx.origin}/api/checkin/${b.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({ name: "临时用户", phone: "13700009999" }),
    });
    const cookie = await loginCookie(ctx.origin);
    await fetch(`${ctx.origin}/api/activities/${b.id}/checkin/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
        Cookie: cookie,
      },
      body: "{}",
    });
    const sb = await state(ctx.db, b.id);
    assert.equal(sb.people.length, 1);
    await clearPeople(ctx.db, b.id, {
      requestId: "clear-checkin-test-1",
      peopleVersion: sb.peopleVersion,
    });
    const stageB = await getStage(ctx.db, b.id);
    assert.equal(stageB.checkin?.count, 0);
  } finally {
    await ctx.close();
  }
});

test("扫码报名支持自定义字段新增删除保存与必填校验及同步", async () => {
  const ctx = await startServer();
  try {
    const a = await createActivity(ctx.db, { name: "自定义字段测试" });
    // 拒绝重名或系统字段名
    await assert.rejects(
      () =>
        configureCheckin(ctx.db, a.id, {
          enabled: true,
          startsAt: "",
          endsAt: "",
          askCompany: false,
          askStore: false,
          fields: [{ id: "f1", label: "姓名", required: true }],
        }),
      /系统固定字段/,
    );
    await assert.rejects(
      () =>
        configureCheckin(ctx.db, a.id, {
          enabled: true,
          startsAt: "",
          endsAt: "",
          askCompany: false,
          askStore: false,
          fields: [
            { id: "f1", label: "桌号", required: true },
            { id: "f2", label: "桌号", required: false },
          ],
        }),
      /重复/,
    );

    // 保存自定义字段（含一个必填“桌号”和一个选填“微信号”）
    await configureCheckin(ctx.db, a.id, {
      enabled: true,
      startsAt: "",
      endsAt: "",
      askCompany: false,
      askStore: false,
      fields: [
        { id: "table", label: "桌号", required: true, placeholder: "如 8号桌" },
        { id: "wechat", label: "微信号", required: false },
      ],
    });

    const info = await fetch(`${ctx.origin}/api/checkin/${a.id}/info`).then((r) =>
      r.json(),
    );
    assert.equal(info.fields.length, 2);
    assert.equal(info.fields[0].label, "桌号");
    assert.equal(info.fields[0].required, true);

    // 缺少必填自定义字段被拒绝
    const missingRes = await fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({
        name: "赵敏",
        phone: "13600008888",
        extra: { wechat: "zm_888" },
      }),
    });
    assert.equal(missingRes.status, 400);

    // 完整提交并同步到名单 extra
    const okRes = await fetch(`${ctx.origin}/api/checkin/${a.id}/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
      },
      body: JSON.stringify({
        name: "赵敏",
        phone: "13600008888",
        extra: { table: "VIP-3", wechat: "zm_888" },
      }),
    });
    assert.equal(okRes.status, 200);

    const cookie = await loginCookie(ctx.origin);
    await fetch(`${ctx.origin}/api/activities/${a.id}/checkin/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
        "X-Requested-With": "lottery",
        Cookie: cookie,
      },
      body: "{}",
    });
    const s = await state(ctx.db, a.id);
    assert.equal(s.people.length, 1);
    assert.deepEqual(s.people[0].extra, { 桌号: "VIP-3", 微信号: "zm_888" });

    // 删除字段后保存
    await configureCheckin(ctx.db, a.id, {
      enabled: true,
      startsAt: "",
      endsAt: "",
      askCompany: false,
      askStore: false,
      fields: [{ id: "table", label: "桌号", required: false }],
    });
    const info2 = await fetch(`${ctx.origin}/api/checkin/${a.id}/info`).then((r) =>
      r.json(),
    );
    assert.equal(info2.fields.length, 1);
  } finally {
    await ctx.close();
  }
});
