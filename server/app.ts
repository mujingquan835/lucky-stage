import { publicSelfRoutes, adminSelfRoutes } from "./self-routes.ts";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { Db } from "./db.ts";
import {
  AppError,
  text,
  createActivity,
  deleteActivity,
  listActivities,
  state,
  updateActivity,
  copyActivity,
  addPeople,
  updatePerson,
  deletePerson,
  clearPeople,
  saveGift,
  increaseGift,
  deleteGift,
  draw,
  voidWinner,
  findRound,
  readActivity,
  validatePeople,
  previewPeopleImport,
  importPeople,
  savePersonPhotos,
} from "./domain.ts";
import {
  stageCommand,
  getStage,
  saveRoundPlan,
  deleteRoundPlan,
  claimWinner,
} from "./stage.ts";
import { createTestActivity, testData } from "./testing.ts";
import { validateAudio } from "./audio.ts";
import { hashToken, passwordCheck, parseToken } from "./security.ts";
import { workbook, template, parseWorkbook } from "./workbooks.ts";
const libraryNames = ["智能体脂秤", "保暖手套", "保温杯", "便携充电宝", "手持挂烫机", "桌面暖风机", "空气炸锅", "高速吹风机", "定制礼盒套装", "大号鼠标垫"];
const libraryDir = fileURLToPath(new URL("./gift-library/", import.meta.url));
const qr = createRequire(import.meta.url)("qrcode") as {
  toBuffer: (value: string, options: { width: number; margin: number }) => Promise<Buffer>;
};
export type Config = {
  adminUser: string;
  adminPassword: string;
  appOrigin: string;
  uploadDir: string;
  secureCookies: boolean;
  distDir?: string;
  trustProxy?: boolean;
};
export function createApp(db: Db, c: Config) {
  if (c.adminPassword.length < 10) throw new Error("管理员密码至少 10 个字符");
  const normalizedOrigin = (() => {
    try {
      return new URL(c.appOrigin).origin;
    } catch {
      return c.appOrigin.replace(/\/+$/, "");
    }
  })();
  const app = express();
  app.disable("x-powered-by");
  if (c.trustProxy) app.set("trust proxy", 1);
  const check = passwordCheck(c.adminPassword);
  const limit = new Map<string, { n: number; until: number }>();
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:; frame-ancestors 'none'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers.origin !== normalizedOrigin ||
        req.headers["x-requested-with"] !== "lottery")
    )
      return res.status(403).json({ error: "请求来源无效，请从活动后台操作" });
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "lucky-event" }),
  );
  app.post("/api/auth/login", async (req, res) => {
    const key = req.ip ?? "unknown";
    const time = Date.now();
    for (const [k, v] of limit) if (v.until < time) limit.delete(k);
    const existing = limit.get(key);
    const attempts = existing ?? { n: 0, until: time + 15 * 60 * 1000 };
    if (attempts.n >= 10)
      throw new AppError("尝试过多，请 15 分钟后再试", 429);
    if (!existing && limit.size >= 10000) {
      const oldest = limit.keys().next().value;
      if (oldest !== undefined) limit.delete(oldest);
    }
    const username =
      typeof req.body?.username === "string" ? req.body.username : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length > 512) throw new AppError("密码过长");
    attempts.n++;
    limit.set(key, attempts);
    const valid = await check(password);
    if (username !== c.adminUser || !valid)
      throw new AppError("账号或密码不正确", 401);
    limit.delete(key);
    const token = randomBytes(32).toString("hex");
    await db.query("DELETE FROM sessions WHERE expires<$1", [time]);
    await db.query("INSERT INTO sessions(token_hash,expires) VALUES($1,$2)", [
      hashToken(token),
      time + 12 * 3600000,
    ]);
    res.cookie("lottery_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: c.secureCookies,
      maxAge: 12 * 3600000,
      path: "/",
    });
    res.json({ username: c.adminUser });
  });
  publicSelfRoutes(app, db, c);
  app.use("/api", async (req, res, next) => {
    const token = parseToken(req.headers.cookie);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new AppError("请先登录", 401);
    const { rows } = await db.query(
      "SELECT expires FROM sessions WHERE token_hash=$1",
      [hashToken(token)],
    );
    if (!rows[0] || Number(rows[0].expires) < Date.now())
      throw new AppError("登录已过期，请重新登录", 401);
    next();
  });
  adminSelfRoutes(app, db);
  app.get("/api/gift-library", (_req, res) => res.json(libraryNames.map((name, i) => ({ name, image: `/api/gift-library/images/${i}` }))));
  app.get("/api/gift-library/images/:id", (req, res) => {
    if (!/^(0|[1-9]\d*)$/.test(req.params.id) || Number(req.params.id) >= libraryNames.length)
      throw new AppError("图片不存在", 404);
    res.type("webp").sendFile(`${req.params.id}.webp`, { root: libraryDir });
  });
  app.get("/api/auth/me", (_req, res) => res.json({ username: c.adminUser }));
  app.post("/api/auth/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hashToken(parseToken(req.headers.cookie)),
    ]);
    res.clearCookie("lottery_session", {
      path: "/",
      secure: c.secureCookies,
      sameSite: "strict",
      httpOnly: true,
    });
    res.json({ ok: true });
  });
  app.get("/api/activities", async (_req, res) =>
    res.json(await listActivities(db)),
  );
  app.post("/api/activities", async (req, res) =>
    res.json(await createActivity(db, req.body ?? {})),
  );
  app.post("/api/testing/activities", async (_req, res) =>
    res.json(await createTestActivity(db)),
  );
  app.post("/api/activities/:id/testing", async (req, res) =>
    res.json(await testData(db, req.params.id, req.body)),
  );
  app.post("/api/demo", async (_req, res) => {
    const a = await createActivity(db, { name: "美好相聚 · 幸运盛典" });
    await updateActivity(db, a.id, {
      subtitle: "感谢一路同行，让幸运在此刻发生",
    });
    const names = [
      "林晓",
      "陈悦",
      "周宁",
      "许晴",
      "陆川",
      "苏瑶",
      "程远",
      "沈禾",
      "叶知",
      "宋一",
      "顾言",
      "唐心",
    ];
    await addPeople(
      db,
      a.id,
      names.map((name, i) => ({
        name,
        phone: `1380000${String(i + 1).padStart(4, "0")}`,
        company: ["星河科技", "晨曦传媒", "远景咨询"][i % 3],
        store: ["滨江门店", "中央公园店", "星河门店", "望江门店"][i % 4],
      })),
    );
    for (const g of [
      { name: "旅行好礼 · 行李箱", total: 2 },
      { name: "品质好礼 · 咖啡机", total: 3 },
      { name: "心意好礼 · 保温杯", total: 7 },
    ])
      await saveGift(db, a.id, g);
    res.json({ id: a.id });
  });
  app.delete("/api/activities/:id", async (req, res) => {
    await deleteActivity(db, req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/activities/:id", async (req, res) =>
    res.json(await state(db, req.params.id)),
  );
  app.patch("/api/activities/:id", async (req, res) =>
    res.json(await updateActivity(db, req.params.id, req.body ?? {})),
  );
  app.post("/api/activities/:id/copy", async (req, res) =>
    res.json(await copyActivity(db, req.params.id, text(req.body?.name, 80))),
  );
  app.get("/api/activities/:id/stage", async (req, res) =>
    res.json(await getStage(db, req.params.id)),
  );
  app.get("/api/activities/:id/host-stage", async (req, res) =>
    res.json(await getStage(db, req.params.id, true)),
  );
  app.get("/api/activities/:id/host-qr", async (req, res) => {
    const activity = await readActivity(db, req.params.id);
    const target = new URL("/host/" + encodeURIComponent(activity.id), c.appOrigin);
    res.type("png").send(await qr.toBuffer(target.href, { width: 300, margin: 4 }));
  });
  app.post("/api/activities/:id/stage-command", async (req, res) =>
    res.json(await stageCommand(db, req.params.id, req.body ?? {})),
  );
  app.post("/api/activities/:id/round-plans", async (req, res) =>
    res.json(await saveRoundPlan(db, req.params.id, req.body ?? {})),
  );
  app.delete("/api/activities/:id/round-plans/:planId", async (req, res) => {
    await deleteRoundPlan(db, req.params.id, req.params.planId);
    res.json({ ok: true });
  });
  app.post("/api/activities/:id/winners/:winnerId/claim", async (req, res) =>
    res.json(
      await claimWinner(db, req.params.id, req.params.winnerId, req.body ?? {}),
    ),
  );
  app.post("/api/activities/:id/people", async (req, res) =>
    res.json(await addPeople(db, req.params.id, req.body?.rows)),
  );
  app.patch("/api/activities/:id/people/:pid", async (req, res) =>
    res.json(
      await updatePerson(db, req.params.id, req.params.pid, req.body ?? {}),
    ),
  );
  app.delete("/api/activities/:id/people/:pid", async (req, res) => {
    await deletePerson(db, req.params.id, req.params.pid);
    res.json({ ok: true });
  });
  app.post("/api/activities/:id/people/clear", async (req, res) => {
    res.json(await clearPeople(db, req.params.id, req.body ?? {}));
  });
  app.post("/api/activities/:id/gifts", async (req, res) =>
    res.json(await saveGift(db, req.params.id, req.body ?? {})),
  );
  app.post("/api/activities/:id/gifts/:gid/increase", async (req, res) =>
    res.json(
      await increaseGift(db, req.params.id, req.params.gid, req.body?.amount),
    ),
  );
  app.delete("/api/activities/:id/gifts/:gid", async (req, res) => {
    await deleteGift(db, req.params.id, req.params.gid);
    res.json({ ok: true });
  });
  app.post("/api/activities/:id/draw", async (req, res) =>
    res.json(await draw(db, req.params.id, req.body ?? {})),
  );
  app.get("/api/activities/:id/requests/:rid", async (req, res) =>
    res.json(await findRound(db, req.params.id, req.params.rid)),
  );
  app.post("/api/activities/:id/winners/:wid/void", async (req, res) =>
    res.json(
      await voidWinner(db, req.params.id, req.params.wid, req.body?.reason),
    ),
  );
  app.get("/api/template", async (_req, res) =>
    sendWorkbook(res, await template(), "名单导入模板.xlsx"),
  );
  app.post(
    "/api/activities/:id/import-preview",
    express.raw({ type: "application/octet-stream", limit: "5mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError("请选择 .xlsx 文件");
      const a = await readActivity(db, req.params.id);
      if (a.archived) throw new AppError("活动已归档");
      const entries = await parseWorkbook(req.body);
      const errors: string[] = [];
      let result: ReturnType<typeof previewPeopleImport> = { rows: [], sourceRows: entries.length, warnings: [], planToken: "" };
      try {
        result = previewPeopleImport(a, entries);
      } catch (e) {
        errors.push((e as Error).message);
      }
      res.json({ ...result, entries, sheets: [...new Set(entries.map((r: any) => r.sheet))], errors });
    },
  );
  app.post("/api/activities/:id/import-confirm", async (req, res) => {
    if (typeof req.body?.planToken !== "string" || !/^[a-f0-9]{64}$/.test(req.body.planToken)) throw new AppError("请重新预览导入名单");
    res.json(await importPeople(db, req.params.id, req.body?.rows, req.body?.requestId, req.body.planToken));
  });
  app.post("/api/activities/:id/photo-mapping",
    express.raw({ type: "application/octet-stream", limit: "5mb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError("请选择 .xlsx 文件");
      const activity = await readActivity(db, req.params.id);
      if (activity.archived) throw new AppError("活动已归档");
      res.json(await parseWorkbook(req.body, true));
    });
  app.post("/api/activities/:id/person-photos", async (req, res) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 10000)
      throw new AppError("照片匹配须包含 1–10000 人");
    const photos = [...new Set<unknown>(rows.map(row => row?.photo))];
    for (const photo of photos) {
      if (photo === "") continue;
      if (typeof photo !== "string" || !/^\/api\/images\/[a-f0-9-]{36}\.webp$/.test(photo))
        throw new AppError("人物照片无效");
      await access(join(c.uploadDir, photo.split("/").at(-1)!)).catch(() => {
        throw new AppError("照片未上传，请重试");
      });
    }
    res.json(await savePersonPhotos(db, req.params.id, rows));
  });
  app.get("/api/activities/:id/export/:kind", async (req, res) => {
    const a = await state(db, req.params.id);
    if (req.params.kind === "people")
      return sendWorkbook(
        res,
        await workbook(
          ["姓名", "电话", "门店名称", "对应销售", "状态", "到场状态"],
          a.people.map((p) => [
            p.name,
            p.phone,
            p.store,
            p.salesperson ?? "",
            p.enabled ? "启用" : "停用",
            p.checkedIn ? "已到场" : "未到场",
          ]),
        ),
        "参与名单.xlsx",
      );
    if (req.params.kind !== "winners") throw new AppError("导出类型无效");
    const peopleById = new Map(a.people.map((p) => [p.id, p]));
    const rows = a.rounds.flatMap((r) =>
      r.winners.map((w) => [
        w.personName,
        w.company,
        w.phone,
        w.store,
        w.department ?? peopleById.get(w.personId)?.department ?? "",
        w.salesperson ?? peopleById.get(w.personId)?.salesperson ?? "",
        w.giftName,
        w.assignment === "assigned" ? "指定" : w.assignment === "random" ? "随机" : "",
        r.createdAt,
        w.voided ? "已作废" : "有效",
        w.voidReason ?? "",
        w.claimed ? "已领取" : "待领取",
        w.claimedAt ?? "",
        JSON.stringify(w.claimHistory ?? []),
      ]),
    );
    sendWorkbook(
      res,
      await workbook(
        [
          "姓名",
          "公司",
          "电话",
          "门店名称",
          "部门",
          "销售顾问",
          "礼品",
          "中奖来源",
          "中奖时间（UTC）",
          "状态",
          "作废原因",
          "领取状态",
          "领取时间（UTC）",
          "核销记录",
        ],
        rows,
      ),
      "中奖明细.xlsx",
    );
  });
  app.post(
    "/api/audio",
    express.raw({
      type: [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/ogg",
        "application/octet-stream",
      ],
      limit: "15mb",
    }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError("请选择 MP3、WAV 或 OGG 音频");
      const extension = validateAudio(req.body);
      await mkdir(c.uploadDir, { recursive: true });
      const file = randomUUID() + "." + extension;
      await writeFile(join(c.uploadDir, file), req.body, {
        flag: "wx",
        mode: 0o600,
      });
      res.json({ url: "/api/audio/" + file });
    },
  );
  app.get("/api/audio/:file", async (req, res) => {
    if (!/^[a-f0-9-]{36}\.(mp3|wav|ogg)$/.test(req.params.file))
      throw new AppError("音频不存在", 404);
    const path = resolve(c.uploadDir, req.params.file);
    try {
      await access(path);
    } catch {
      throw new AppError("音频不存在", 404);
    }
    res
      .type(
        req.params.file.endsWith(".mp3")
          ? "audio/mpeg"
          : req.params.file.endsWith(".wav")
            ? "audio/wav"
            : "audio/ogg",
      )
      .sendFile(path);
  });
  app.post(
    "/api/images",
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "5mb",
    }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new AppError("请选择 JPEG、PNG 或 WebP 图片");
      let output: Buffer;
      try {
        const img = sharp(req.body, {
          limitInputPixels: 40_000_000,
          failOn: "warning",
        });
        const meta = await img.metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format ?? ""))
          throw new Error();
        const size = req.query.portrait === "1" ? 640 : 1600;
        output = await img
          .rotate()
          .resize(size, size, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 88 })
          .toBuffer();
      } catch {
        throw new AppError("图片损坏、格式无效或尺寸过大，请更换图片");
      }
      await mkdir(c.uploadDir, { recursive: true });
      const file = randomUUID() + ".webp";
      await writeFile(join(c.uploadDir, file), output, {
        flag: "wx",
        mode: 0o600,
      });
      res.json({ url: "/api/images/" + file });
    },
  );
  app.get("/api/images/:file", async (req, res) => {
    if (!/^[a-f0-9-]{36}\.webp$/.test(req.params.file))
      throw new AppError("图片不存在", 404);
    const path = resolve(c.uploadDir, req.params.file);
    try {
      await access(path);
    } catch {
      throw new AppError("图片不存在", 404);
    }
    res.type("webp").sendFile(req.params.file, { root: c.uploadDir });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  if (c.distDir) {
    app.use(express.static(c.distDir));
    app.get("/{*splat}", (_req, res) =>
      res.sendFile("index.html", { root: c.distDir! }),
    );
  }
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError)
      return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "文件或数据过大，请缩小后重试" });
    if (err.type === "entity.parse.failed")
      return res.status(400).json({ error: "请求数据格式无效" });
    console.error("请求失败:", err.name, err.code ?? "");
    res.status(500).json({ error: "服务暂时不可用，请保留本轮请求并重试" });
  });
  return app;
}
function sendWorkbook(res: Response, buffer: Buffer, name: string) {
  res
    .set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    .send(buffer);
}
