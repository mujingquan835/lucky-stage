import { randomUUID } from "node:crypto";
import type { Db, Sql } from "./db.ts";
import {
  AppError,
  audit,
  mutate,
  persist,
  readActivity,
  required,
  text,
  type Activity,
  type Person,
} from "./domain.ts";
import { maskText } from "../shared/self-service.ts";
import {
  resolveCheckinFields,
  type CheckinConfig,
  type CheckinField,
} from "../shared/checkin.ts";

export type { CheckinConfig, CheckinField };

export const defaultCheckinConfig = (): CheckinConfig => ({
  enabled: false,
  startsAt: "",
  endsAt: "",
  askCompany: false,
  askStore: false,
  fields: [],
});

export function maskPhone(phone: string) {
  const s = phone.trim();
  if (s.length <= 2) return "*".repeat(s.length);
  if (s.length < 7) return s[0] + "*".repeat(s.length - 2) + s[s.length - 1];
  return s.slice(0, 3) + "****" + s.slice(-4);
}

function validOptionalIso(v: unknown, label: string) {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") throw new AppError(`${label}格式无效`);
  const s = v.trim();
  if (!s) return "";
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new AppError(`${label}格式无效`);
  return new Date(ms).toISOString();
}

export function checkinOpenState(
  cfg: Partial<CheckinConfig> | undefined,
  archived: boolean,
  nowMs = Date.now(),
) {
  if (archived) return { open: false, reason: "活动已归档" };
  if (!cfg?.enabled) return { open: false, reason: "扫码报名暂未开启" };
  if (cfg.startsAt) {
    const startMs = Date.parse(cfg.startsAt);
    if (Number.isFinite(startMs) && nowMs < startMs)
      return { open: false, reason: "扫码报名尚未开始" };
  }
  if (cfg.endsAt) {
    const endMs = Date.parse(cfg.endsAt);
    if (Number.isFinite(endMs) && nowMs >= endMs)
      return { open: false, reason: "扫码报名已结束" };
  }
  return { open: true, reason: "报名进行中" };
}

function validateFields(raw: unknown, askCompany: boolean, askStore: boolean): CheckinField[] {
  if (raw === undefined) {
    return resolveCheckinFields({ askCompany, askStore });
  }
  if (!Array.isArray(raw)) throw new AppError("自定义字段格式无效");
  if (raw.length > 20) throw new AppError("最多添加 20 个自定义字段");
  const reserved = new Set(["姓名", "手机号", "手机", "电话", "联系电话"]);
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  const result: CheckinField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new AppError("字段配置无效");
    const label = required((item as any).label, "字段名称", 30);
    if (reserved.has(label))
      throw new AppError(`“${label}”为系统固定字段，无需重复添加`);
    if (seenLabels.has(label))
      throw new AppError(`字段名称“${label}”重复，请修改`);
    seenLabels.add(label);
    let id = typeof (item as any).id === "string" ? (item as any).id.trim() : "";
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || seenIds.has(id)) {
      id = "f_" + randomUUID().slice(0, 8);
    }
    seenIds.add(id);
    const placeholder = text((item as any).placeholder ?? "", 60);
    result.push({
      id,
      label,
      required: Boolean((item as any).required),
      ...(placeholder ? { placeholder } : {}),
    });
  }
  return result;
}

type InfoCacheEntry = {
  expires: number;
  value: {
    id: string;
    name: string;
    subtitle: string;
    color: string;
    enabled: boolean;
    open: boolean;
    reason: string;
    askCompany: boolean;
    askStore: boolean;
    fields: CheckinField[];
  };
};

const infoCache = new WeakMap<Db, Map<string, InfoCacheEntry>>();

function clearInfoCache(db: Db, id: string) {
  infoCache.get(db)?.delete(id);
}

