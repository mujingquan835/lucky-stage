import type { Express, Request } from "express";
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";
import type { Config } from "./app.ts";
import { AppError, readActivity } from "./domain.ts";
import {
  configureCheckin,
  getCheckinSummary,
  getPublicCheckinInfo,
  submitCheckin,
  syncCheckin,
} from "./checkin-service.ts";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const idOf = (req: Request) => String(req.params.id);

export function publicCheckinRoutes(app: Express, db: Db) {
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

  app.use("/api/checkin", (req, _res, next) => {
    consume("ip:" + hash(req.ip ?? "unknown"), 20000);
    next();
  });

  app.get("/api/checkin/:id/info", async (req, res) => {
    const id = idOf(req);
    if (!validId(id)) throw new AppError("活动不存在", 404);
    res.json(await getPublicCheckinInfo(db, id));
  });

  app.post("/api/checkin/:id/submit", async (req, res) => {
    const id = idOf(req);
    if (!validId(id)) throw new AppError("活动不存在", 404);
    res.json(await submitCheckin(db, id, req.body ?? {}));
  });

  app.use("/api/checkin", (_req, res) =>
    res.status(404).json({ error: "接口不存在" }),
  );
}

export function adminCheckinRoutes(
  app: Express,
  db: Db,
  c: Config,
  qr: { toBuffer: (value: string, options: { width: number; margin: number }) => Promise<Buffer> },
) {
  app.put("/api/activities/:id/checkin", async (req, res) => {
    res.json(await configureCheckin(db, idOf(req), req.body));
  });

  app.get("/api/activities/:id/checkin/qr", async (req, res) => {
    const activity = await readActivity(db, idOf(req));
    const target = new URL("/checkin/" + encodeURIComponent(activity.id), c.appOrigin);
    res.type("png").send(await qr.toBuffer(target.href, { width: 360, margin: 3 }));
  });

  app.get("/api/activities/:id/checkin/summary", async (req, res) => {
    await readActivity(db, idOf(req));
    res.json(await getCheckinSummary(db, idOf(req)));
  });

  app.post("/api/activities/:id/checkin/sync", async (req, res) => {
    res.json(await syncCheckin(db, idOf(req)));
  });
}
