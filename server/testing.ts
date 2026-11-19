import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import {
  AppError,
  createActivity,
  mutate,
  audit,
  advanceStage,
  stageIsActive,
} from "./domain.ts";
import { defaultStageSession } from "../shared/stage.ts";
export async function createTestActivity(db: Db) {
  // This dedicated endpoint is the only way to mark a test activity.
  const a = await createActivity(db, { name: "测试活动 · 幸运现场" });
  await mutate(db, a.id, (v) => {
    v.testMode = true;
    v.subtitle = "测试模式 · 虚构数据，仅用于演练";
    audit(v, "启用独立测试活动");
  });
  return { id: a.id };
}
export async function testData(db: Db, id: string, input: any) {
  const { requestId, action } = input ?? {};
  if (
    typeof requestId !== "string" ||
    requestId.length < 8 ||
    requestId.length > 100
  )
    throw new AppError("请求标识无效");
  if (!["people", "gifts", "all", "reset"].includes(action))
    throw new AppError("测试操作无效");
  const count = input.count ?? 100;
  if (
    ["people", "all"].includes(action) &&
    (!Number.isInteger(count) || count < 1 || count > 1000)
  )
    throw new AppError("测试人数须为1–1000");
  const fingerprint = JSON.stringify({
    action,
    count,
    expectedVersion: input.expectedVersion,
  });
  return mutate(db, id, (a) => {
    if (!a.testMode)
      throw new AppError("只能在独立测试活动中使用测试工具", 403);
    a.testingOps ??= [];
    const prior = a.testingOps.find((o) => o.requestId === requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new AppError("请求标识已用于不同测试操作", 409);
      return prior.response;
    }
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖正在进行，请先完成揭晓");
    let peopleAdded = 0,
      giftsAdded = 0;
    if (action === "reset") {
      if (input.expectedVersion !== a.stageSession.version)
        throw new AppError("舞台版本已变化，请刷新后重置", 409);
      a.rounds = [];
      a.roundPlans.forEach((p) => delete p.completedRoundId);
      a.stageSession = {
        ...defaultStageSession(),
        version: a.stageSession.version + 1,
      };
      delete a.stagePool;
    } else {
      if (action === "people" || action === "all") {
        if (a.people.length + count > 10000)
          throw new AppError("单场最多10000人，请减少人数或新建测试活动");
        const used = new Set(a.people.map((p) => p.phone));
        let n = 1;
        for (let i = 0; i < count; i++) {
          while (used.has("TEST-" + String(n).padStart(6, "0"))) n++;
          const phone = "TEST-" + String(n).padStart(6, "0");
          used.add(phone);
          a.people.push({
            id: randomUUID(),
            name: "测试来宾" + String(n).padStart(4, "0"),
            phone,
            company: "虚构公司" + (((n - 1) % 3) + 1),
            store: "测试门店" + (((n - 1) % 5) + 1),
            enabled: true,
            checkedIn: n % 5 !== 0,
            ...(n % 5 !== 0 ? { checkedInAt: new Date().toISOString() } : {}),
          });
          n++;
          peopleAdded++;
        }
      }
      if (action === "gifts" || action === "all") {
        const names = [
          "旅行箱",
          "咖啡机",
          "保温杯",
          "无线耳机",
          "智能手表",
          "惊喜礼包",
        ];
        names.forEach((name, i) => {
          const title = "测试礼品 · " + name;
          if (!a.gifts.some((g) => g.name === title)) {
            a.gifts.push({
              id: randomUUID(),
              name: title,
              image: "",
              total: [5, 10, 30, 15, 10, 30][i],
              enabled: true,
              singleEnabled: true,
            });
            giftsAdded++;
          }
        });
      }
      a.stageSession.version++;
    }
    const response = { peopleAdded, giftsAdded, reset: action === "reset" };
    a.testingOps.push({ requestId, fingerprint, response });
    audit(a, "测试工具", JSON.stringify({ action, ...response }));
    return response;
  });
}
