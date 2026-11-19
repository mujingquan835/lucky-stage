import { randomInt, randomUUID, createHash } from "node:crypto";
import type { Db, Sql } from "./db.ts";
import {
  defaultStageConfig,
  defaultStageSession,
  type StageConfig,
  type StageSession,
  type RoundPlan,
  type Scope,
  type StageGift,
  type StageSelection,
  type StageAssignment,
} from "../shared/stage.ts";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type Person = {
  photo?: string;
  photoFilename?: string;
  id: string;
  name: string;
  drawChances?: number;
  salesperson?: string;
  department?: string;
  company: string;
  phone: string;
  store: string;
  enabled: boolean;
  checkedIn?: boolean;
  checkedInAt?: string;
};
export type Gift = {
  id: string;
  name: string;
  image: string;
  total: number;
  singleEnabled: boolean;
  batchLimit?: number;
  enabled: boolean;
};
export type Winner = {
  personPhoto?: string;
  assignment?: "assigned" | "random";
  id: string;
  personId: string;
  personName: string;
  department?: string;
  salesperson?: string;
  company: string;
  store: string;
  phone: string;
  giftId: string;
  giftName: string;
  giftImage: string;
  voided: boolean;
  voidReason?: string;
  voidedAt?: string;
  claimed?: boolean;
  claimedAt?: string;
  claimedBy?: string;
  claimHistory?: {
    at: string;
    claimed: boolean;
    reason: string;
    actor: string;
  }[];
};
export type Round = {
  id: string;
  requestId: string;
  mode: "single" | "batch";
  createdAt: string;
  winners: Winner[];
  fingerprint: string;
  scope?: Scope;
  planId?: string;
  planName?: string;
  source?: "self";
  selfRequestId?: string;
  selfRevealAt?: string;
  receipt?: RoundReceipt;
};
export const roundRevealed = (r: Round) => !r.selfRevealAt || Date.parse(r.selfRevealAt) <= Date.now();
export type RoundReceipt = Omit<Round, "fingerprint" | "receipt">;
export type Activity = {
  selfService?: { enabled: boolean; startsAt: string; endsAt: string; codes: Record<string,string> };
  testMode?: boolean;
  testingOps?: { requestId: string; fingerprint: string; response: any }[];
  id: string;
  name: string;
  subtitle: string;
  brandImage: string;
  background: string;
  color: string;
  allowRepeat: boolean;
  showCompany: boolean;
  showStore: boolean;
  archived: boolean;
  createdAt: string;
  people: Person[];
  gifts: Gift[];
  rounds: Round[];
  stageConfig: StageConfig;
  stageSession: StageSession;
  hostDraft?: StageSelection;
  hostGiftOps?: { requestId: string; fingerprint: string; gift: Gift & { remaining: number } }[];
  roundPlans: RoundPlan[];
  stageOps: { requestId: string; fingerprint: string; response: any }[];
  importOps?: { requestId: string; fingerprint: string; response: any }[];
  clearPeopleOps?: { requestId: string; peopleVersion: string; response: {removed:number} }[];
  stagePool?: {
    gifts: StageGift[];
    participants: {
      id: string;
      name: string;
      company: string;
      store: string;
      photo?: string;
    }[];
  };
  logs: {
    id: string;
    action: string;
    detail: string;
    at: string;
    actor: string;
  }[];
};
export type DrawInput = {
  requestId: string;
  mode: "single" | "batch";
  personId?: string;
  giftId?: string;
  count?: number;
  scope?: Scope;
  planId?: string;
  assignments?: StageAssignment[];
};
export const text = (v: unknown, max = 120) => {
  if (typeof v !== "string") throw new AppError("请输入有效文字");
  const t = v.trim();
  if (t.length > max) throw new AppError(`文字不能超过 ${max} 字`);
  return t;
};
const required = (v: unknown, label: string, max = 120) => {
  const t = text(v, max);
  if (!t) throw new AppError(`请填写${label}`);
  return t;
};
const bool = (v: any) => {
  if (typeof v !== "boolean") throw new AppError("开关值无效");
  return v;
};
const image = (v: any) => {
  const t = text(v ?? "", 200);
  if (t && !/^\/api\/images\/[a-f0-9-]+\.(png|jpg|webp)$/.test(t))
    throw new AppError("请上传有效图片");
  return t;
};
const now = () => new Date().toISOString();
export const audit = (a: Activity, action: string, detail = "") =>
  a.logs.push({
    id: randomUUID(),
    action,
    detail,
    at: now(),
    actor: process.env.ADMIN_USER ?? "admin",
  });
