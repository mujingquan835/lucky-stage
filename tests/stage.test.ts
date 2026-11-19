import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db.ts";
import {
  createActivity,
  addPeople,
  saveGift,
  state,
  draw,
  updatePerson,
  voidWinner,
  savePersonPhotos,
} from "../server/domain.ts";
import {
  stageCommand,
  getStage,
  saveRoundPlan,
  claimWinner,
} from "../server/stage.ts";
async function setup() {
  const db = await createDb();
  const a = await createActivity(db, { name: "现场测试" });
  const p = await addPeople(db, a.id, [
    { name: "甲", phone: "0001", company: "A", store: "一店" },
    { name: "乙", phone: "0002", company: "B", store: "二店" },
    { name: "丙", phone: "0003", company: "A", store: "一店" },
  ]);
  const g = await saveGift(db, a.id, { name: "好礼", total: 8 });
  return { db, a, p, g };
}
async function command(db: any, id: string, action: string, extra: any = {}) {
  const v = await getStage(db, id);
  return stageCommand(db, id, {
    requestId: crypto.randomUUID(),
    expectedVersion: v.session.version,
    action,
    ...extra,
  });
}
test("人物照片补传不增加机会，并在大屏中奖结果保留当时照片", async () => {
  const { db, a, p } = await setup();
  try {
    const photo = "/api/images/00000000-0000-4000-8000-000000000000.webp";
    await savePersonPhotos(db, a.id, [{ personId: p[0].id, photo }]);
    assert.equal((await state(db, a.id)).people[0].remainingChances, 1);
    assert.equal((await getStage(db, a.id)).participants[0].photo, photo);
    await command(db, a.id, "start", { selection: { mode: "single", personId: p[0].id } });
    await command(db, a.id, "stop");
    await savePersonPhotos(db, a.id, [{ personId: p[0].id, photo: "" }]);
    assert.equal((await getStage(db, a.id)).currentRound?.winners[0].personPhoto, photo);
  } finally {
    await db.close();
  }
});
test("同轮指定和随机共用库存，舞台只揭晓结果", async () => {
  const { db, a, p, g } = await setup();
  try {
    const selection = { mode: "batch" as const, count: 2, giftId: g.id,
      assignments: [{ personId: p[2].id }] };
    const cmd = { requestId: "mixed-000001", expectedVersion: 0,
      action: "start" as const, selection };
    const started = await stageCommand(db, a.id, cmd);
    assert.deepEqual(await stageCommand(db, a.id, cmd), started);
    const result = await state(db, a.id);
    const winners = result.rounds[0].winners;
    assert.equal(winners.find(w => w.personId === p[2].id)?.assignment, "assigned");
    assert.equal(winners.filter(w => w.assignment === "random").length, 1);
    assert.equal(new Set(winners.map(w => w.personId)).size, 2);
    assert.equal(result.gifts[0].remaining, 6);
    const rolling = await getStage(db, a.id);
    assert.equal(rolling.currentRound, null);
    assert.ok(!JSON.stringify(rolling).includes("assignments"));
    await command(db, a.id, "stop");
    const revealed = await getStage(db, a.id);
    assert.equal(revealed.currentRound?.winners.length, 2);
    assert.ok(!JSON.stringify(revealed).includes('"assignment"'));
  } finally {
    await db.close();
  }
});
test("逐轮选奖抽人，每轮重查全名单里仍有机会的人", async () => {
  const { db, a, p, g } = await setup();
  try {
    const second = await saveGift(db, a.id, { name: "二等奖", total: 3, singleEnabled: false });
    for (const person of p) await updatePerson(db, a.id, person.id, { drawChances: 2 });
    for (const gift of [g, second]) {
      await command(db, a.id, "start", { selection: { mode: "batch", count: 3, giftId: gift.id } });
      await command(db, a.id, "stop");
      const winners = (await getStage(db, a.id)).currentRound!.winners;
      assert.equal(winners.length, 3);
      assert.equal(new Set(winners.map(winner => winner.personName)).size, 3);
      assert.ok(winners.every(winner => winner.giftId === gift.id));
    }
  } finally {
    await db.close();
  }
});
test("会前保存多轮指定名单，主舞台只读取展示字段，单人指定可开奖", async () => {
  const { db, a, p, g } = await setup();
  try {
    const one = await saveRoundPlan(db, a.id, { name: "一等奖", giftId: g.id, count: 1, assignedPersonIds: [p[0].id] });
    const two = await saveRoundPlan(db, a.id, { name: "二等奖", giftId: g.id, count: 2, assignedPersonIds: [p[1].id] });
    assert.deepEqual((await getStage(db, a.id, true)).plans.map(plan => plan.assignedPersonIds), [[p[0].id], [p[1].id]]);
    assert.ok(!JSON.stringify(await getStage(db, a.id)).includes("assignedPersonIds"));
    for (const plan of [one, two]) {
      await command(db, a.id, "start", { selection: { mode: "batch", count: plan.count, giftId: g.id, planId: plan.id } });
      assert.equal((await getStage(db, a.id)).currentRound, null);
      await command(db, a.id, "stop");
    }
    const result = await state(db, a.id);
    assert.deepEqual(result.rounds.map(round => round.winners.filter(winner => winner.assignment === "assigned").map(winner => winner.personId)), [[p[1].id], [p[0].id]]);
    assert.equal(result.gifts[0].remaining, 5);
  } finally {
    await db.close();
  }
});
test("混合轮次指定名额占用单批上限，余量不足整轮不写入", async () => {
  const { db, a, p, g } = await setup();
  try {
    await saveGift(db, a.id, { ...g, batchLimit: 1 });
    await assert.rejects(command(db, a.id, "start", {
      selection: { mode: "batch", count: 2, assignments: [{ personId: p[0].id, giftId: g.id }] },
    }), /库存或合格人数不足/);
    const result = await state(db, a.id);
    assert.equal(result.rounds.length, 0);
    assert.equal(result.gifts[0].remaining, 8);
    assert.equal(result.people[0].remainingChances, 1);
    assert.equal((await getStage(db, a.id)).session.version, 0);
  } finally {
    await db.close();
  }
});
test("手机添加礼品原请求可并发重试，不重复增加礼品", async () => {
  const { db, a } = await setup();
  try {
    const input = { requestId: "mobile-gift-0001", name: "追加礼品", total: 3 };
    const [first, second] = await Promise.all([
      saveGift(db, a.id, input), saveGift(db, a.id, input),
    ]);
    assert.deepEqual(first, second);
    assert.equal((await state(db, a.id)).gifts.length, 2);
    await assert.rejects(saveGift(db, a.id, { ...input, total: 4 }), /请求标识/);
  } finally {
    await db.close();
  }
});
test("舞台开始只提交一轮，滚动隐藏结果，停止揭晓与重播不扣库存", async () => {
  const { db, a, p } = await setup();
  try {
    const v = await getStage(db, a.id);
    assert.equal(v.session.scene, "welcome");
    const cmd = {
      requestId: "stage-start-0001",
      expectedVersion: 0,
      action: "start" as const,
      selection: { mode: "single" as const, personId: p[0].id },
    };
    const r = await stageCommand(db, a.id, cmd);
    assert.deepEqual(await stageCommand(db, a.id, cmd), r);
    let stage = await getStage(db, a.id);
    assert.equal(stage.session.phase, "rolling");
    assert.equal(stage.currentRound, null);
    assert.equal(stage.rounds.length, 0);
    assert.ok(!JSON.stringify(stage).includes('\"phone\"'));
    await assert.rejects(
      voidWinner(
        db,
        a.id,
        (await state(db, a.id)).rounds[0].winners[0].id,
        "提前作废",
      ),
      /揭晓|进行/,
    );
    await assert.rejects(
      command(db, a.id, "start", {
        selection: { mode: "single", personId: p[1].id },
      }),
      /进行|本轮/,
    );
    await assert.rejects(
      draw(db, a.id, {
        requestId: "legacy-race-0001",
        mode: "single",
        personId: p[1].id,
      }),
      /进行|本轮/,
    );
    await command(db, a.id, "stop");
    stage = await getStage(db, a.id);
    assert.equal(stage.session.phase, "revealed");
    assert.equal(stage.currentRound?.winners[0].personName, "甲");
    const before = await state(db, a.id);
    await command(db, a.id, "replay");
    await command(db, a.id, "skip");
    const after = await state(db, a.id);
    assert.equal(after.rounds.length, 1);
    assert.equal(after.gifts[0].remaining, before.gifts[0].remaining);
  } finally {
    await db.close();
  }
});
test("旧版本及相同ID不同命令冲突；30秒到期能从新请求恢复结果", async () => {
  const { db, a, p } = await setup();
  try {
    await command(db, a.id, "start", {
      selection: { mode: "single", personId: p[0].id },
    });
    await assert.rejects(
      stageCommand(db, a.id, {
        requestId: "stale-scene-0001",
        expectedVersion: 0,
        action: "scene",
        scene: "gifts",
      }),
      /版本/,
    );
    await db.query(
      "UPDATE activities SET data=jsonb_set(data,'{stageSession,deadline}',to_jsonb($2::text)) WHERE id=$1",
      [a.id, "2000-01-01T00:00:00.000Z"],
    );
    const s = await getStage(db, a.id);
    assert.equal(s.session.phase, "revealed");
    assert.equal(s.currentRound?.winners.length, 1);
    const cmd = {
      requestId: "same-command-001",
      expectedVersion: s.session.version,
      action: "scene" as const,
      scene: "gifts" as const,
    };
    await stageCommand(db, a.id, cmd);
    await assert.rejects(
      stageCommand(db, a.id, { ...cmd, scene: "end" }),
      /请求标识/,
    );
  } finally {
    await db.close();
  }
});
test("轮次与公司门店到场筛选在事务内生效，重复开始不重复完成计划", async () => {
  const { db, a, p, g } = await setup();
  try {
    await updatePerson(db, a.id, p[0].id, { checkedIn: true });
    await updatePerson(db, a.id, p[2].id, { checkedIn: true });
    const plan = await saveRoundPlan(db, a.id, {
      name: "三等奖第一轮",
      giftId: g.id,
      count: 2,
    });
    await command(db, a.id, "start", {
      selection: {
        mode: "batch",
        planId: plan.id,
        scope: { company: "A", store: "一店", checkedInOnly: true },
      },
    });
    await command(db, a.id, "skip");
    const s = await state(db, a.id);
    assert.deepEqual(
      new Set(s.rounds[0].winners.map((w) => w.personId)),
      new Set([p[0].id, p[2].id]),
    );
    assert.equal(s.roundPlans?.[0].completedRoundId, s.rounds[0].id);
    await assert.rejects(
      command(db, a.id, "start", {
        selection: { mode: "batch", planId: plan.id },
      }),
      /完成/,
    );
  } finally {
    await db.close();
  }
});
test("领奖核销幂等，撤销需原因，已领取中奖不能直接作废", async () => {
  const { db, a, p } = await setup();
  try {
    const r = await draw(db, a.id, {
      requestId: "claim-draw-0001",
      mode: "single",
      personId: p[0].id,
    });
    const cmd = {
      requestId: "claim-command-01",
      expectedVersion: 0,
      claimed: true,
    };
    const w = await claimWinner(db, a.id, r.winners[0].id, cmd);
    assert.equal(w.claimed, true);
    assert.deepEqual(await claimWinner(db, a.id, r.winners[0].id, cmd), w);
    await assert.rejects(
      voidWinner(db, a.id, r.winners[0].id, "测试"),
      /领取|核销/,
    );
    await assert.rejects(
      claimWinner(db, a.id, r.winners[0].id, {
        requestId: "claim-undo-0001",
        expectedVersion: 1,
        claimed: false,
      }),
      /原因/,
    );
    await claimWinner(db, a.id, r.winners[0].id, {
      requestId: "claim-undo-0002",
      expectedVersion: 1,
      claimed: false,
      reason: "现场确认撤销",
    });
    await voidWinner(db, a.id, r.winners[0].id, "撤销后作废");
    assert.equal((await state(db, a.id)).gifts[0].remaining, 8);
  } finally {
    await db.close();
  }
});

