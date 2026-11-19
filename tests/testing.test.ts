import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db.ts";
import { createActivity, state, draw } from "../server/domain.ts";
import { createTestActivity, testData } from "../server/testing.ts";
import { stageCommand, getStage } from "../server/stage.ts";
test("测试工具仅作用于独立测试活动；重复请求不重复导入，重置保留名单礼品并恢复库存", async () => {
  const db = await createDb();
  try {
    const formal = await createActivity(db, { name: "正式活动" });
    await assert.rejects(
      testData(db, formal.id, {
        requestId: crypto.randomUUID(),
        action: "all",
        count: 100,
      }),
      /测试活动/,
    );
    const a = await createTestActivity(db);
    const input = { requestId: crypto.randomUUID(), action: "all", count: 100 };
    await testData(db, a.id, input);
    await testData(db, a.id, input);
    let s = await state(db, a.id);
    assert.equal(s.testMode, true);
    assert.equal(s.people.length, 100);
    assert.equal(s.gifts.length, 6);
    assert.equal(s.people.filter((p) => p.checkedIn).length, 80);
    const first = s.people[0];
    await draw(db, a.id, {
      requestId: crypto.randomUUID(),
      mode: "single",
      personId: first.id,
    });
    const v = await getStage(db, a.id);
    assert.equal(v.testMode, true);
    const reset = {
      requestId: crypto.randomUUID(),
      action: "reset",
      expectedVersion: v.session.version,
    };
    await testData(db, a.id, reset);
    s = await state(db, a.id);
    assert.equal(s.rounds.length, 0);
    assert.equal(s.people.length, 100);
    assert.equal(s.gifts[0].remaining, s.gifts[0].total);
    await draw(db, a.id, {
      requestId: crypto.randomUUID(),
      mode: "single",
      personId: first.id,
    });
    await testData(db, a.id, reset);
    assert.equal(
      (await state(db, a.id)).rounds.length,
      1,
      "旧重置请求重试不得清除新中奖",
    );
    await assert.rejects(testData(db, a.id, { ...input, count: 20 }), /标识/);
  } finally {
    await db.close();
  }
});
test("测试批量数据遵守上限；抽奖进行中不能注入或清空", async () => {
  const db = await createDb();
  try {
    const a = await createTestActivity(db);
    await testData(db, a.id, {
      requestId: crypto.randomUUID(),
      action: "all",
      count: 20,
    });
    const s = await state(db, a.id);
    await assert.rejects(
      testData(db, a.id, {
        requestId: crypto.randomUUID(),
        action: "people",
        count: 10001,
      }),
      /人数/,
    );
    await stageCommand(db, a.id, {
      requestId: crypto.randomUUID(),
      expectedVersion: (await getStage(db, a.id)).session.version,
      action: "start",
      selection: { mode: "single", personId: s.people[0].id },
    });
    for (const action of ["reset", "people", "gifts"])
      await assert.rejects(
        testData(db, a.id, {
          requestId: crypto.randomUUID(),
          action,
          count: 20,
          expectedVersion: 0,
        }),
        /进行/,
      );
  } finally {
    await db.close();
  }
});
