import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../server/db.ts";
import {
  draw,
  voidWinner,
  createActivity,
  addPeople,
  saveGift,
  state,
  updateActivity,
  updatePerson,
} from "../server/domain.ts";
import * as domain from "../server/domain.ts";
test("名单统计区分总人数、已抽人数、总机会与启用人员剩余机会", async () => {
  const {db,a,p} = await setup(5);
  try {
    await updatePerson(db,a.id,p[0].id,{drawChances:3});
    await updatePerson(db,a.id,p[2].id,{enabled:false});
    await draw(db,a.id,{requestId:"stats-person-001",mode:"single",personId:p[0].id});
    const s=await state(db,a.id);
    assert.deepEqual((s.summary as any).peopleStats,{totalPeople:3,drawnPeople:1,totalChances:5,remainingChances:3});
  } finally {await db.close();}
});
test("清空名单需匹配预览版本并可安全重试，旧抽奖码失效", async () => {
  const {db,a,p} = await setup();
  try {
    await domain.mutate(db,a.id,v => { v.selfService = {enabled:true,startsAt:"",endsAt:"",codes:{[p[0].id]:"0123456789ABCDEFABCD"}}; });
    const before = await state(db,a.id);
    assert.equal(typeof (domain as any).clearPeople, "function");
    const result = await (domain as any).clearPeople(db,a.id,{requestId:"clear-people-test-001",peopleVersion:(before as any).peopleVersion});
    assert.equal(result.removed,3);
    await addPeople(db,a.id,[{name:"新人员",phone:"009"}]);
    assert.deepEqual(await (domain as any).clearPeople(db,a.id,{requestId:"clear-people-test-001",peopleVersion:(before as any).peopleVersion}),result);
    const after=await state(db,a.id);
    assert.equal(after.people.length,1);
    assert.deepEqual(after.selfService?.codes,{});
  } finally {await db.close();}
});
test("有有效中奖记录时拒绝清空，保留名单和库存", async () => {
  const {db,a,p} = await setup();
  try {
    await draw(db,a.id,{requestId:"clear-prior-draw-001",mode:"single",personId:p[0].id});
    const before=await state(db,a.id);
    assert.equal(typeof (domain as any).clearPeople, "function");
    await assert.rejects((domain as any).clearPeople(db,a.id,{requestId:"clear-people-test-002",peopleVersion:(before as any).peopleVersion}),/有效中奖/);
    const after=await state(db,a.id);
    assert.equal(after.people.length,3);
    assert.equal(after.gifts[0].remaining,2);
  } finally {await db.close();}
});
test("名单变动后旧确认不可清空新名单", async () => {
  const {db,a} = await setup();
  try {
    const before=await state(db,a.id);
    await addPeople(db,a.id,[{name:"新人员",phone:"009"}]);
    assert.equal(typeof (domain as any).clearPeople, "function");
    await assert.rejects((domain as any).clearPeople(db,a.id,{requestId:"clear-people-test-003",peopleVersion:(before as any).peopleVersion}),/名单.*变化/);
    assert.equal((await state(db,a.id)).people.length,4);
  } finally {await db.close();}
});
test("现场开奖中不允许清空名单", async () => {
  const {db,a} = await setup();
  try {
    await domain.mutate(db,a.id,v => {v.stageSession.phase="rolling";v.stageSession.deadline=new Date(Date.now()+60000).toISOString()});
    const s=await state(db,a.id);
    await assert.rejects(domain.clearPeople(db,a.id,{requestId:"clear-active-001",peopleVersion:s.peopleVersion}),/抽奖进行中/);
    assert.equal((await state(db,a.id)).people.length,3);
  } finally {await db.close();}
});
test("多表重复人员合并机会，已有人员追加且重试不重复增加", async () => {
  const { db, a, p } = await setup();
  try {
    const rows = [
      {name:"甲", phone:"001", store:"", sheet:"一", row:2},
      {name:"甲", phone:"001", store:"", sheet:"二", row:2},
      {name:"新客", phone:"004", store:"", sheet:"二", row:3},
      {name:"新客", phone:"004", store:"", sheet:"二", row:4},
      {name:"新客", phone:"004", store:"", sheet:"二", row:5},
    ];
    assert.equal(typeof domain.previewPeopleImport, "function");
    const result = domain.previewPeopleImport(await state(db,a.id) as any, rows);
    assert.deepEqual(result.rows.map(v => [v.name,v.addChances,v.totalChances]), [["甲",2,3],["新客",3,3]]);
    await domain.importPeople(db,a.id,rows,"import-request-001");
    await domain.importPeople(db,a.id,rows,"import-request-001");
    const s = await state(db,a.id);
    assert.equal(s.people.find(v => v.id===p[0].id)?.drawChances,3);
    assert.equal(s.people.find(v => v.phone==="004")?.drawChances,3);
    assert.equal(s.people.length,4);
  } finally { await db.close(); }
});
test("同电话不同姓名拒绝整次导入且保持原名单", async () => {
  const {db,a} = await setup();
  try {
    assert.equal(typeof domain.importPeople, "function");
    await assert.rejects(domain.importPeople(db,a.id,[{name:"其他人",phone:"001"}],"import-conflict-1"), /姓名.*不一致/);
    assert.equal((await state(db,a.id)).people.length,3);
  } finally { await db.close(); }
});
test("预览后机会改变时拒绝旧预览，避免按过期次数导入", async () => {
  const {db,a,p} = await setup();
  try {
    const rows = [{name:"甲", phone:"001"}];
    const preview = domain.previewPeopleImport(await state(db,a.id) as any, rows);
    await updatePerson(db,a.id,p[0].id,{drawChances:4});
    await assert.rejects(domain.importPeople(db,a.id,rows,"stale-import-001",preview.planToken),/重新预览/);
    assert.equal((await state(db,a.id)).people.find(v => v.id===p[0].id)?.drawChances,4);
  } finally { await db.close(); }
});
async function setup(total = 3, repeat = false) {
  const db = await createDb();
  const a = await createActivity(db, { name: "测试活动", allowRepeat: repeat });
  const p = await addPeople(db, a.id, [
    { name: "甲", phone: "001" },
    { name: "乙", phone: "002" },
    { name: "丙", phone: "003" },
  ]);
  const g = await saveGift(db, a.id, {
    name: "礼品",
    total,
    singleEnabled: true,
  });
  return { db, a, p, g };
}
test("单人扣库存，重试不重复落库，参数不同拒绝", async () => {
  const { db, a, p, g } = await setup();
  try {
    const input = {
      requestId: "request-00001",
      mode: "single" as const,
      personId: p[0].id,
    };
    const r = await draw(db, a.id, input);
    assert.equal(r.winners.length, 1);
    assert.equal(r.winners[0].personName, "甲");
    assert.deepEqual(await draw(db, a.id, input), r);
    assert.equal((await state(db, a.id)).gifts[0].remaining, 2);
    await assert.rejects(
      draw(db, a.id, { ...input, personId: p[1].id }),
      /请求标识/,
    );
    await assert.rejects(
      draw(db, a.id, { ...input, requestId: "request-00002" }),
      /已中奖/,
    );
  } finally {
    await db.close();
  }
});
test("批量人数不足整轮拒绝，人数无重复，两模式共享资格", async () => {
  const { db, a, p, g } = await setup();
  try {
    await assert.rejects(
      draw(db, a.id, {
        requestId: "batch-00001",
        mode: "batch",
        giftId: g.id,
        count: 4,
      }),
      /不足/,
    );
    const r = await draw(db, a.id, {
      requestId: "batch-00002",
      mode: "batch",
      giftId: g.id,
      count: 2,
    });
    assert.equal(new Set(r.winners.map((w) => w.personId)).size, 2);
    assert.equal((await state(db, a.id)).gifts[0].remaining, 1);
    await assert.rejects(
      draw(db, a.id, {
        requestId: "batch-00003",
        mode: "single",
        personId: r.winners[0].personId,
      }),
      /已中奖/,
    );
  } finally {
    await db.close();
  }
});
test("礼品单批上限限制批量抽奖，不影响单人抽奖与请求恢复", async () => {
  const { db, a, p, g } = await setup();
  try {
    await saveGift(db, a.id, { id: g.id, name: g.name, total: 3, batchLimit: 1 });
    await assert.rejects(draw(db, a.id, { requestId: "limit-batch-001", mode: "batch", giftId: g.id, count: 2 }), /单批.*1/);
    assert.equal((await state(db, a.id)).gifts[0].remaining, 3);
    const input = { requestId: "limit-batch-002", mode: "batch" as const, giftId: g.id, count: 1 };
    const result = await draw(db, a.id, input);
    const person = p.find(v => v.id !== result.winners[0].personId)!;
    await draw(db, a.id, { requestId: "limit-single-01", mode: "single", personId: person.id });
    assert.equal((await state(db, a.id)).gifts[0].remaining, 1);
    await saveGift(db, a.id, { id: g.id, name: g.name, total: 3, batchLimit: null });
    assert.equal((await state(db, a.id)).gifts[0].batchLimit, undefined);
    assert.deepEqual(await draw(db, a.id, input), result);
  } finally { await db.close(); }
});
test("礼品单批上限只接受 1 至 50 的整数或空值", async () => {
  const { db, a, g } = await setup();
  try {
    for (const batchLimit of [0, 51, 1.5, "1"]) {
      await assert.rejects(saveGift(db, a.id, { id: g.id, name: g.name, total: 3, batchLimit }), /单批/);
    }
  } finally { await db.close(); }
});
test("并发仅一轮成功，无超发；作废一次恢复库存资格", async () => {
  const { db, a, p, g } = await setup(1);
  try {
    const results = await Promise.allSettled(
      p.map((v, i) =>
        draw(db, a.id, {
          requestId: `concurrent-${i}`,
          mode: "single",
          personId: v.id,
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const s = await state(db, a.id);
    assert.equal(s.gifts[0].remaining, 0);
    const w = s.rounds[0].winners[0];
    await voidWinner(db, a.id, w.id, "测试作废");
    await assert.rejects(voidWinner(db, a.id, w.id, "重复作废"), /已作废/);
    await draw(db, a.id, {
      requestId: "after-void-001",
      mode: "single",
      personId: w.personId,
    });
    assert.equal((await state(db, a.id)).gifts[0].remaining, 0);
  } finally {
    await db.close();
  }
});
test("导入原子性与活动内电话去重，中奖快照不变", async () => {
  const { db, a, p, g } = await setup();
  try {
    await assert.rejects(
      addPeople(db, a.id, [
        { name: "丁", phone: "004" },
        { name: "重复", phone: "001" },
      ]),
      /重复/,
    );
    assert.equal((await state(db, a.id)).people.length, 3);
    const r = await draw(db, a.id, {
      requestId: "snapshot-001",
      mode: "single",
      personId: p[0].id,
    });
    await updatePerson(db, a.id, p[0].id, {
      name: "新姓名",
      phone: "001",
      company: "新公司",
      store: "",
    });
    assert.equal((await state(db, a.id)).rounds[0].winners[0].personName, "甲");
    await assert.rejects(
      saveGift(db, a.id, {
        id: g.id,
        name: "礼品",
        total: 0,
        singleEnabled: true,
      }),
      /数量/,
    );
  } finally {
    await db.close();
  }
});
test("首抽锁定重复规则；归档可读幂等结果但拒绝新抽奖", async () => {
  const { db, a, p } = await setup();
  try {
    const input = {
      requestId: "archive-00001",
      mode: "single" as const,
      personId: p[0].id,
    };
    const r = await draw(db, a.id, input);
    await assert.rejects(
      updateActivity(db, a.id, { allowRepeat: true }),
      /首轮/,
    );
    await updateActivity(db, a.id, { archived: true });
    assert.deepEqual(await draw(db, a.id, input), r);
    await assert.rejects(
      draw(db, a.id, {
        ...input,
        requestId: "archive-00002",
        personId: p[1].id,
      }),
      /归档/,
    );
    await assert.rejects(
      addPeople(db, a.id, [{ name: "丁", phone: "004" }]),
      /归档/,
    );
  } finally {
    await db.close();
  }
});
test("两次机会同批无放回，禁用参与者排除", async () => {
  const { db, a, p, g } = await setup(10, true);
  for (const person of p) await updatePerson(db,a.id,person.id,{drawChances:2});
  try {
    await updatePerson(db, a.id, p[0].id, { enabled: false });
    await draw(db, a.id, {
      requestId: "repeat-00001",
      mode: "batch",
      giftId: g.id,
      count: 2,
    });
    const r = await draw(db, a.id, {
      requestId: "repeat-00002",
      mode: "batch",
      giftId: g.id,
      count: 2,
    });
    assert.equal(new Set(r.winners.map((w) => w.personId)).size, 2);
    assert.ok(r.winners.every((w) => w.personId !== p[0].id));
  } finally {
    await db.close();
  }
});

test("删除活动与其他活动隔离，开奖中不可删除", async () => {
  const { db, a } = await setup();
  try {
    const other = await createActivity(db, { name: "保留活动" });
    const domain = await import("../server/domain.ts");
    await db.query("UPDATE activities SET data = jsonb_set(data, '{stageSession,phase}', '\"rolling\"'::jsonb) WHERE id=$1", [a.id]);
    await assert.rejects(domain.deleteActivity(db, a.id), /揭晓|进行/);
    await db.query("UPDATE activities SET data = jsonb_set(data, '{stageSession,phase}', '\"idle\"'::jsonb) WHERE id=$1", [a.id]);
    await domain.deleteActivity(db, a.id);
    await assert.rejects(state(db, a.id), /不存在/);
    assert.equal((await state(db, other.id)).name, "保留活动");
  } finally { await db.close(); }
});

test("对应销售可保存修改，抽奖范围按销售隔离", async () => {
 const {db,a,p,g}=await setup();
 try {
  await updatePerson(db,a.id,p[0].id,{salesperson:"销售甲"});
  await updatePerson(db,a.id,p[1].id,{salesperson:"销售乙"});
  assert.equal((await state(db,a.id)).people[0].salesperson,"销售甲");
  const r=await draw(db,a.id,{requestId:"sales-scope-0001",mode:"batch",giftId:g.id,count:1,scope:{salesperson:"销售甲"}});
  assert.equal(r.winners[0].personId,p[0].id);
 } finally {await db.close();}
});

test("两次机会限制并发和重试，增加机会仅补差额，作废恢复一次", async () => {
 const {db,a,p}=await setup(10);
 try {
  const input={requestId:"chance-first-0001",mode:"single" as const,personId:p[0].id};
  const first=await draw(db,a.id,input);
  await updatePerson(db,a.id,p[0].id,{drawChances:2});
  assert.equal((await state(db,a.id)).people[0].remainingChances,1);
  await draw(db,a.id,input);
  assert.equal((await state(db,a.id)).people[0].remainingChances,1);
  const results=await Promise.allSettled(["chance-next-0001","chance-next-0002"].map(requestId=>draw(db,a.id,{...input,requestId})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await state(db,a.id)).people[0].remainingChances,0);
  await voidWinner(db,a.id,first.winners[0].id,"恢复机会测试");
  assert.equal((await state(db,a.id)).people[0].remainingChances,1);
 } finally {await db.close();}
});

test("随机批量从单人奖池按库存抽取并遵守礼品单批上限，重试不重复扣库存", async () => {
  const { db, a, g } = await setup(3);
  try {
    await saveGift(db, a.id, { ...g, total: 3, batchLimit: 1 });
    const other = await saveGift(db, a.id, {name:'另一份礼品',total:2,singleEnabled:true});
    await saveGift(db, a.id, {name:'不参与奖池',total:10,singleEnabled:false});
    const input = {requestId:'random-batch-0001',mode:'batch' as const,count:3};
    const result = await draw(db,a.id,input);
    assert.equal(result.winners.length,3);
    assert.equal(new Set(result.winners.map(w=>w.personId)).size,3);
    assert.equal(result.winners.filter(w=>w.giftId===g.id).length,1);
    assert.equal(result.winners.filter(w=>w.giftId===other.id).length,2);
    assert.deepEqual(await draw(db,a.id,input),result);
    const s=await state(db,a.id);
    assert.equal(s.gifts.find(x=>x.id===g.id)?.remaining,2);
    assert.equal(s.gifts.find(x=>x.id===other.id)?.remaining,0);
  } finally { await db.close(); }
});

test("随机批量可用礼品份数不足时整批拒绝且不扣库存", async () => {
  const {db,a,g}=await setup(3);
  try {
    await saveGift(db,a.id,{...g,batchLimit:1});
    await assert.rejects(draw(db,a.id,{requestId:'random-batch-short-001',mode:'batch',count:2}),/库存或合格人数不足/);
    const s=await state(db,a.id);
    assert.equal(s.gifts[0].remaining,3);
    assert.equal(s.rounds.length,0);
  } finally {await db.close();}
});

test("增量导入遇到缺少drawChances字段的历史人员时按默认1次累加", async () => {
  const { db, a } = await setup(1);
  try {
    const raw = (await db.query("SELECT data FROM activities WHERE id=$1", [a.id])).rows[0].data;
    delete raw.people[0].drawChances;
    await db.query("UPDATE activities SET data=$1::jsonb WHERE id=$2", [JSON.stringify(raw), a.id]);
    const { previewPeopleImport, readActivity } = await import("../server/domain.ts");
    const current = await readActivity(db, a.id);
    const preview = previewPeopleImport(current, [
      { name: raw.people[0].name, phone: raw.people[0].phone, store: raw.people[0].store },
    ]);
    assert.equal(preview.rows[0].addChances, 1);
    assert.equal(preview.rows[0].totalChances, 2);
  } finally {
    await db.close();
  }
});