test("舞台命令不得复用旧抽奖请求标识", async () => {
  const { db, a, p } = await setup();
  try {
    await draw(db, a.id, {
      requestId: "collision-draw-01",
      mode: "single",
      personId: p[0].id,
    });
    await assert.rejects(
      stageCommand(db, a.id, {
        requestId: "collision-draw-01",
        expectedVersion: 0,
        action: "start",
        selection: { mode: "single", personId: p[0].id },
      }),
      /请求标识/,
    );
  } finally {
    await db.close();
  }
});
for (const count of [1000, 10000])
  test(`${count} 人名单按完整业务池抽奖，舞台显示池限制120人`, async () => {
    const db = await createDb();
    try {
      const a = await createActivity(db, { name: "规模验证" });
      await addPeople(
        db,
        a.id,
        Array.from({ length: count }, (_, i) => ({
          name: `来宾${i}`,
          phone: `13${String(i).padStart(9, "0")}`,
          company: i % 2 ? "A" : "B",
          store: "一店",
        })),
      );
      const g = await saveGift(db, a.id, { name: "集体礼品", total: 100 });
      const started = Date.now();
      await command(db, a.id, "start", {
        selection: {
          mode: "batch",
          giftId: g.id,
          count: 50,
          scope: { company: "A" },
        },
      });
      const s = await getStage(db, a.id);
      assert.equal(s.participants.length, 120);
      assert.ok(s.participants.every((p) => p.company === "A"));
      await command(db, a.id, "skip");
      const result = await state(db, a.id);
      assert.equal(result.rounds[0].winners.length, 50);
      assert.equal(
        new Set(result.rounds[0].winners.map((w) => w.personId)).size,
        50,
      );
      assert.ok(result.rounds[0].winners.every((w) => w.company === "A"));
      assert.equal(result.summary.eligibleCount, count - 50);
      assert.equal(result.gifts[0].remaining, 50);
      assert.ok(
        Date.now() - started < 15000,
        "本地事务应在15秒内完成；不代表现场帧率",
      );
    } finally {
      await db.close();
    }
  });