export async function configureCheckin(db: Db, id: string, input: any) {
  if (!input || typeof input !== "object") throw new AppError("配置无效");
  if (typeof input.enabled !== "boolean") throw new AppError("开关值无效");
  const startsAt = validOptionalIso(input.startsAt, "开始时间");
  const endsAt = validOptionalIso(input.endsAt, "结束时间");
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt))
    throw new AppError("结束时间必须晚于开始时间");
  const askCompany = Boolean(input.askCompany);
  const askStore = Boolean(input.askStore);
  const fields = validateFields(input.fields, askCompany, askStore);
  const cfg: CheckinConfig = {
    enabled: input.enabled,
    startsAt,
    endsAt,
    askCompany: askCompany || fields.some((f) => f.id === "company"),
    askStore: askStore || fields.some((f) => f.id === "store"),
    fields,
  };
  const saved = await mutate(db, id, (a) => {
    a.checkin = cfg;
    audit(
      a,
      "更新扫码报名设置",
      `${cfg.enabled ? "开启" : "关闭"}，自定义字段 ${fields.length} 个`,
    );
    return a.checkin;
  });
  clearInfoCache(db, id);
  return saved;
}

export async function getPublicCheckinInfo(db: Db, id: string) {
  let map = infoCache.get(db);
  if (!map) {
    map = new Map();
    infoCache.set(db, map);
  }
  const cached = map.get(id);
  const nowMs = Date.now();
  if (cached && cached.expires > nowMs) return cached.value;

  const { rows } = await db.query(
    `SELECT
       data->>'name' AS name,
       data->>'subtitle' AS subtitle,
       data->>'color' AS color,
       data->>'archived' AS archived,
       data->'checkin' AS checkin
     FROM activities WHERE id=$1`,
    [id],
  );
  if (!rows.length) throw new AppError("活动不存在", 404);
  const row = rows[0];
  const archived = row.archived === "true";
  const cfg = (row.checkin ?? defaultCheckinConfig()) as Partial<CheckinConfig>;
  const { open, reason } = checkinOpenState(cfg, archived, nowMs);
  const fields = resolveCheckinFields(cfg);
  const value = {
    id,
    name: String(row.name ?? ""),
    subtitle: String(row.subtitle ?? ""),
    color: String(row.color ?? "#c9252d"),
    enabled: Boolean(cfg.enabled),
    open,
    reason,
    askCompany: Boolean(cfg.askCompany),
    askStore: Boolean(cfg.askStore),
    fields,
  };
  map.set(id, { expires: nowMs + 1500, value });
  return value;
}

function normalizePhone(raw: unknown) {
  const s = required(raw, "手机号", 40).replace(/\s+/g, "");
  if (!/^[+\d()-]{5,30}$/.test(s) || s.replace(/\D/g, "").length < 5)
    throw new AppError("请输入有效的手机号码");
  return s;
}

export async function submitCheckin(db: Db, id: string, body: any) {
  const name = required(body?.name, "姓名", 80);
  const phone = normalizePhone(body?.phone);
  const requestId = text(body?.requestId ?? "", 100);

  const info = await getPublicCheckinInfo(db, id);
  if (!info.open) throw new AppError(info.reason, 403);

  const rawExtra =
    body?.extra && typeof body.extra === "object" && !Array.isArray(body.extra)
      ? (body.extra as Record<string, unknown>)
      : {};

  let company = "";
  let store = "";
  const extraNamed: Record<string, string> = {};

  for (const field of info.fields) {
    const rawVal =
      rawExtra[field.id] !== undefined
        ? rawExtra[field.id]
        : field.id === "company"
          ? body?.company
          : field.id === "store"
            ? body?.store
            : "";
    const val = rawVal === undefined || rawVal === null ? "" : text(String(rawVal), 120);
    if (field.required && !val) {
      throw new AppError(`请填写${field.label}`);
    }
    if (val) {
      if (field.id === "company") company = val;
      else if (field.id === "store") store = val;
      else extraNamed[field.label] = val;
    }
  }

  const nowMs = Date.now();
  const entryId = randomUUID();
  const inserted = await db.query(
    `INSERT INTO checkin_entries (id, activity_id, name, phone, company, store, extra, request_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     ON CONFLICT (activity_id, phone) DO NOTHING
     RETURNING id`,
    [
      entryId,
      id,
      name,
      phone,
      company,
      store,
      JSON.stringify(extraNamed),
      requestId,
      nowMs,
    ],
  );
  if (inserted.rows.length > 0) {
    return {
      alreadyCheckedIn: false,
      entry: {
        name: maskText(name),
        phone: maskPhone(phone),
        createdAt: nowMs,
      },
    };
  }
  const existing = await db.query(
    `SELECT name, phone, created_at FROM checkin_entries WHERE activity_id=$1 AND phone=$2`,
    [id, phone],
  );
  const row = existing.rows[0];
  return {
    alreadyCheckedIn: true,
    entry: {
      name: maskText(String(row?.name ?? name)),
      phone: maskPhone(String(row?.phone ?? phone)),
      createdAt: Number(row?.created_at ?? nowMs),
    },
  };
}