export async function readActivity(
  sql: Sql,
  id: string,
  lock = false,
): Promise<Activity> {
  const { rows } = await sql.query(
    "SELECT data FROM activities WHERE id=$1" + (lock ? " FOR UPDATE" : ""),
    [id],
  );
  if (!rows[0]) throw new AppError("活动不存在", 404);
  const a = rows[0].data as Activity;
  a.stageConfig = { ...defaultStageConfig(), ...a.stageConfig };
  a.stageSession = { ...defaultStageSession(), ...a.stageSession };
  a.roundPlans ??= [];
  a.stageOps ??= [];
  return a;
}
export const persist = (sql: Sql, a: Activity) =>
  sql.query("UPDATE activities SET data=$2::jsonb WHERE id=$1", [
    a.id,
    JSON.stringify(a),
  ]);
export async function mutate<T>(
  db: Db,
  id: string,
  fn: (a: Activity) => T | Promise<T>,
  allowArchived = false,
): Promise<T> {
  return db.transaction(async (sql) => {
    const a = await readActivity(sql, id, true);
    if (a.archived && !allowArchived)
      throw new AppError("活动已归档，只能查看");
    const r = await fn(a);
    await persist(sql, a);
    return r;
  });
}
export async function createActivity(db: Db, input: any): Promise<Activity> {
  const a: Activity = {
    id: randomUUID(),
    name: required(input.name, "活动名称", 80),
    subtitle: "让每一份幸运，都有回响",
    brandImage: "",
    background: "",
    color: "#b82935",
    allowRepeat:
      input.allowRepeat === undefined ? false : bool(input.allowRepeat),
    showCompany: true,
    showStore: true,
    archived: false,
    createdAt: now(),
    people: [],
    gifts: [],
    rounds: [],
    stageConfig: defaultStageConfig(),
    stageSession: defaultStageSession(),
    roundPlans: [],
    stageOps: [],
    logs: [],
  };
  audit(a, "创建活动");
  await db.query("INSERT INTO activities(id,data) VALUES($1,$2::jsonb)", [
    a.id,
    JSON.stringify(a),
  ]);
  return a;
}
export async function deleteActivity(db: Db, id: string) {
  await db.transaction(async (sql) => {
    const a = await readActivity(sql, id, true);
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖进行中，请先完成揭晓");
    await sql.query("DELETE FROM participant_sessions WHERE activity_id=$1", [id]);
    await sql.query("DELETE FROM activities WHERE id=$1", [id]);
  });
}
export async function listActivities(db: Db) {
  const { rows } = await db.query(
    "SELECT data FROM activities ORDER BY data->>'createdAt' DESC",
  );
  return rows.map((r) => {
    const a: Activity = r.data;
    return { ...summary(a), createdAt: a.createdAt };
  });
}
const activeWinners = (a: Activity) =>
  a.rounds.flatMap((r) => r.winners).filter((w) => !w.voided);
export const remaining = (a: Activity, g: Gift) =>
  g.total - activeWinners(a).filter((w) => w.giftId === g.id).length;