test("旧活动缺少舞台字段可兼容读取，复制配置重置轮次进度", async () => {
  const { db, a, g } = await setup();
  try {
    await saveRoundPlan(db, a.id, { name: "复制测试", giftId: g.id, count: 1 });
    await db.query(
      "UPDATE activities SET data=data-'stageSession'-'stageConfig'-'stageOps' WHERE id=$1",
      [a.id],
    );
    assert.equal((await getStage(db, a.id)).session.scene, "welcome");
    const { copyActivity } = await import("../server/domain.ts");
    const copied = await copyActivity(db, a.id, "新场次");
    const s = await state(db, copied.id);
    assert.equal(s.rounds.length, 0);
    assert.equal(s.roundPlans.length, 1);
    assert.equal(s.roundPlans[0].giftId, s.gifts[0].id);
    assert.equal(s.stageSession.version, 0);
  } finally {
    await db.close();
  }
});

test("轮次修改推进版本，旧主持预览不能静默改变抽奖人数", async () => {
  const { db, a, g } = await setup();
  try {
    const plan = await saveRoundPlan(db, a.id, {
      name: "一等奖",
      giftId: g.id,
      count: 1,
    });
    await command(db, a.id, "prepare", {
      selection: { mode: "batch", planId: plan.id, giftId: g.id, count: 1 },
    });
    const before = await getStage(db, a.id);
    await saveRoundPlan(db, a.id, {
      id: plan.id,
      name: plan.name,
      giftId: g.id,
      count: 2,
    });
    const updated = await getStage(db, a.id);
    assert.ok(updated.session.version > before.session.version);
    await assert.rejects(
      stageCommand(db, a.id, {
        requestId: crypto.randomUUID(),
        expectedVersion: before.session.version,
        action: "start",
        selection: before.session.selection!,
      }),
      /版本/,
    );
    // Even a polling host with the new version must confirm changed plan values.
    await assert.rejects(
      stageCommand(db, a.id, {
        requestId: crypto.randomUUID(),
        expectedVersion: updated.session.version,
        action: "start",
        selection: before.session.selection!,
      }),
      /轮次.*变化/,
    );
    assert.equal((await state(db, a.id)).rounds.length, 0);
  } finally {
    await db.close();
  }
});