export async function syncCheckinToActivity(sql: Sql, a: Activity) {
  const { rows } = await sql.query(
    `SELECT id, name, phone, company, store, extra, created_at
     FROM checkin_entries
     WHERE activity_id=$1 AND synced_person_id IS NULL
     ORDER BY created_at ASC`,
    [a.id],
  );
  if (!rows.length) return { synced: 0, added: 0, modified: false };

  const byPhone = new Map<string, Person>(a.people.map((p) => [p.phone, p]));
  let added = 0;
  let updated = 0;
  const updates: { entryId: string; personId: string }[] = [];

  for (const r of rows) {
    const phone = String(r.phone);
    const existing = byPhone.get(phone);
    const checkedInAt = new Date(Number(r.created_at) || Date.now()).toISOString();
    const extraObj =
      r.extra && typeof r.extra === "object" && !Array.isArray(r.extra)
        ? (r.extra as Record<string, string>)
        : {};
    const hasExtra = Object.keys(extraObj).length > 0;
    if (existing) {
      if (!existing.checkedIn) {
        existing.checkedIn = true;
        existing.checkedInAt ??= checkedInAt;
        updated++;
      }
      if (hasExtra) {
        existing.extra = { ...(existing.extra ?? {}), ...extraObj };
        updated++;
      }
      updates.push({ entryId: String(r.id), personId: existing.id });
    } else {
      if (a.people.length >= 10000)
        throw new AppError("单场活动最多 10000 人，无法继续同步扫码名单");
      const person: Person = {
        id: randomUUID(),
        name: String(r.name),
        phone,
        company: String(r.company ?? ""),
        store: String(r.store ?? ""),
        drawChances: 1,
        enabled: true,
        checkedIn: true,
        checkedInAt,
        ...(hasExtra ? { extra: extraObj } : {}),
      };
      a.people.push(person);
      byPhone.set(phone, person);
      added++;
      updates.push({ entryId: String(r.id), personId: person.id });
    }
  }

  for (const u of updates) {
    await sql.query(
      `UPDATE checkin_entries SET synced_person_id=$1 WHERE id=$2`,
      [u.personId, u.entryId],
    );
  }

  const modified = added > 0 || updated > 0;
  if (modified) {
    audit(
      a,
      "同步扫码报名名单",
      `新增 ${added} 人${updated ? `，更新 ${updated} 条` : ""}`,
    );
  }
  return { synced: updates.length, added, modified };
}

export async function syncCheckin(db: Db, id: string) {
  return db.transaction(async (sql) => {
    const a = await readActivity(sql, id, true);
    const res = await syncCheckinToActivity(sql, a);
    if (res.modified) await persist(sql, a);
    return { synced: res.synced, added: res.added, totalPeople: a.people.length };
  });
}

export async function getCheckinSummary(db: Db, id: string) {
  const [counts, recent] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE synced_person_id IS NULL)::int AS unsynced
       FROM checkin_entries WHERE activity_id=$1`,
      [id],
    ),
    db.query(
      `SELECT name, created_at
       FROM checkin_entries
       WHERE activity_id=$1
       ORDER BY created_at DESC
       LIMIT 12`,
      [id],
    ),
  ]);
  return {
    totalCount: Number(counts.rows[0]?.total ?? 0),
    unsyncedCount: Number(counts.rows[0]?.unsynced ?? 0),
    recent: recent.rows.map((r) => ({
      name: maskText(String(r.name ?? "")),
      createdAt: Number(r.created_at ?? 0),
    })),
  };
}