export const usedChances = (a: Activity, personId: string) => activeWinners(a).filter(w => w.personId === personId).length;
export const chancesLeft = (a: Activity, p: Person) => Math.max(0, (p.drawChances ?? 1) - usedChances(a, p.id));
export const eligible = (a: Activity) => a.people.filter(p => p.enabled && chancesLeft(a, p) > 0);
function validateChances(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 10000) throw new AppError("抽奖机会须为 1–10000 的整数");
  return value as number;
}
function summary(a: Activity) {
  const won = activeWinners(a);
  const used = new Map<string, number>();
  for (const w of won) used.set(w.personId, (used.get(w.personId) ?? 0) + 1);
  const peopleStats = {
    totalPeople: a.people.length,
    drawnPeople: a.people.filter(p => used.has(p.id)).length,
    totalChances: a.people.reduce((sum,p) => sum + (p.drawChances ?? 1), 0),
    remainingChances: a.people.reduce((sum,p) => sum + (p.enabled ? Math.max(0,(p.drawChances ?? 1) - (used.get(p.id) ?? 0)) : 0), 0),
  };
  return {
    id: a.id,
    name: a.name,
    subtitle: a.subtitle,
    color: a.color,
    archived: a.archived,
    testMode: a.testMode ?? false,
    peopleCount: a.people.length,
    peopleStats,
    eligibleCount: eligible(a).length,
    winnerCount: activeWinners(a).length,
    remainingCount: a.gifts
      .filter((g) => g.enabled)
      .reduce((s, g) => s + remaining(a, g), 0),
  };
}
export async function state(db: Db, id: string) {
  const a = await readActivity(db, id);
  const wonIds = new Set(activeWinners(a).map((w) => w.personId));
  return {
    ...a,
    peopleVersion: peopleVersion(a),
    summary: summary(a),
    people: a.people.map((p) => ({
      ...p,
      won: wonIds.has(p.id),
      drawChances: p.drawChances ?? 1,
      remainingChances: chancesLeft(a, p),
    })),
    gifts: a.gifts.map((g) => ({ ...g, remaining: remaining(a, g) })),
    rounds: a.rounds.map(({ fingerprint, receipt, ...r }) => r),
  };
}
function peopleVersion(a: Activity) {
  return createHash("sha256").update(JSON.stringify({people:a.people,codes:a.selfService?.codes ?? {}})).digest("hex");
}
export async function clearPeople(db: Db, id: string, input: {requestId:string; peopleVersion:string}) {
  const requestId = required(input?.requestId, "清空请求标识", 100);
  if (requestId.length < 8 || typeof input?.peopleVersion !== "string" || !/^[a-f0-9]{64}$/.test(input.peopleVersion)) throw new AppError("请求无效，请刷新后重试");
  return mutate(db,id,a => {
    a.clearPeopleOps ??= [];
    const old = a.clearPeopleOps.find(op => op.requestId === requestId);
    if (old) {
      if (old.peopleVersion !== input.peopleVersion) throw new AppError("清空请求标识已被使用",409);
      return old.response;
    }
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖进行中，请先完成揭晓");
    if (peopleVersion(a) !== input.peopleVersion) throw new AppError("名单或抽奖码已变化，请刷新后重新确认",409);
    const ids = new Set(a.people.map(p => p.id));
    if (activeWinners(a).some(w => ids.has(w.personId))) throw new AppError("名单中存在有效中奖记录，不能清空；请保留记录或先按规则处理中奖记录");
    const response = {removed:a.people.length};
    a.people = [];
    if (a.selfService) a.selfService.codes = {};
    for (const plan of a.roundPlans) {
      if (plan.assignedPersonIds) plan.assignedPersonIds = [];
    }
    if (a.hostDraft) delete a.hostDraft;
    a.clearPeopleOps.push({requestId,peopleVersion:input.peopleVersion,response});
    audit(a,"清空参与名单",`${response.removed} 人`);
    return response;
  }).then(async (res) => {
    await db.query("DELETE FROM participant_sessions WHERE activity_id=$1", [id]);
    return res;
  });
}
export function applyActivityDisplay(a: Activity, input: Record<string, unknown>) {
  for (const k of ["showCompany", "showStore"] as const)
    if (input[k] !== undefined) a[k] = bool(input[k]);
  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !/^#[0-9a-f]{6}$/i.test(input.color))
      throw new AppError("颜色值无效");
    a.color = input.color;
  }
  if (input.background !== undefined) a.background = image(input.background);
  if (input.brandImage !== undefined) a.brandImage = image(input.brandImage);
}
export async function updateActivity(db: Db, id: string, input: any) {
  return mutate(db, id, (a) => {
    if (
      input.allowRepeat !== undefined &&
      bool(input.allowRepeat) !== a.allowRepeat
    ) {
      if (a.rounds.length) throw new AppError("首轮抽奖后不能修改重复中奖规则");
      a.allowRepeat = input.allowRepeat;
    }
    if (input.name !== undefined) a.name = required(input.name, "活动名称", 80);
    if (input.subtitle !== undefined) a.subtitle = text(input.subtitle, 120);
    applyActivityDisplay(a, input);
    if (input.archived !== undefined) {
      advanceStage(a);
      if (stageIsActive(a))
        throw new AppError("本轮正在进行，请先停止揭晓再归档");
      if (input.archived !== true)
        throw new AppError("归档活动不能恢复修改，请复制新活动");
      a.archived = true;
    }
    audit(a, "更新活动设置");
    return summary(a);
  });
}
export async function copyActivity(db: Db, id: string, name: string) {
  const original = await readActivity(db, id);
  const a = await createActivity(db, {
    name,
    allowRepeat: original.allowRepeat,
  });
  for (const k of [
    "subtitle",
    "color",
    "brandImage",
    "background",
    "showCompany",
    "showStore",
  ] as const)
    (a as any)[k] = original[k];
  a.testMode = original.testMode ?? false;
  a.gifts = original.gifts.map((g) => ({ ...g, id: randomUUID() }));
  a.stageConfig = structuredClone(original.stageConfig);
  a.roundPlans = original.roundPlans.map(({ assignedPersonIds: _, ...p }) => ({
    ...p,
    id: randomUUID(),
    giftId:
      a.gifts[original.gifts.findIndex((g) => g.id === p.giftId)]?.id ??
      p.giftId,
    completedRoundId: undefined,
  }));
  audit(a, "复制活动配置", id);
  await persist(db, a);
  return summary(a);
}
export function validatePeople(a: Activity, rows: any[]) {
  if (!Array.isArray(rows) || !rows.length)
    throw new AppError("请至少添加一位参与者");
  if (a.people.length + rows.length > 10000)
    throw new AppError("单场活动最多 10000 人");
  const seen = new Set(a.people.map((p) => p.phone));
  return rows.map((r, i) => {
    if (!r || typeof r !== "object")
      throw new AppError(`第 ${i + 1} 行数据无效`);
    const name = required(r.name, `第 ${i + 1} 行姓名`, 80),
      phone = required(r.phone, `第 ${i + 1} 行电话`, 40);
    if (seen.has(phone)) throw new AppError(`第 ${i + 1} 行电话重复：${phone}`);
    seen.add(phone);
    return {
      id: randomUUID(),
      name,
      phone,
      drawChances: validateChances(r.drawChances ?? 1),
      salesperson: text(r.salesperson ?? "", 80),
      department: text(r.department ?? "", 80),
      company: text(r.company ?? "", 120),
      store: text(r.store ?? "", 120),
      enabled: true,
    };
  });
}
export async function addPeople(db: Db, id: string, rows: any[]) {
  return mutate(db, id, (a) => {
    const people = validatePeople(a, rows);
    a.people.push(...people);
    audit(a, "导入参与名单", `${people.length} 人`);
    return people;
  });
}
export function previewPeopleImport(a: Pick<Activity, "people">, rows: any[]) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new AppError("名单须包含 1–10000 行");
  const groups = new Map<string, { name:string; phone:string; store:string; salesperson:string; department:string; company:string; addChances:number; totalChances:number; existingId?:string; photoFilename?:string }>();
  const existingByPhone = new Map(a.people.map(p => [p.phone, p]));
  const warnings = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (!r || typeof r !== "object") throw new AppError(`第 ${i + 1} 行数据无效`);
    const where = typeof r.sheet === "string" && Number.isSafeInteger(r.row) ? `工作表 ${text(r.sheet, 100)} 第 ${r.row} 行` : `第 ${i + 1} 行`;
    const name = required(r.name, `${where}姓名`, 80), phone = required(r.phone, `${where}电话`, 40);
    const store = text(r.store ?? "", 120), salesperson = text(r.salesperson ?? "", 80), department = text(r.department ?? "", 80), company = text(r.company ?? "", 120);
    const prior = groups.get(phone), existing = existingByPhone.get(phone);
    if ((prior && prior.name !== name) || (existing && existing.name !== name)) throw new AppError(`${where}：同一电话对应的姓名不一致，请核对`);
    const person = prior ?? {name, phone, store: existing ? existing.store : store, salesperson: existing ? (existing.salesperson ?? "") : salesperson, company: existing ? existing.company : company, department: existing ? (existing.department ?? "") : department, addChances:0, totalChances:existing ? (existing.drawChances ?? 1) : 0, ...(existing ? {existingId:existing.id} : {})};
    const filename = text(r.photoFilename ?? "", 255);
    if (filename) {
      if (person.photoFilename && person.photoFilename !== filename)
        throw new AppError(`${where}：同一人的照片文件名不一致，请核对`);
      person.photoFilename = filename;
    }
    for (const [label,key,value] of [["门店","store",store],["对应销售","salesperson",salesperson],["部门","department",department],["公司","company",company]] as const) {
      if (value && person[key] && person[key] !== value) warnings.add(`${name}（${phone}）的${label}不一致，保留${existing ? "原名单" : "首条记录"}的资料`);
      if (!existing && !person[key]) person[key] = value;
    }
    person.addChances++;
    person.totalChances++;
    validateChances(person.totalChances);
    groups.set(phone, person);
  }
  const result = [...groups.values()];
  if (a.people.length + result.filter(p => !p.existingId).length > 10000) throw new AppError("单场活动最多 10000 人");
  const plan = { rows: result, sourceRows: rows.length, warnings: [...warnings] };
  return { ...plan, planToken: createHash("sha256").update(JSON.stringify(plan)).digest("hex") };
}
export async function importPeople(db: Db, id: string, rows: any[], requestId: string, planToken?: string) {
  required(requestId, "导入请求标识", 100);
  if (requestId.length < 8) throw new AppError("导入请求标识太短");
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000) throw new AppError("名单须包含 1–10000 行");
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return mutate(db, id, (a) => {
    a.importOps ??= [];
    const old = a.importOps.find(op => op.requestId === requestId);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new AppError("导入请求标识已被其他数据使用", 409);
      return old.response;
    }
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖进行中不可修改机会，请先完成揭晓");
    const plan = previewPeopleImport(a, rows);
    if (planToken !== undefined && planToken !== plan.planToken) throw new AppError("名单或抽奖机会已变化，请重新预览后导入", 409);
    const existingById = new Map(a.people.map(p => [p.id, p]));
    for (const entry of plan.rows) {
      const existing = entry.existingId ? existingById.get(entry.existingId) : undefined;
      if (existing) {
        existing.drawChances = entry.totalChances;
        if (entry.photoFilename) existing.photoFilename = entry.photoFilename;
      } else a.people.push({ id: randomUUID(), name:entry.name, phone:entry.phone, store:entry.store, salesperson:entry.salesperson, department:entry.department, company:entry.company, drawChances:entry.totalChances, enabled:true, ...(entry.photoFilename ? { photoFilename: entry.photoFilename } : {}) });
    }
    const response = { people: plan.rows.length, chances: plan.sourceRows };
    a.importOps.push({requestId, fingerprint, response});
    audit(a, "导入参与名单", `${response.people} 人，增加 ${response.chances} 次机会`);
    return response;
  });
}
export async function savePersonPhotos(db: Db, id: string, rows: unknown) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000)
    throw new AppError("照片匹配须包含 1–10000 人");
  return mutate(db, id, (a) => {
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("请先揭晓再更新照片");
    const people = new Map(a.people.map(p => [p.id, p]));
    const seen = new Set<string>();
    for (const row of rows) {
      const pid = required(row?.personId, "参与者", 100);
      const p = people.get(pid);
      if (!p || seen.has(pid)) throw new AppError("名单已变化或存在重复人员，请重新匹配");
      const photo = text(row.photo, 180);
      if (photo && !/^\/api\/images\/[a-f0-9-]{36}\.webp$/.test(photo))
        throw new AppError("人物照片无效");
      if (photo) p.photo = photo;
      else delete p.photo;
      seen.add(pid);
    }
    audit(a, "更新人物照片", `${seen.size} 人`);
    return { count: seen.size };
  });
}
export async function updatePerson(
  db: Db,
  id: string,
  personId: string,
  input: any,
) {
  return mutate(db, id, (a) => {
    const p = a.people.find((p) => p.id === personId);
    if (!p) throw new AppError("参与者不存在", 404);
    for (const k of ["name", "phone", "company", "store", "salesperson", "department"] as const)
      if (input[k] !== undefined)
        p[k] =
          k === "name" || k === "phone"
            ? required(
                input[k],
                k === "name" ? "姓名" : "电话",
                k === "name" ? 80 : 40,
              )
            : text(input[k]);
    if (a.people.some((v) => v.id !== p.id && v.phone === p.phone))
      throw new AppError("电话重复");
    if (input.drawChances !== undefined) {
      advanceStage(a);
      if (stageIsActive(a)) throw new AppError("抽奖进行中不可修改机会");
      const total = validateChances(input.drawChances);
      if (total < usedChances(a, p.id)) throw new AppError("总机会不能少于已抽次数");
      audit(a, "修改抽奖机会", `${p.id}: ${p.drawChances ?? 1} → ${total}`);
      p.drawChances = total;
    }
    if (input.enabled !== undefined) {
      advanceStage(a);
      if (stageIsActive(a)) throw new AppError("抽奖进行中不可修改参与状态");
      p.enabled = bool(input.enabled);
    }
    if (input.checkedIn !== undefined) {
      p.checkedIn = bool(input.checkedIn);
      p.checkedInAt = p.checkedIn ? now() : undefined;
    }
    audit(a, "修改参与者", p.id);
    return p;
  });
}
export async function deletePerson(db: Db, id: string, pid: string) {
  await mutate(db, id, (a) => {
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖进行中不可删除参与者");
    if (activeWinners(a).some((w) => w.personId === pid))
      throw new AppError("此人已有有效中奖记录，请改为停用");
    if (!a.people.some((p) => p.id === pid))
      throw new AppError("参与者不存在", 404);
    a.people = a.people.filter((p) => p.id !== pid);
    if (a.selfService?.codes) delete a.selfService.codes[pid];
    for (const plan of a.roundPlans) {
      if (plan.assignedPersonIds?.length)
        plan.assignedPersonIds = plan.assignedPersonIds.filter((v) => v !== pid);
    }
    if (a.hostDraft?.assignments?.length) {
      a.hostDraft.assignments = a.hostDraft.assignments.filter((v) => v.personId !== pid);
    }
    if (a.hostDraft?.personId === pid) a.hostDraft.personId = undefined;
    audit(a, "删除参与者", pid);
  });
  await db.query(
    "DELETE FROM participant_sessions WHERE activity_id=$1 AND person_id=$2",
    [id, pid],
  );
}
export async function saveGift(db: Db, id: string, input: any) {
  return mutate(db, id, (a) => {
    const requestId = input.requestId === undefined ? "" : required(input.requestId, "礼品请求标识", 100);
    const fingerprint = requestId ? createHash("sha256").update(JSON.stringify(input)).digest("hex") : "";
    if (requestId) {
      if (requestId.length < 8 || input.id) throw new AppError("新增礼品请求无效");
      const old = a.hostGiftOps?.find(op => op.requestId === requestId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new AppError("请求标识已被其他礼品使用", 409);
        return old.gift;
      }
      advanceStage(a);
      if (stageIsActive(a)) throw new AppError("请先揭晓再添加礼品");
    } else {
      advanceStage(a);
      if (stageIsActive(a)) throw new AppError("抽奖进行中不可修改或新增礼品");
    }
    let g = input.id ? a.gifts.find((g) => g.id === input.id) : undefined;
    if (input.id && !g) throw new AppError("礼品不存在", 404);
    const total = input.total;
    if (!Number.isSafeInteger(total) || total < 1 || total > 100000)
      throw new AppError("礼品数量须为 1–100000 的整数");
    const name = required(input.name, "礼品名称", 80);
    if (input.batchLimit != null && (!Number.isSafeInteger(input.batchLimit) || input.batchLimit < 1 || input.batchLimit > 50))
      throw new AppError("单批上限须为 1–50 的整数，或留空不限");
    if (g && total < g.total - remaining(a, g))
      throw new AppError("数量不能低于已发放份数");
    if (!g) {
      g = {
        id: randomUUID(),
        name,
        image: "",
        total,
        singleEnabled: true,
        enabled: true,
      };
      a.gifts.push(g);
    }
    g.name = name;
    g.total = total;
    if (input.batchLimit !== undefined) {
      if (input.batchLimit === null) delete g.batchLimit;
      else g.batchLimit = input.batchLimit;
    }
    if (input.image !== undefined) g.image = image(input.image);
    if (input.singleEnabled !== undefined)
      g.singleEnabled = bool(input.singleEnabled);
    if (input.enabled !== undefined) g.enabled = bool(input.enabled);
    if (input.position !== undefined) {
      const pos = input.position;
      if (!Number.isInteger(pos) || pos < 0 || pos >= a.gifts.length)
        throw new AppError("排序位置无效");
      a.gifts = a.gifts.filter((v) => v.id !== g!.id);
      a.gifts.splice(pos, 0, g);
    }
    audit(a, "保存礼品", g.id);
    const result = { ...g, remaining: remaining(a, g) };
    if (requestId) {
      a.hostGiftOps ??= [];
      a.hostGiftOps.push({ requestId, fingerprint, gift: structuredClone(result) });
    }
    return result;
  });
}
export async function deleteGift(db: Db, id: string, gid: string) {
  return mutate(db, id, (a) => {
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖进行中不可删除礼品");
    if (a.rounds.some((r) => r.winners.some((w) => w.giftId === gid)))
      throw new AppError("此礼品已有抽奖记录，请改为停用");
    if (!a.gifts.some((g) => g.id === gid))
      throw new AppError("礼品不存在", 404);
    if (a.roundPlans.some((p) => p.giftId === gid))
      throw new AppError("此礼品已被抽奖轮次使用，请先修改或删除对应轮次");
    a.gifts = a.gifts.filter((g) => g.id !== gid);
    if (a.hostDraft?.giftId === gid) a.hostDraft.giftId = undefined;
    audit(a, "删除礼品", gid);
  });
}
function fingerprint(input: DrawInput) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        input.mode === "single"
          ? {
              mode: input.mode,
              personId: input.personId,
              scope: input.scope,
              planId: input.planId,
            }
          : {
              mode: input.mode,
              giftId: input.giftId,
              count: input.count,
              scope: input.scope,
              planId: input.planId,
              assignments: input.assignments,
            },
      ),
    )
    .digest("hex");
}
export function normalizeScope(input: any): Scope {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError("参与范围无效");
  const scope: Scope = {};
  if (input.salesperson !== undefined) scope.salesperson = text(input.salesperson, 80);
  if (input.company !== undefined) scope.company = text(input.company);
  if (input.store !== undefined) scope.store = text(input.store);
  if (input.checkedInOnly !== undefined)
    scope.checkedInOnly = bool(input.checkedInOnly);
  return scope;
}
export function matchesScope(p: Person, scope: Scope) {
  return (
    (!scope.salesperson || p.salesperson === scope.salesperson) &&
    (!scope.company || p.company === scope.company) &&
    (!scope.store || p.store === scope.store) &&
    (!scope.checkedInOnly || p.checkedIn === true)
  );
}
export function stageIsActive(a: Activity) {
  return ["rolling", "decelerating"].includes(a.stageSession.phase);
}
export function advanceStage(a: Activity, time = Date.now()) {
  const session = a.stageSession;
  if (
    (session.phase === "rolling" &&
      session.deadline &&
      Date.parse(session.deadline) <= time) ||
    (session.phase === "decelerating" &&
      session.revealAt &&
      Date.parse(session.revealAt) <= time)
  ) {
    session.phase = "revealed";
    session.version++;
    return true;
  }
  return false;
}
export function drawInActivity(a: Activity, input: DrawInput, allowDuringStage = false, allowAssignments = false): RoundReceipt {
  required(input.requestId, "请求标识", 100);
  if (input.requestId.length < 8) throw new AppError("请求标识太短");
  if (!["single", "batch"].includes(input.mode))
    throw new AppError("抽奖模式无效");
  if (input.assignments !== undefined && (!allowAssignments || input.mode !== "batch" || !Array.isArray(input.assignments)))
    throw new AppError("指定名额只能由主持台批量抽奖设置");
  if (a.stageOps.some((o) => o.requestId === input.requestId))
    throw new AppError("请求标识已被舞台操作使用", 409);
  const fp = fingerprint(input);
  const old = a.rounds.find((r) => r.requestId === input.requestId);
  if (old) {
    if (old.fingerprint !== fp)
      throw new AppError("请求标识已被其他参数使用", 409);
    return old.receipt!;
  }
  advanceStage(a);
  if (!allowDuringStage && stageIsActive(a)) throw new AppError("本轮正在进行，请先停止揭晓");
  if (a.archived) throw new AppError("活动已归档，只能查看");
  let pairs: { p: Person; g: Gift; assignment?: Winner["assignment"] }[] = [];
  const scope = normalizeScope(input.scope);
  const people = eligible(a).filter((p) => matchesScope(p, scope));
  const plan = input.planId
    ? a.roundPlans.find((p) => p.id === input.planId)
    : undefined;
  if (input.planId && (!plan || plan.completedRoundId))
    throw new AppError("轮次不存在或已经完成");
  if (
    plan &&
    (input.mode !== "batch" ||
      input.giftId !== plan.giftId ||
      input.count !== plan.count)
  )
    throw new AppError("抽奖参数与轮次安排不一致");
  if (input.mode === "single") {
    const p = a.people.find((p) => p.id === input.personId);
    if (!p || !p.enabled) throw new AppError("请选择启用的参与者");
    if (!people.some((v) => v.id === p.id))
      throw new AppError("该参与者已中奖，抽奖机会已用完");
    const gifts = a.gifts.filter(
      (g) => g.enabled && g.singleEnabled && remaining(a, g) > 0,
    );
    const sum = gifts.reduce((s, g) => s + remaining(a, g), 0);
    if (!sum) throw new AppError("可抽礼品库存不足");
    let n = randomInt(sum);
    const g = gifts.find((g) => {
      n -= remaining(a, g);
      return n < 0;
    })!;
    pairs = [{ p, g }];
  } else {
    const count = input.count;
    if (!Number.isSafeInteger(count) || count! < 1 || count! > 50)
      throw new AppError("每轮人数须为 1–50 的整数");
    const assignments = plan?.assignedPersonIds?.map(personId => ({ personId, giftId: plan.giftId })) ?? input.assignments ?? [];
    if (assignments.length && !allowAssignments)
      throw new AppError("含指定名额的轮次须由主持台开奖");
    if (assignments.length > count!) throw new AppError("指定名额不能超过本轮人数");
    const reservedPeople = new Set<string>();
    const reservedGiftCounts = new Map<string, number>();
    for (const entry of assignments) {
      const p = people.find((person) => person.id === entry.personId);
      if (!p || reservedPeople.has(p.id))
        throw new AppError("指定人员重复、已无抽奖机会或不在当前范围");
      const g = a.gifts.find((gift) => gift.id === (input.giftId ?? entry.giftId) && gift.enabled && (input.giftId || gift.singleEnabled));
      if (!g) throw new AppError("请选择本轮可抽取的指定礼品");
      const quantity = (reservedGiftCounts.get(g.id) ?? 0) + 1;
      if (quantity > Math.min(remaining(a, g), g.batchLimit ?? count!))
        throw new AppError("指定礼品库存不足或超过单批上限");
      reservedGiftCounts.set(g.id, quantity);
      reservedPeople.add(p.id);
      pairs.push({ p, g, assignment: "assigned" });
    }
    const randomCount = count! - assignments.length;
    const participants = people.filter((p) => !reservedPeople.has(p.id));
    if (!input.giftId) {
      const pool = a.gifts.filter(g => g.enabled && g.singleEnabled).map(g => {
        const stock = remaining(a, g);
        const reserved = reservedGiftCounts.get(g.id) ?? 0;
        return { gift: g, stock: stock - reserved, capacity: Math.min(stock, g.batchLimit ?? count!) - reserved };
      }).filter(item => item.capacity > 0);
      const capacity = pool.reduce((sum, item) => sum + item.capacity, 0);
      if (capacity < randomCount || participants.length < randomCount)
        throw new AppError(`库存或合格人数不足（剩余可用 ${capacity} 份，可抽 ${participants.length} 人）`);
      for (let i = 0; i < randomCount; i++) {
        const personIndex = randomInt(participants.length);
        const [p] = participants.splice(personIndex, 1);
        const total = pool.reduce((sum, item) => sum + (item.capacity > 0 ? item.stock : 0), 0);
        let n = randomInt(total);
        const chosen = pool.find(item => {
          if (item.capacity <= 0) return false;
          n -= item.stock;
          return n < 0;
        })!;
        pairs.push({p, g: chosen.gift, assignment: assignments.length ? "random" : undefined});
        chosen.stock--;
        chosen.capacity--;
      }
    } else {
    const g = a.gifts.find((g) => g.id === input.giftId && g.enabled);
    if (!g) throw new AppError("请选择启用的礼品");
    if (g.batchLimit !== undefined && count! > g.batchLimit)
      throw new AppError(`该礼品单批最多抽取 ${g.batchLimit} 人`);
    if (remaining(a, g) < count! || people.length < count!)
      throw new AppError(
        `库存或合格人数不足（库存 ${remaining(a, g)}，可抽 ${people.length} 人）`,
      );
    for (let i = 0; i < randomCount; i++) {
      const [p] = participants.splice(randomInt(participants.length), 1);
      pairs.push({ p, g, assignment: assignments.length ? "random" : undefined });
    }
    }
    if (assignments.length) {
      for (let i = pairs.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
      }
    }
  }
  const r: Round = {
    id: randomUUID(),
    requestId: input.requestId,
    mode: input.mode,
    createdAt: now(),
    fingerprint: fp,
    scope,
    ...(plan ? { planId: plan.id, planName: plan.name } : {}),
    winners: pairs.map(({ p, g, assignment }) => ({
      ...(assignment ? { assignment } : {}),
      ...(p.photo ? { personPhoto: p.photo } : {}),
      id: randomUUID(),
      personId: p.id,
      personName: p.name,
      department: p.department ?? "",
      salesperson: p.salesperson ?? "",
      company: p.company,
      store: p.store,
      phone: p.phone,
      giftId: g.id,
      giftName: g.name,
      giftImage: g.image,
      voided: false,
    })),
  };
  const { fingerprint: _, ...receipt } = r;
  r.receipt = structuredClone(receipt);
  a.rounds.unshift(r);
  if (plan) plan.completedRoundId = r.id;
  const assigned = r.winners.filter(w => w.assignment === "assigned").length;
  audit(a, "完成抽奖", `${r.mode} / ${r.winners.length} 人 / ${r.id}${assigned ? ` / 指定 ${assigned} 人` : ""}`);
  return receipt;
}
export async function draw(
  db: Db,
  id: string,
  input: DrawInput,
): Promise<RoundReceipt> {
  return db.transaction(async (sql) => {
    const a = await readActivity(sql, id, true);
    const result = drawInActivity(a, input);
    await persist(sql, a);
    return result;
  });
}
export async function findRound(db: Db, id: string, requestId: string) {
  const a = await readActivity(db, id);
  const r = a.rounds.find((r) => r.requestId === requestId);
  if (!r) throw new AppError("结果尚未生成", 404);
  return r.receipt;
}
export async function voidWinner(
  db: Db,
  id: string,
  wid: string,
  reason: string,
) {
  return mutate(db, id, (a) => {
    advanceStage(a);
    const targetRound = a.rounds.find((r) =>
      r.winners.some((w) => w.id === wid),
    );
    if (targetRound?.id === a.stageSession.roundId && stageIsActive(a))
      throw new AppError("本轮尚未揭晓，不能作废");
    const w = targetRound?.winners.find((w) => w.id === wid);
    if (!w) throw new AppError("中奖记录不存在", 404);
    if (w.voided) throw new AppError("该记录已作废");
    if (w.claimed)
      throw new AppError("此礼品已领取，请先撤销核销再作废中奖记录");
    w.voided = true;
    w.voidReason = required(reason, "作废原因", 300);
    w.voidedAt = now();
    audit(a, "作废中奖记录", `${wid} / ${w.voidReason}`);
    return w;
  });
}
export async function stageState(db: Db, id: string) {
  const a = await readActivity(db, id);
  const rounds = a.rounds
    .filter(roundRevealed)
    .filter(
      (r) =>
        !(
          a.stageSession.phase === "rolling" && r.id === a.stageSession.roundId
        ),
    )
    .map((r) => ({
      id: r.id,
      mode: r.mode,
      createdAt: r.createdAt,
      winners: r.winners.map(({ phone, personId, department, salesperson, assignment, ...w }) => ({
        ...w,
        company: a.showCompany ? w.company : "",
        store: a.showStore ? w.store : "",
      })),
    }));
  return {
    id: a.id,
    name: a.name,
    subtitle: a.subtitle,
    color: a.color,
    brandImage: a.brandImage,
    background: a.background,
    showCompany: a.showCompany,
    showStore: a.showStore,
    archived: a.archived,
    testMode: a.testMode ?? false,
    rounds,
    gifts: a.gifts
      .filter((g) => g.enabled)
      .map((g) => ({ ...g, remaining: remaining(a, g) })),
  };
}

export async function increaseGift(
  db: Db,
  id: string,
  gid: string,
  amount: unknown,
) {
  return mutate(db, id, (a) => {
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("抽奖进行中，请先完成揭晓");
    const g = a.gifts.find((g) => g.id === gid);
    if (!g) throw new AppError("礼品不存在", 404);
    if (
      !Number.isSafeInteger(amount) ||
      Number(amount) < 1 ||
      g.total + Number(amount) > 100000
    )
      throw new AppError("增加数量无效");
    g.total += Number(amount);
    audit(a, "增加礼品数量", `${g.name} +${amount}`);
    return { total: g.total, remaining: remaining(a, g) };
  });
}
