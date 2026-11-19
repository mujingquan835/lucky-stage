import { createHash, randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import {
  checkinOpenState,
  getCheckinSummary,
  syncCheckinToActivity,
} from "./checkin-service.ts";
import {
  AppError,
  roundRevealed,
  readActivity,
  persist,
  mutate,
  audit,
  eligible,
  remaining,
  normalizeScope,
  matchesScope,
  stageIsActive,
  advanceStage,
  applyActivityDisplay,
  drawInActivity,
  text,
  type Activity,
  type DrawInput,
  type Round,
} from "./domain.ts";
import {
  type StageCommand,
  type StageView,
  type StageSelection,
  type StageRound,
  type StageConfig,
  type RoundPlan,
} from "../shared/stage.ts";
const requestId = (v: any) => {
  const id = text(v, 100);
  if (id.length < 8) throw new AppError("请求标识至少8个字符");
  return id;
};
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
const fp = (v: any) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
function selection(a: Activity, input: any): StageSelection {
  if (!input || !["single", "batch"].includes(input.mode))
    throw new AppError("请选择抽奖方式");
  const v: StageSelection = {
    mode: input.mode,
    scope: normalizeScope(input.scope),
  };
  if (input.planId) {
    const plan = a.roundPlans.find((p) => p.id === input.planId);
    if (!plan || plan.completedRoundId)
      throw new AppError("轮次不存在或已经完成");
    if (
      (input.count !== undefined && input.count !== plan.count) ||
      (input.giftId !== undefined && input.giftId !== plan.giftId)
    )
      throw new AppError("轮次安排已变化，请重新使用轮次并确认人数与礼品", 409);
    v.mode = "batch";
    v.planId = plan.id;
    v.giftId = plan.giftId;
    v.count = plan.count;
  } else if (v.mode === "single") {
    v.personId = text(input.personId, 100);
    if (!a.people.some((p) => p.id === v.personId && p.enabled))
      throw new AppError("请选择启用的参与者");
  } else {
    if (input.giftId) v.giftId = text(input.giftId, 100);
    v.count = input.count;
    if (!Number.isInteger(v.count) || v.count! < 1 || v.count! > 50)
      throw new AppError("每轮人数须为1–50的整数");
  }
  if (
    v.mode === "batch" && v.giftId &&
    !a.gifts.some((g) => g.id === v.giftId && g.enabled)
  )
    throw new AppError("请选择启用礼品");
  if (input.assignments !== undefined) {
    if (v.mode !== "batch" || !Array.isArray(input.assignments) || input.assignments.length > v.count!)
      throw new AppError("指定名额不能超过本轮人数");
    if (input.assignments.length)
      v.assignments = input.assignments.map((entry: any) => {
        if (!entry || typeof entry !== "object") throw new AppError("指定名额格式无效");
        const personId = text(entry.personId, 100);
        if (!personId) throw new AppError("请选择指定人员");
        const giftId = v.giftId ? undefined : text(entry.giftId, 100);
        if (!v.giftId && !giftId) throw new AppError("请选择指定礼品");
        return { personId, ...(giftId ? { giftId } : {}) };
      });
  }
  return v;
}
function config(a: Activity, value: any) {
  if (!value || typeof value !== "object") throw new AppError("配置格式无效");
  const c = a.stageConfig;
  for (const k of ["countdown", "celebrate"] as const)
    if (value[k] !== undefined) {
      if (typeof value[k] !== "boolean") throw new AppError("开关值无效");
      c[k] = value[k];
    }
  if (value.animation !== undefined) {
    if (!["reels", "names", "photos"].includes(value.animation))
      throw new AppError("动画类型无效");
    c.animation = value.animation;
  }
  if (value.volume !== undefined) {
    if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1)
      throw new AppError("音量应为0–1");
    c.volume = value.volume;
  }
  for (const k of ["welcomeText", "endText"] as const)
    if (value[k] !== undefined) c[k] = text(value[k], 120);
  if (value.music !== undefined) {
    const music = text(value.music, 180);
    if (music && !/^\/api\/audio\/[a-f0-9-]{36}\.(mp3|wav|ogg)$/.test(music))
      throw new AppError("请上传有效音乐文件");
    c.music = music;
  }
  return c;
}
function operate(a: Activity, input: StageCommand) {
  const s = a.stageSession;
  const active = stageIsActive(a);
  switch (input.action) {
    case "save-draft":
      if (active) throw new AppError("本轮正在进行");
      a.hostDraft = input.selection ? selection(a, input.selection) : undefined;
      break;
    case "prepare":
      if (active) throw new AppError("本轮正在进行");
      s.selection = displaySelection(selection(a, input.selection));
      s.scene = "draw";
      s.phase = "idle";
      s.roundId = null;
      s.page = 0;
      break;
    case "start": {
      if (active) throw new AppError("本轮正在进行，请先停止揭晓");
      const v = selection(a, input.selection ?? a.hostDraft ?? s.selection);
      const people = eligible(a).filter((p) => matchesScope(p, v.scope ?? {}));
      const gifts = a.gifts
        .filter((g) => g.enabled)
        .map((g) => ({ ...g, remaining: remaining(a, g) }));
      const r = drawInActivity(a, {
        ...v,
        requestId: input.requestId,
      } as DrawInput, false, true);
      if (a.hostDraft && fp(a.hostDraft) === fp(v)) delete a.hostDraft;
      a.stagePool = {
        gifts,
        participants: people.slice(0, 120).map((p) => ({
          id: p.id,
          name: p.name,
          company: p.company,
          store: p.store,
          ...(p.photo ? { photo: p.photo } : {}),
        })),
      };
      Object.assign(s, {
        scene: "draw",
        phase: "rolling",
        selection: displaySelection(v),
        roundId: r.id,
        startedAt: new Date().toISOString(),
        deadline: new Date(Date.now() + 30000).toISOString(),
        revealAt: null,
        page: 0,
      });
      break;
    }
    case "stop":
      if (s.phase !== "rolling") throw new AppError("当前没有正在滚动的轮次");
      s.phase = "revealed";
      s.revealAt = new Date().toISOString();
      break;
    case "skip":
      if (!active) throw new AppError("当前没有待揭晓轮次");
      s.phase = "revealed";
      s.revealAt = new Date().toISOString();
      break;
    case "replay": {
      if (active) throw new AppError("本轮正在进行");
      const r = a.rounds.find((r) => r.id === (input.roundId ?? s.roundId));
      if (!r || !r.winners.some((w) => !w.voided))
        throw new AppError("请选择有效中奖轮次");
      s.roundId = r.id;
      s.scene = "draw";
      s.phase = "decelerating";
      s.revealAt = new Date(Date.now() + 4600).toISOString();
      s.replay++;
      s.page = 0;
      break;
    }
    case "next":
      if (active) throw new AppError("请先完成本轮揭晓");
      Object.assign(s, {
        scene: "draw",
        phase: "idle",
        roundId: null,
        selection: null,
        startedAt: null,
        deadline: null,
        revealAt: null,
        page: 0,
      });
      break;
    case "scene":
      if (active) throw new AppError("本轮正在进行，请先停止揭晓");
      if (
        !["welcome", "gifts", "draw", "winners", "end"].includes(
          input.scene ?? "",
        )
      )
        throw new AppError("场景无效");
      s.scene = input.scene!;
      if (input.roundId) {
        if (!a.rounds.some((r) => r.id === input.roundId))
          throw new AppError("轮次不存在");
        s.roundId = input.roundId;
        s.phase = "revealed";
      }
      s.page = 0;
      break;
    case "page": {
      if (!Number.isInteger(input.page) || input.page! < 0)
        throw new AppError("页码无效");
      const count =
        s.scene === "winners"
          ? a.rounds.flatMap((r) => r.winners).filter((w) => !w.voided).length
          : (a.rounds
              .find((r) => r.id === s.roundId)
              ?.winners.filter((w) => !w.voided).length ?? 0);
      if (input.page! >= Math.max(1, Math.ceil(count / 8)))
        throw new AppError("页码超出范围");
      s.page = input.page!;
      break;
    }
    case "config":
      if (active) throw new AppError("本轮正在进行，请完成揭晓后修改配置");
      config(a, input.config);
      if (input.display !== undefined) {
        if (!input.display || typeof input.display !== "object" || Array.isArray(input.display))
          throw new AppError("展示设置格式无效");
        applyActivityDisplay(a, input.display);
      }
      break;
    default:
      throw new AppError("舞台命令无效");
  }
  s.version++;
  audit(a, "舞台操作", input.action);
  return { session: structuredClone(s), roundId: s.roundId };
}
export async function stageCommand(db: Db, id: string, input: StageCommand) {
  requestId(input.requestId);
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
    throw new AppError("舞台版本无效");
  const result = await db.transaction(async (sql) => {
    const a = await readActivity(sql, id, true);
    const hash = fp(input);
    const prior = a.stageOps.find((o) => o.requestId === input.requestId);
    const advanced = advanceStage(a);
    if (prior) {
      if (prior.fingerprint !== hash)
        throw new AppError("请求标识已被不同命令使用", 409);
      if (advanced) await persist(sql, a);
      return { conflict: false as const, response: prior.response };
    }
    if (a.rounds.some((r) => r.requestId === input.requestId))
      throw new AppError("请求标识已被抽奖使用", 409);
    if (a.archived) throw new AppError("活动已归档，只能查看");
    if (a.stageSession.version !== input.expectedVersion) {
      if (advanced) await persist(sql, a);
      return { conflict: true as const };
    }
    if (input.action === "prepare" || input.action === "start") {
      await syncCheckinToActivity(sql, a);
    }
    const response = operate(a, input);
    a.stageOps.push({
      requestId: input.requestId,
      fingerprint: hash,
      response: structuredClone(response),
    });
    await persist(sql, a);
    return { conflict: false as const, response };
  });
  if (result.conflict) throw new AppError("舞台版本已变化，请刷新后操作", 409);
  return result.response;
}
function safeRound(a: Activity, r: Round): StageRound {
  return {
    id: r.id,
    mode: r.mode,
    createdAt: r.createdAt,
    winners: r.winners.map((w) => ({
      id: w.id,
      personName: w.personName,
      ...(w.personPhoto ? { personPhoto: w.personPhoto } : {}),
      company: a.showCompany ? w.company : "",
      store: a.showStore ? w.store : "",
      giftName: w.giftName,
      giftImage: w.giftImage,
      giftId: w.giftId,
      voided: w.voided,
      claimed: w.claimed ?? false,
    })),
  };
}
function displaySelection(v: StageSelection): StageSelection {
  const { assignments: _, ...display } = v;
  return display;
}
export async function getStage(db: Db, id: string, host = false): Promise<StageView> {
  let a = await readActivity(db, id, false);
  const probe = structuredClone(a);
  if (advanceStage(probe)) {
    a = await db.transaction(async (sql) => {
      const locked = await readActivity(sql, id, true);
      if (advanceStage(locked)) await persist(sql, locked);
      return locked;
    });
  }
  const s = a.stageSession;
  const hidden = s.phase === "rolling" ? s.roundId : null;
  const rounds = a.rounds
    .filter((r) => r.id !== hidden && roundRevealed(r))
    .map((r) => safeRound(a, r));
  const source =
    stageIsActive(a) && a.stagePool
      ? a.stagePool.gifts
      : a.gifts
          .filter((g) => g.enabled)
          .map((g) => ({ ...g, remaining: remaining(a, g) }));
  const people =
    stageIsActive(a) && a.stagePool
      ? a.stagePool.participants
      : eligible(a)
          .filter((p) => matchesScope(p, s.selection?.scope ?? {}))
          .slice(0, 120)
          .map((p) => ({
            id: p.id,
            name: p.name,
            company: p.company,
            store: p.store,
            ...(p.photo ? { photo: p.photo } : {}),
          }));
  const v = s.selection;
  const preview = v
    ? {
        mode: v.mode,
        personName:
          v.mode === "single"
            ? a.people.find((p) => p.id === v.personId)?.name
            : undefined,
        giftName:
          v.mode === "batch"
            ? a.gifts.find((g) => g.id === v.giftId)?.name
            : undefined,
        count: v.mode === "single" ? 1 : (v.count ?? 1),
      }
    : null;
  return {
    ...(host ? { hostDraft: a.hostDraft ?? null } : {}),
    id: a.id,
    testMode: a.testMode ?? false,
    name: a.name,
    subtitle: a.subtitle,
    color: a.color,
    background: a.background,
    brandImage: a.brandImage,
    archived: a.archived,
    showCompany: a.showCompany,
    showStore: a.showStore,
    serverNow: new Date().toISOString(),
    session: { ...s, selection: s.selection ? displaySelection(s.selection) : null },
    config: a.stageConfig,
    gifts: source,
    rounds,
    currentRound: rounds.find((r) => r.id === s.roundId) ?? null,
    preview,
    participants: people.map((p) => ({
      ...p,
      company: a.showCompany ? p.company : "",
      store: a.showStore ? p.store : "",
    })),
    plans: host ? a.roundPlans : a.roundPlans.map(({ assignedPersonIds: _, ...plan }) => plan),
    ...(a.checkin?.enabled
      ? await (async () => {
          const summary = await getCheckinSummary(db, id);
          const { open } = checkinOpenState(a.checkin, a.archived);
          return {
            checkin: {
              enabled: true,
              open,
              count: summary.totalCount,
              recent: summary.recent,
            },
          };
        })()
      : {}),
  };
}
export async function saveRoundPlan(db: Db, id: string, input: any) {
  return mutate(db, id, (a) => {
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("本轮正在进行");
    const name = text(input.name, 80);
    if (!name) throw new AppError("请填写轮次名称");
    if (!a.gifts.some((g) => g.id === input.giftId && g.enabled))
      throw new AppError("请选择启用礼品");
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 50)
      throw new AppError("每轮人数须为1–50");
    let p = input.id ? a.roundPlans.find((p) => p.id === input.id) : undefined;
    if (input.id && !p) throw new AppError("轮次不存在", 404);
    if (p?.completedRoundId)
      throw new AppError("已完成轮次不可修改，请新增特别奖轮次");
    const assigned = input.assignedPersonIds ?? p?.assignedPersonIds ?? [];
    if (!Array.isArray(assigned) || assigned.length > input.count ||
        assigned.some(personId => typeof personId !== "string" || !a.people.some(person => person.id === personId && person.enabled)) ||
        new Set(assigned).size !== assigned.length)
      throw new AppError("请选择名单中启用且不重复的人员，指定名额不能超过轮次人数");
    if (!p) {
      p = {
        id: randomUUID(),
        name,
        giftId: input.giftId,
        count: input.count,
        order: a.roundPlans.length,
      };
      a.roundPlans.push(p);
    }
    p.name = name;
    p.giftId = input.giftId;
    p.count = input.count;
    if (input.assignedPersonIds !== undefined) p.assignedPersonIds = [...assigned];
    if (input.order !== undefined) {
      if (
        !Number.isInteger(input.order) ||
        input.order < 0 ||
        input.order >= a.roundPlans.length
      )
        throw new AppError("排序位置无效");
      a.roundPlans = a.roundPlans.filter((v) => v.id !== p!.id);
      a.roundPlans.splice(input.order, 0, p);
    }
    a.roundPlans.forEach((v, i) => (v.order = i));
    a.stageSession.version++;
    audit(a, "保存轮次", p.id);
    return p;
  });
}
export async function deleteRoundPlan(db: Db, id: string, pid: string) {
  return mutate(db, id, (a) => {
    advanceStage(a);
    if (stageIsActive(a)) throw new AppError("本轮正在进行");
    const p = a.roundPlans.find((p) => p.id === pid);
    if (!p) throw new AppError("轮次不存在", 404);
    if (p.completedRoundId) throw new AppError("已完成轮次不可删除");
    a.roundPlans = a.roundPlans.filter((p) => p.id !== pid);
    a.roundPlans.forEach((p, i) => (p.order = i));
    a.stageSession.version++;
    audit(a, "删除轮次", pid);
  });
}
export async function claimWinner(db: Db, id: string, wid: string, input: any) {
  requestId(input.requestId);
  return db.transaction(async (sql) => {
    const a = await readActivity(sql, id, true);
    const hash = fp({ kind: "claim", wid, ...input });
    const prior = a.stageOps.find((o) => o.requestId === input.requestId);
    if (prior) {
      if (prior.fingerprint !== hash)
        throw new AppError("请求标识已被其他操作使用", 409);
      return prior.response;
    }
    if (a.rounds.some((r) => r.requestId === input.requestId))
      throw new AppError("请求标识已被抽奖使用", 409);
    if (a.archived) throw new AppError("活动已归档");
    advanceStage(a);
    if (input.expectedVersion !== a.stageSession.version)
      throw new AppError("舞台版本已变化，请刷新后操作", 409);
    const round = a.rounds.find((r) => r.winners.some((w) => w.id === wid));
    const w = round?.winners.find((w) => w.id === wid);
    if (!w || w.voided) throw new AppError("有效中奖记录不存在", 404);
    if (round?.id === a.stageSession.roundId && stageIsActive(a))
      throw new AppError("本轮尚未揭晓，不能核销");
    if (typeof input.claimed !== "boolean") throw new AppError("核销状态无效");
    const reason = input.claimed ? "领取确认" : text(input.reason ?? "", 300);
    if (!reason) throw new AppError("撤销核销必须填写原因");
    if ((w.claimed ?? false) !== input.claimed) {
      w.claimed = input.claimed;
      w.claimedAt = input.claimed ? new Date().toISOString() : undefined;
      w.claimedBy = input.claimed
        ? (process.env.ADMIN_USER ?? "admin")
        : undefined;
      (w.claimHistory ??= []).push({
        at: new Date().toISOString(),
        claimed: input.claimed,
        reason,
        actor: process.env.ADMIN_USER ?? "admin",
      });
      a.stageSession.version++;
      audit(a, input.claimed ? "领取核销" : "撤销核销", `${wid} / ${reason}`);
    }
    const response = JSON.parse(JSON.stringify(w));
    a.stageOps.push({
      requestId: input.requestId,
      fingerprint: hash,
      response,
    });
    await persist(sql, a);
    return response;
  });
}
