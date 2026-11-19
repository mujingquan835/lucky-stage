import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db.ts";
import {
  createActivity,
  addPeople,
  saveGift,
  state,
  updatePerson,
  draw,
} from "../server/domain.ts";
import {
  configureSelf,
  generateCodes,
  participantState,
  selfDraw,
  selfStage,
  selfReveal,
} from "../server/self-service.ts";
async function setup(total = 1) {
  const db = await createDb();
  const a = await createActivity(db, { name: "自主测试" });
  const people = await addPeople(db, a.id, [
    { name: "张三丰", phone: "001", store: "中央门店" },
    { name: "李小明", phone: "002", store: "滨江门店" },
  ]);
  await saveGift(db, a.id, { name: "测试礼品", total, singleEnabled: true });
  await configureSelf(db, a.id, {
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2027-01-01T00:00:00Z",
    enabled: true,
  });
  const codes = await generateCodes(db, a.id);
  return { db, a, people, codes };
}
test("码补发不变、换码失效及个人数据隔离", async () => {
  const { db, a, people, codes } = await setup();
  try {
    await updatePerson(db, a.id, people[0].id, {salesperson: "程达", department: "一部"});
    const updated = await generateCodes(db, a.id);
    assert.equal(updated[0].salesperson, "程达");
    assert.equal(updated[0].department, "一部");
    assert.equal(updated[1].department, "");
    assert.equal(updated[0].code, codes[0].code);
    assert.equal(updated[1].salesperson, "");
    assert.ok(
      codes.every((c) => /^[A-F][A-F0-9]{19}$/.test(c.code)),
      "字母开头避免Excel把码转成数字",
    );
    const me = await participantState(db, a.id, codes[0].code);
    assert.equal(me.name, "张三丰");
    assert.equal(JSON.stringify(me).includes("001"), false);
    await generateCodes(db, a.id, people[0].id);
    await assert.rejects(participantState(db, a.id, codes[0].code), /抽奖码/);
  } finally {
    await db.close();
  }
});
test("时间边界、暂停、结束后幂等恢复、次数共享与越权请求", async () => {
  const { db, a, people, codes } = await setup(4);
  try {
    const start = Date.parse("2026-01-01T00:00:00Z"),
      end = Date.parse("2027-01-01T00:00:00Z");
    await assert.rejects(
      selfDraw(db, a.id, codes[0].code, "request-0001", start - 1),
      /未开放/,
    );
    await assert.rejects(
      selfDraw(db, a.id, codes[0].code, "request-0001", end),
      /结束/,
    );
    const result = await selfDraw(
      db,
      a.id,
      codes[0].code,
      "request-0001",
      start,
    );
    assert.deepEqual(
      await selfDraw(db, a.id, codes[0].code, "request-0001", end),
      result,
    );
    await selfReveal(db, a.id, codes[0].code, "request-0001");
    await assert.rejects(
      selfDraw(db, a.id, codes[0].code, "request-0002", start),
      /机会/,
    );
    await assert.rejects(
      draw(db, a.id, {
        mode: "single",
        personId: people[0].id,
        requestId: "admin-request-1",
      }),
      /机会/,
    );
    await selfDraw(db, a.id, codes[1].code, "request-0001", start);
    await selfReveal(db, a.id, codes[0].code, "request-0001");
    await selfReveal(db, a.id, codes[1].code, "request-0001");
    assert.equal((await selfStage(db, a.id)).winners.length, 2);
    assert.equal(
      JSON.stringify(await selfStage(db, a.id)).includes("001"),
      false,
    );
    await configureSelf(db, a.id, {
      enabled: false,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
    });
    await assert.rejects(
      selfDraw(db, a.id, codes[1].code, "request-0003", start),
      /暂停/,
    );
    await assert.rejects(
      configureSelf(db, a.id, {
        enabled: true,
        startsAt: "bad",
        endsAt: "bad",
      }),
      /时间/,
    );
  } finally {
    await db.close();
  }
});
test("多人并发最后一份库存不超发，同人并发重试只落库一次", async () => {
  const { db, a, codes } = await setup();
  try {
    const results = await Promise.allSettled(
      codes.map((c) => selfDraw(db, a.id, c.code, "concurrent-0001")),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const c = codes[results.findIndex((r) => r.status === "fulfilled")];
    const r = await selfDraw(db, a.id, c.code, "concurrent-0001");
    assert.deepEqual(await selfDraw(db, a.id, c.code, "concurrent-0001"), r);
    assert.equal((await state(db, a.id)).gifts[0].remaining, 0);
  } finally {
    await db.close();
  }
});
import { maskText, nextSelfPage } from "../shared/self-service.ts";
test("大屏12人分页稳定排队，作废跳过，播完循环及通用打码", () => {
  const winners = Array.from({ length: 25 }, (_, i) => ({ id: String(i) }));
  const first = nextSelfPage(winners, []);
  assert.equal(first.ids.length, 12);
  const second = nextSelfPage(winners, first.seen);
  assert.deepEqual(
    second.ids,
    winners.slice(12, 24).map((w) => w.id),
  );
  const last = nextSelfPage(winners, second.seen);
  assert.deepEqual(last.ids, ["24"]);
  assert.deepEqual(nextSelfPage(winners, last.seen).ids, first.ids);
  assert.deepEqual(
    nextSelfPage(
      winners.filter((w) => w.id !== "12"),
      first.seen,
    ).ids,
    winners.slice(13, 25).map((w) => w.id),
  );
  assert.equal(maskText("张三丰"), "张*丰");
  assert.equal(maskText("中央门店"), "中**店");
  assert.equal(maskText(""), "");
});
test("两次机会、作废恢复、归档拒绝新请求但恢复历史以及禁用资格", async () => {
  const { db, a, people, codes } = await setup(4);
  try {
    await updatePerson(db, a.id, people[0].id, { drawChances: 2 });
    const first = await selfDraw(db, a.id, codes[0].code, "two-chances-0001");
    await selfReveal(db, a.id, codes[0].code, "two-chances-0001");
    await selfDraw(db, a.id, codes[0].code, "two-chances-0002");
    await selfReveal(db, a.id, codes[0].code, "two-chances-0002");
    await assert.rejects(
      selfDraw(db, a.id, codes[0].code, "two-chances-0003"),
      /机会/,
    );
    const { voidWinner, updateActivity } = await import("../server/domain.ts");
    await voidWinner(db, a.id, first[0].id, "测试恢复机会");
    assert.equal(
      (await participantState(db, a.id, codes[0].code)).remainingChances,
      1,
    );
    assert.equal((await selfStage(db, a.id)).winners.length, 1);
    await updatePerson(db, a.id, people[1].id, { enabled: false });
    await assert.rejects(participantState(db, a.id, codes[1].code), /抽奖码/);
    await updateActivity(db, a.id, { archived: true });
    await assert.rejects(
      selfDraw(db, a.id, codes[0].code, "two-chances-0004"),
      /归档/,
    );
    const recovered = await selfDraw(
      db,
      a.id,
      codes[0].code,
      "two-chances-0001",
    );
    assert.equal(recovered[0].id, first[0].id);
    assert.equal(recovered[0].voided, true);
  } finally {
    await db.close();
  }
});
test("等待活动锁跨过截止时间时禁止新抽奖", async () => {
  const { db, a, codes } = await setup();
  try {
    const end = Date.now() + 150;
    await configureSelf(db, a.id, {
      enabled: true,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(end).toISOString(),
    });
    let unlock!: () => void, locked!: () => void;
    const acquired = new Promise<void>((r) => (locked = r)),
      release = new Promise<void>((r) => (unlock = r));
    const held = db.transaction(async (sql) => {
      await sql.query("SELECT data FROM activities WHERE id=$1 FOR UPDATE", [
        a.id,
      ]);
      locked();
      await release;
    });
    await acquired;
    const pending = selfDraw(db, a.id, codes[0].code, "late-locked-request");
    const rejection = assert.rejects(pending, /结束/);
    await new Promise((r) => setTimeout(r, 220));
    unlock();
    await held;
    await rejection;
  } finally {
    await db.close();
  }
});
test("自主抽奖先滚动隐藏结果，停止只揭晓原结果且幂等，超时自动可见", async () => {
  const { db, a, codes } = await setup(3);
  try {
    const result = await selfDraw(db, a.id, codes[0].code, "rolling-test-0001");
    assert.equal((await selfStage(db, a.id)).winners.length, 0);
    const { getStage } = await import("../server/stage.ts");
    const { stageState } = await import("../server/domain.ts");
    assert.equal((await getStage(db, a.id)).rounds.length, 0);
    assert.equal((await stageState(db, a.id)).rounds.length, 0);
    const me = await participantState(db, a.id, codes[0].code);
    assert.equal(me.winners.length, 0);
    assert.equal(me.pendingDraw?.requestId, "rolling-test-0001");
    const { selfReveal } = await import("../server/self-service.ts");
    await assert.rejects(
      selfReveal(db, a.id, codes[1].code, "rolling-test-0001"),
      /未找到/,
    );
    assert.deepEqual(
      await selfReveal(db, a.id, codes[0].code, "rolling-test-0001"),
      result,
    );
    assert.deepEqual(
      await selfReveal(db, a.id, codes[0].code, "rolling-test-0001"),
      result,
    );
    assert.equal((await selfStage(db, a.id)).winners.length, 1);
    assert.equal((await state(db, a.id)).gifts[0].remaining, 2);
    await selfDraw(db, a.id, codes[1].code, "rolling-timeout-0001");
    const { mutate } = await import("../server/domain.ts");
    await mutate(db, a.id, (a) => {
      a.rounds[0].selfRevealAt = new Date(Date.now() - 1).toISOString();
    });
    assert.equal((await selfStage(db, a.id)).winners.length, 2);
  } finally {
    await db.close();
  }
});
import { syncSpotlights, finishSpotlight } from "../shared/self-service.ts";
test("新中奖按顺序放大一次，历史不重播，重复轮询不重入，作废退出队列", () => {
  const baseline = syncSpotlights(null, [{ id: "old" }]);
  assert.deepEqual(baseline.queue, []);
  const incoming = syncSpotlights(baseline, [
    { id: "old" },
    { id: "new1" },
    { id: "new2" },
  ]);
  assert.deepEqual(incoming.queue, ["new1", "new2"]);
  assert.deepEqual(
    syncSpotlights(incoming, [{ id: "old" }, { id: "new1" }, { id: "new2" }]),
    incoming,
  );
  const completed = finishSpotlight(incoming);
  assert.deepEqual(completed.done, ["old", "new1"]);
  assert.deepEqual(completed.queue, ["new2"]);
  assert.deepEqual(
    syncSpotlights(completed, [{ id: "old" }, { id: "new1" }]).queue,
    [],
  );
  assert.deepEqual(
    syncSpotlights(completed, [{ id: "old" }, { id: "new1" }, { id: "new2" }])
      .queue,
    ["new2"],
  );
});

test("自主与现场同时抽奖共享库存和个人机会", async () => {
  for (const samePerson of [false, true]) {
    const { db, a, people, codes } = await setup(samePerson ? 2 : 1);
    try {
      const results = await Promise.allSettled([
        selfDraw(db, a.id, codes[0].code, "mixed-self-0001"),
        draw(db, a.id, { mode: "single", personId: people[samePerson ? 0 : 1].id, requestId: "mixed-admin-0001" }),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const current = await state(db, a.id);
      assert.equal(current.gifts[0].remaining, samePerson ? 1 : 0);
      assert.equal(current.rounds.flatMap(r => r.winners).length, 1);
    } finally { await db.close(); }
  }
});

test("现场舞台滚动期间，其他人仍可自主抽奖并共享库存", async () => {
  const { db, a, people, codes } = await setup(2);
  try {
    const { stageCommand } = await import('../server/stage.ts');
    await stageCommand(db, a.id, { requestId: 'stage-mixed-0001', expectedVersion: 0, action: 'start', selection: { mode: 'single', personId: people[0].id } });
    await selfDraw(db, a.id, codes[1].code, 'self-mixed-0001');
    assert.equal((await state(db, a.id)).gifts[0].remaining, 0);
    assert.equal((await state(db, a.id)).rounds.length, 2);
  } finally { await db.close(); }
});

test("大屏滚动未揭晓期间，参与者自助端不提前泄露大屏中奖结果", async () => {
  const { db, a, people, codes } = await setup(2);
  try {
    const { stageCommand } = await import("../server/stage.ts");
    const started = await stageCommand(db, a.id, {
      requestId: "stage-hide-self-0001",
      expectedVersion: 0,
      action: "start",
      selection: { mode: "single", personId: people[0].id },
    });
    const duringRoll = await participantState(db, a.id, codes[0].code);
    assert.equal(duringRoll.winners.length, 0);
    await stageCommand(db, a.id, {
      requestId: "stage-hide-self-stop",
      expectedVersion: started.session.version,
      action: "stop",
    });
    const afterReveal = await participantState(db, a.id, codes[0].code);
    assert.equal(afterReveal.winners.length, 1);
  } finally {
    await db.close();
  }
});
