import { test } from "node:test";
import assert from "node:assert/strict";
import { resultLines, rehearsalDraw } from "../web/src/live-support.ts";
test("结果图文字遵守展示权限且不读取电话", () => {
  const view: any = { name: "活动", showCompany: false, showStore: true };
  const round: any = {
    createdAt: "2026-10-29T00:00:00Z",
    winners: [
      {
        personName: "甲",
        company: "隐私公司",
        store: "门店",
        giftName: "礼物",
        phone: "13812345678",
      },
    ],
  };
  const lines = resultLines(view, round).join(" ");
  assert.ok(lines.includes("门店"));
  assert.ok(!lines.includes("隐私公司"));
  assert.ok(!lines.includes("13812345678"));
});
test("彩排扣减只作用于返回副本，并排除已中奖与筛选外人员", () => {
  const a: any = {
    allowRepeat: false,
    people: [
      { id: "1", name: "甲", enabled: true, company: "A" },
      { id: "2", name: "乙", enabled: true, company: "B" },
    ],
    gifts: [
      { id: "g", name: "礼物", total: 2, enabled: true, singleEnabled: true },
    ],
    rounds: [],
  };
  const r = rehearsalDraw(a, {
    mode: "batch",
    giftId: "g",
    count: 1,
    scope: { company: "A" },
  });
  assert.equal(r.winners[0].personName, "甲");
  assert.equal(a.rounds.length, 0);
  assert.equal(r.activity.rounds.length, 1);
  assert.throws(
    () =>
      rehearsalDraw(r.activity, {
        mode: "batch",
        giftId: "g",
        count: 1,
        scope: { company: "A" },
      }),
    /不足/,
  );
});

test("中奖墙图片只导出当前同步页，隐藏公司和已作废记录", () => {
  const view: any = {
    name: "活动",
    showCompany: false,
    showStore: true,
    session: { page: 1 },
    rounds: [
      {
        id: "r",
        createdAt: "2026-10-29T00:00:00Z",
        mode: "batch",
        winners: Array.from({ length: 11 }, (_, i) => ({
          id: String(i),
          personName: "来宾" + i,
          company: "隐私公司",
          store: "门店",
          giftName: "礼品",
          voided: i === 1,
          phone: "13812345678",
        })),
      },
    ],
  };
  const text = resultLines(view, null).join(" ");
  assert.ok(text.includes("来宾9"));
  assert.ok(text.includes("来宾10"));
  assert.ok(!text.includes("来宾8"));
  assert.ok(!text.includes("隐私公司"));
  assert.ok(!text.includes("13812345678"));
});
