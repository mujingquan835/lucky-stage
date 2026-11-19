import type { Express, Request } from "express";
import { randomBytes, createHash } from "node:crypto";
import { resolve } from "node:path";
import { access } from "node:fs/promises";
import type { Db } from "./db.ts";
import type { Config } from "./app.ts";
import { AppError, readActivity } from "./domain.ts";
import {
  configureSelf,
  generateCodes,
  participantState,
  selfDraw,
  selfReveal,
  selfStage,
  codePerson,
} from "./self-service.ts";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const cookieName = (id: string) => "participant_" + hash(id).slice(0, 16);
export function publicSelfRoutes(app: Express, db: Db, c: Config) {
  const buckets = new Map<string, { n: number; until: number }>();
  let swept = 0;
  function consume(key: string, max: number) {
    const time = Date.now();
    if (time - swept > 60000) {
      for (const [k, v] of buckets) if (v.until <= time) buckets.delete(k);
      swept = time;
    }
    const b = buckets.get(key);
    if (b && b.until > time) {
      if (b.n >= max) throw new AppError("请求过于频繁，请稍后重试", 429);
      b.n++;
      return;
    }
    if (buckets.size >= 50000) {
      for (const [k, v] of buckets) if (v.until <= time) buckets.delete(k);
      if (buckets.size >= 50000) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    buckets.set(key, { n: 1, until: time + 60000 });
  }
  app.use("/api/participate", (req, _res, next) => {
    consume("ip:" + hash(req.ip ?? "unknown"), 20000);
    next();
  });
  const attempts = new Map<string, { n: number; until: number }>();
  const path = "/api/participate/:id";
  const idOf = (req: Request) => String(req.params.id);
  const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  const options = (id: string) => ({
    httpOnly: true,
    sameSite: "strict" as const,
    secure: c.secureCookies,
    maxAge: 12 * 3600000,
    path: "/api/participate/" + encodeURIComponent(id),
  });
  let lastSessionClean = 0;
  async function session(req: Request) {
    const id = idOf(req),
      name = cookieName(id);
    const token =
      (req.headers.cookie ?? "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(name + "="))
        ?.slice(name.length + 1) ?? "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError("请输入抽奖码", 401);
    consume("session:" + hash(token), 120);
    const { rows } = await db.query(
      "SELECT activity_id,person_id,code_hash,expires FROM participant_sessions WHERE token_hash=$1",
      [hash(token)],
    );
    const s = rows[0];
    if (!s || s.activity_id !== id || Number(s.expires) <= Date.now())
      throw new AppError("会话已过期，请重新输入抽奖码", 401);
    const a = await readActivity(db, id),
      code = a.selfService?.codes[s.person_id];
    if (!code || hash(code) !== s.code_hash)
      throw new AppError("抽奖码已更换，请重新输入", 401);
    const person = codePerson(a, code);
    return { a, code, person };
  }
  app.post(path + "/login", async (req, res) => {
    const id = idOf(req);
    if (!validId(id)) throw new AppError("活动不存在", 404);
    const time = Date.now(),
      key = req.ip ?? "unknown";
    for (const [k, v] of attempts) if (v.until <= time) attempts.delete(k);
    const existing = attempts.get(key);
    const entry = existing ?? { n: 0, until: time + 15 * 60000 };
    if (entry.n >= 200) throw new AppError("尝试过多，请稍后重试", 429);
    if (!existing && attempts.size >= 10000) {
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
    const rawCode =
      typeof req.body?.code === "string"
        ? req.body.code.trim().toUpperCase()
        : "";
    consume("login:" + hash(id + ":" + rawCode), 20);

    const a = await readActivity(db, id);
    let p;
    try {
      p = codePerson(a, req.body?.code);
    } catch (e) {
      entry.n++;
      attempts.set(key, entry);
      throw e;
    }
    if (entry.n > 0) {
      entry.n = Math.max(0, entry.n - 1);
      if (entry.n === 0) attempts.delete(key);
      else attempts.set(key, entry);
    }
    const code = a.selfService!.codes[p.id];
    const token = randomBytes(32).toString("hex");
    if (time - lastSessionClean > 60000) {
      lastSessionClean = time;
      await db.query("DELETE FROM participant_sessions WHERE expires<$1", [time]);
    }
    await db.query(
      "INSERT INTO participant_sessions(token_hash,activity_id,person_id,code_hash,expires) VALUES($1,$2,$3,$4,$5)",
      [hash(token), id, p.id, hash(code), time + 12 * 3600000],
    );
    res.cookie(cookieName(id), token, options(id));
    res.json({ ok: true });
  });
  app.post(path + "/logout", async (req, res) => {
    const id = idOf(req);
    if (!validId(id)) throw new AppError("活动不存在", 404);
    const name = cookieName(id);
    const token =
      (req.headers.cookie ?? "")
        .split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(name + "="))
        ?.slice(name.length + 1) ?? "";
    if (token) {
      await db.query("DELETE FROM participant_sessions WHERE token_hash=$1", [
        hash(token),
      ]);
    }
    res.clearCookie(name, { ...options(id), maxAge: undefined });
    res.json({ ok: true });
  });
  app.get(path + "/me", async (req, res) => {
    const s = await session(req);
    res.json(await participantState(db, idOf(req), s.code));
  });
  app.post(path + "/draw", async (req, res) => {
    const s = await session(req);
    res.json(await selfDraw(db, idOf(req), s.code, req.body?.requestId));
  });
  app.post(path + "/reveal", async (req, res) => {
    const s = await session(req);
    res.json(await selfReveal(db, idOf(req), s.code, req.body?.requestId));
  });
  app.get(path + "/pool-images/:giftId", async (req, res) => {
    const { a } = await session(req);
    const g = a.gifts.find(
      (g) => g.id === String(req.params.giftId) && g.enabled && g.singleEnabled,
    );
    const file = g?.image?.match(/^\/api\/images\/([a-f0-9-]{36}\.webp)$/)?.[1];
    if (!file) throw new AppError("图片不存在", 404);
    const image = resolve(c.uploadDir, file);
    try {
      await access(image);
    } catch {
      throw new AppError("图片不存在", 404);
    }
    res.type("webp").sendFile(image);
  });
  app.get(path + "/images/:winnerId", async (req, res) => {
    const { a, person } = await session(req);
    const hidden =
      a.stageSession.phase === "rolling" ? a.stageSession.roundId : null;
    const w = a.rounds
      .filter((r) => r.id !== hidden)
      .flatMap((r) => r.winners)
      .find(
        (w) => w.id === String(req.params.winnerId) && w.personId === person.id,
      );
    const file = w?.giftImage?.match(
      /^\/api\/images\/([a-f0-9-]{36}\.webp)$/,
    )?.[1];
    if (!file) throw new AppError("图片不存在", 404);
    const image = resolve(c.uploadDir, file);
    try {
      await access(image);
    } catch {
      throw new AppError("图片不存在", 404);
    }
    res.type("webp").sendFile(image);
  });
  // Unknown public routes never fall through into an administrator endpoint.
  app.use("/api/participate", (_req, res) =>
    res.status(404).json({ error: "接口不存在" }),
  );
}
export function adminSelfRoutes(app: Express, db: Db) {
  app.put("/api/activities/:id/self", async (req, res) =>
    res.json(await configureSelf(db, String(req.params.id), req.body)),
  );
  app.post("/api/activities/:id/self/codes", async (req, res) => {
    if (
      req.body?.personId !== undefined &&
      (typeof req.body.personId !== "string" || !req.body.personId)
    )
      throw new AppError("参与者无效");
    res.json(
      await generateCodes(db, String(req.params.id), req.body?.personId),
    );
  });
  app.get("/api/activities/:id/self/stage", async (req, res) =>
    res.json(await selfStage(db, String(req.params.id))),
  );
}