test("临时增加礼品数量受活动锁保护并保留已发放数量", async () => {
  const { db, a, p, g } = await setup();
  try {
    const { increaseGift } = await import("../server/domain.ts");
    await draw(db, a.id, {
      requestId: crypto.randomUUID(),
      mode: "single",
      personId: p[0].id,
    });
    const result = await increaseGift(db, a.id, g.id, 3);
    assert.equal(result.total, 11);
    assert.equal(result.remaining, 10);
    await assert.rejects(increaseGift(db, a.id, g.id, -1), /数量/);
    await command(db, a.id, "start", {
      selection: { mode: "single", personId: p[1].id },
    });
    await assert.rejects(increaseGift(db, a.id, g.id, 1), /进行/);
  } finally {
    await db.close();
  }
});

test("舞台批量随机礼品可正常开启、重试并揭晓", async () => {
  const {db,a}=await setup();
  try {
    const cmd={requestId:'stage-random-batch-001',expectedVersion:0,action:'start' as const,selection:{mode:'batch' as const,count:2}};
    const first=await stageCommand(db,a.id,cmd);
    assert.deepEqual(await stageCommand(db,a.id,cmd),first);
    assert.equal((await state(db,a.id)).rounds[0].winners.length,2);
    const view=await getStage(db,a.id);
    await stageCommand(db,a.id,{requestId:'stage-random-stop-001',expectedVersion:view.session.version,action:'stop'});
    assert.equal((await getStage(db,a.id)).currentRound?.winners.length,2);
  } finally {await db.close();}
});

test("30秒到期后旧版本命令返回409时，自动揭晓状态仍持久化落库", async () => {
  const { db, a, p } = await setup();
  try {
    const started = await stageCommand(db, a.id, {
      requestId: "stage-expire-409-start",
      expectedVersion: 0,
      action: "start",
      selection: { mode: "single", personId: p[0].id },
    });
    const staleVersion = started.session.version;
    const raw = (await db.query("SELECT data FROM activities WHERE id=$1", [a.id])).rows[0].data;
    raw.stageSession.deadline = new Date(Date.now() - 5000).toISOString();
    await db.query("UPDATE activities SET data=$1::jsonb WHERE id=$2", [JSON.stringify(raw), a.id]);
    await assert.rejects(
      stageCommand(db, a.id, {
        requestId: "stage-expire-409-stop",
        expectedVersion: staleVersion,
        action: "stop",
      }),
      /版本已变化/,
    );
    const persisted = (await db.query("SELECT data FROM activities WHERE id=$1", [a.id])).rows[0].data;
    assert.equal(persisted.stageSession.phase, "revealed");
    assert.equal(persisted.stageSession.version, staleVersion + 1);
  } finally {
    await db.close();
  }
});
