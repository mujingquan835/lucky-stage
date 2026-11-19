import { randomBytes, createHash } from "node:crypto";
import type { Db } from "./db.ts";
import {
  AppError,
  roundRevealed as selfVisible,
  mutate,
  readActivity,
  chancesLeft,
  drawInActivity,
  audit,
  type Activity,
  type Person,
  type Round,
} from "./domain.ts";
import { maskText } from "../shared/self-service.ts";
export const defaultSelf = () => ({
  enabled: false,
  startsAt: "",
  endsAt: "",
  codes: {} as Record<string, string>,
});
export async function configureSelf(db: Db, id: string, input: any) {
  return mutate(db, id, (a) => {
    if (typeof input?.enabled !== "boolean") throw new AppError("开放开关无效");
    const start = Date.parse(input.startsAt),
      end = Date.parse(input.endsAt);
    if (
      typeof input.startsAt !== "string" ||
      typeof input.endsAt !== "string" ||
      !/Z$|[+-]\d\d:\d\d$/.test(input.startsAt) ||
      !/Z$|[+-]\d\d:\d\d$/.test(input.endsAt) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end
    )
      throw new AppError("开放时间无效，请设置开始和结束时间");
    a.selfService = {
      ...(a.selfService ?? defaultSelf()),
      enabled: input.enabled,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
    };
    audit(
      a,
      "修改自主抽奖设置",
      `${a.selfService.startsAt} / ${a.selfService.endsAt} / ${input.enabled}`,
    );
    return {
      enabled: input.enabled,
      startsAt: a.selfService.startsAt,
      endsAt: a.selfService.endsAt,
    };
  });
}
export async function generateCodes(db: Db, id: string, replaceId?: string) {
  return mutate(db, id, (a) => {
    a.selfService ??= defaultSelf();
    const codes = a.selfService.codes;
    const usedCodes = new Set(Object.values(codes));
    if (replaceId && !a.people.some((p) => p.id === replaceId))
      throw new AppError("参与者不存在", 404);
    for (const p of a.people)
      if (!codes[p.id] || p.id === replaceId) {
        let code: string;
        do {
          // A letter prefix keeps Excel from converting an all-digit code to a number.
          code = "A" + randomBytes(10).toString("hex").toUpperCase().slice(1);
        } while (usedCodes.has(code));
        codes[p.id] = code;
        usedCodes.add(code);
      }
    audit(
      a,
      replaceId ? "更换个人抽奖码" : "补生成抽奖码",
      replaceId ?? `${a.people.length} 人`,
    );
    return a.people.map((p) => ({
      personId: p.id,
      name: p.name,
      store: p.store,
      salesperson: p.salesperson ?? "",
      department: p.department ?? "",
      code: codes[p.id],
    }));
  });
}
export function codePerson(a: Activity, raw: unknown): Person {
  if (
    typeof raw !== "string" ||
    !/^[A-F0-9]{20}$/.test(raw.toUpperCase().trim())
  )
    throw new AppError("抽奖码无效或已失效", 401);
  const code = raw.toUpperCase().trim(),
    entry = Object.entries(a.selfService?.codes ?? {}).find(
      ([, v]) => v === code,
    );
  const p = a.people.find((p) => p.id === entry?.[0] && p.enabled);
  if (!p) throw new AppError("抽奖码无效或已失效", 401);
  return p;
}
export function ownWinner(a: Activity, r: Round, p: Person) {
  return r.winners
    .filter((w) => w.personId === p.id)
    .map((w) => ({
      id: w.id,
      giftId: w.giftId,
      personName: w.personName,
      store: w.store,
      giftName: w.giftName,
      voided: w.voided,
      createdAt: r.createdAt,
      giftImage: w.giftImage ? `/api/participate/${a.id}/images/${w.id}` : "",
    }));
}
export async function participantState(db: Db, id: string, code: unknown) {
  const a = await readActivity(db, id),
    p = codePerson(a, code),
    config = a.selfService ?? defaultSelf();
  return {
    personId: p.id,
    activityName: a.name,
    name: p.name,
    store: p.store,
    remainingChances: chancesLeft(a, p),
    archived: a.archived,
    config: {
      enabled: config.enabled,
      startsAt: config.startsAt,
      endsAt: config.endsAt,
    },
    serverNow: new Date().toISOString(),
    gifts: a.gifts
      .filter((g) => g.enabled && g.singleEnabled)
      .map((g) => ({
        id: g.id,
        name: g.name,
        image: g.image ? `/api/participate/${a.id}/pool-images/${g.id}` : "",
        remaining:
          g.total -
          a.rounds
            .flatMap((r) => r.winners)
            .filter((w) => !w.voided && w.giftId === g.id).length,
      })),
    pendingDraw:
      a.rounds
        .filter(
          (r) =>
            r.source === "self" &&
            r.winners.some((w) => w.personId === p.id && !w.voided) &&
            !selfVisible(r),
        )
        .map((r) => ({
          requestId: r.selfRequestId!,
          revealAt: r.selfRevealAt!,
        }))[0] ?? null,
    winners: a.rounds
      .filter(
        (r) =>
          selfVisible(r) &&
          !(a.stageSession.phase === "rolling" && r.id === a.stageSession.roundId),
      )
      .flatMap((r) => ownWinner(a, r, p)),
  };
}
export async function selfDraw(
  db: Db,
  id: string,
  code: unknown,
  requestId: unknown,
  time?: number,
) {
  return mutate(
    db,
    id,
    (a) => {
      const p = codePerson(a, code);
      if (
        typeof requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)
      )
        throw new AppError("请求标识无效");
      const key =
        "self:" +
        createHash("sha256")
          .update(p.id + ":" + requestId)
          .digest("hex");
      const old = a.rounds.find(
        (r) => r.requestId === key && r.source === "self",
      );
      if (old) return ownWinner(a, old, p);
      if (a.archived) throw new AppError("活动已归档");
      if (
        a.rounds.some(
          (r) =>
            r.source === "self" &&
            !selfVisible(r) &&
            r.winners.some((w) => w.personId === p.id && !w.voided),
        )
      )
        throw new AppError("请先停止并揭晓上一次抽奖");
      const config = a.selfService ?? defaultSelf();
      const lockedTime = time ?? Date.now();
      if (!config.enabled) throw new AppError("自主抽奖已暂停");
      if (!config.startsAt || lockedTime < Date.parse(config.startsAt))
        throw new AppError("抽奖尚未开放");
      if (!config.endsAt || lockedTime >= Date.parse(config.endsAt))
        throw new AppError("抽奖已结束");
      const receipt = drawInActivity(a, {
        requestId: key,
        mode: "single",
        personId: p.id,
      }, true);
      const round = a.rounds.find((r) => r.id === receipt.id)!;
      round.source = "self";
      round.selfRequestId = requestId;
      round.selfRevealAt = new Date(Date.now() + 30000).toISOString();
      return ownWinner(a, round, p);
    },
    true,
  );
}
export async function selfStage(db: Db, id: string) {
  const a = await readActivity(db, id);
  return {
    id: a.id,
    name: a.name,
    testMode: a.testMode ?? false,
    winners: a.rounds
      .slice()
      .reverse()
      .filter((r) => r.source === "self" && selfVisible(r))
      .flatMap((r) =>
        r.winners
          .filter((w) => !w.voided)
          .map((w) => ({
            id: w.id,
            personName: maskText(w.personName),
            store: a.showStore ? maskText(w.store) : "",
            giftName: w.giftName,
            giftImage: w.giftImage,
            createdAt: r.createdAt,
            voided: false,
          })),
      ),
  };
}

export async function selfReveal(
  db: Db,
  id: string,
  code: unknown,
  requestId: unknown,
) {
  return mutate(
    db,
    id,
    (a) => {
      const p = codePerson(a, code);
      if (
        typeof requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)
      )
        throw new AppError("请求标识无效");
      const key =
        "self:" +
        createHash("sha256")
          .update(p.id + ":" + requestId)
          .digest("hex");
      const r = a.rounds.find(
        (r) => r.source === "self" && r.requestId === key,
      );
      if (!r) throw new AppError("未找到本人的抽奖结果", 404);
      if (!selfVisible(r)) {
        r.selfRevealAt = new Date().toISOString();
        audit(a, "自主抽奖停止揭晓", r.id);
      }
      return ownWinner(a, r, p);
    },
    true,
  );
}
