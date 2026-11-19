import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { beijingInput, beijingToIso } from "./beijing-time";
import type { state } from "../../server/domain";
import {
  resolveCheckinFields,
  type CheckinField,
} from "../../shared/checkin";
import "./checkin.css";

type Activity = Awaited<ReturnType<typeof state>>;

type PublicCheckinInfo = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  enabled: boolean;
  open: boolean;
  reason: string;
  askCompany: boolean;
  askStore: boolean;
  fields?: CheckinField[];
};

type CheckinReceipt = {
  alreadyCheckedIn: boolean;
  entry: {
    name: string;
    phone: string;
    createdAt: number;
  };
};

type CheckinSummary = {
  totalCount: number;
  unsyncedCount: number;
  recent: { name: string; createdAt: number }[];
};

const storageKey = (id: string) => `lucky_checkin_${id}`;

const presetFields: CheckinField[] = [
  { id: "company", label: "公司 / 单位", required: false, placeholder: "请输入公司名称" },
  { id: "store", label: "门店 / 部门", required: false, placeholder: "请输入所属门店" },
  { id: "department", label: "部门", required: false, placeholder: "请输入所属部门" },
  { id: "jobNo", label: "工号", required: false, placeholder: "请输入工号" },
  { id: "wechat", label: "微信号", required: false, placeholder: "请输入微信号" },
];

export function CheckinPage({ id }: { id: string }) {
  const [info, setInfo] = useState<PublicCheckinInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<CheckinReceipt | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey(id));
      return raw ? (JSON.parse(raw) as CheckinReceipt) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<PublicCheckinInfo>(`/checkin/${encodeURIComponent(id)}/info`)
      .then((res) => {
        if (!active) return;
        setInfo(res);
        setError("");
      })
      .catch((e) => {
        if (active) setError((e as Error).message || "活动不存在或暂不可用");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const customFields = info ? resolveCheckinFields(info) : [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !info?.open) return;
    const form = new FormData(event.currentTarget);
    const extra: Record<string, string> = {};
    for (const f of customFields) {
      extra[f.id] = String(form.get(`field_${f.id}`) ?? "");
    }
    setBusy(true);
    setError("");
    try {
      const res = await api<CheckinReceipt>(
        `/checkin/${encodeURIComponent(id)}/submit`,
        "POST",
        {
          name: form.get("name"),
          phone: form.get("phone"),
          extra,
          requestId: crypto.randomUUID(),
        },
      );
      setReceipt(res);
      try {
        localStorage.setItem(storageKey(id), JSON.stringify(res));
      } catch {}
    } catch (e) {
      setError((e as Error).message || "提交失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="checkin-page">
      <section className="checkin-card">
        <div className="checkin-badge">现场扫码抽奖报名</div>
        <header className="checkin-header">
          <h1>{info?.name || (loading ? "正在加载活动…" : "幸运现场")}</h1>
          {info?.subtitle && <p>{info.subtitle}</p>}
        </header>

        {loading && !info && <p className="checkin-footnote">正在连接现场…</p>}

        {!loading && !info && error && (
          <div className="checkin-closed" role="alert">
            {error}
          </div>
        )}

        {info && receipt && (
          <div className="checkin-success" role="status">
            <div className="checkin-success-mark">✓</div>
            <h2>
              {receipt.alreadyCheckedIn ? "您已报名成功" : "报名成功，已进入奖池"}
            </h2>
            <p>请关注现场大屏开奖，祝您好运！</p>
            <div className="checkin-ticket">
              <div>
                <span>姓名</span>
                <strong>{receipt.entry.name}</strong>
              </div>
              <div>
                <span>手机号</span>
                <strong>{receipt.entry.phone}</strong>
              </div>
            </div>
            <p className="checkin-footnote">
              同一手机号仅计入一次，无需重复提交或刷新页面。
            </p>
          </div>
        )}

        {info && !receipt && !info.open && (
          <div className="checkin-closed" role="status">
            {info.reason || "扫码报名暂未开启"}
          </div>
        )}

        {info && !receipt && info.open && (
          <form className="checkin-form" onSubmit={submit}>
            {error && (
              <p className="checkin-error" role="alert">
                {error}
              </p>
            )}
            <div className="checkin-field">
              <label htmlFor="checkin-name">
                姓名<span>*</span>
              </label>
              <input
                id="checkin-name"
                name="name"
                required
                maxLength={80}
                placeholder="请输入您的真实姓名"
                autoComplete="name"
              />
            </div>
            <div className="checkin-field">
              <label htmlFor="checkin-phone">
                手机号<span>*</span>
              </label>
              <input
                id="checkin-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                required
                maxLength={30}
                placeholder="用于中奖核验"
                autoComplete="tel"
              />
            </div>
            {customFields.map((field) => (
              <div className="checkin-field" key={field.id}>
                <label htmlFor={`checkin-f-${field.id}`}>
                  {field.label}
                  {field.required ? <span>*</span> : "（选填）"}
                </label>
                <input
                  id={`checkin-f-${field.id}`}
                  name={`field_${field.id}`}
                  required={field.required}
                  maxLength={120}
                  placeholder={field.placeholder || `请输入${field.label}`}
                />
              </div>
            ))}
            <button className="checkin-submit" type="submit" disabled={busy}>
              {busy ? "正在提交…" : "立即报名参与抽奖"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export function CheckinSettings({
  activity,
  refresh,
}: {
  activity: Activity;
  refresh: () => Promise<void>;
}) {
  const cfg = activity.checkin ?? {
    enabled: false,
    startsAt: "",
    endsAt: "",
    askCompany: false,
    askStore: false,
    fields: [],
  };
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [startsAt, setStartsAt] = useState(beijingInput(cfg.startsAt));
  const [endsAt, setEndsAt] = useState(beijingInput(cfg.endsAt));
  const [fields, setFields] = useState<CheckinField[]>(() =>
    resolveCheckinFields(cfg),
  );
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState<CheckinSummary | null>(null);

  const checkinUrl = `${location.origin}/checkin/${encodeURIComponent(activity.id)}`;
  const qrUrl = `/api/activities/${encodeURIComponent(activity.id)}/checkin/qr`;

  async function loadSummary() {
    try {
      const data = await api<CheckinSummary>(
        `/activities/${encodeURIComponent(activity.id)}/checkin/summary`,
      );
      setSummary(data);
    } catch {}
  }

  useEffect(() => {
    void loadSummary();
  }, [activity.id]);

  function addField(preset?: CheckinField) {
    if (fields.length >= 20) {
      setError("最多添加 20 个自定义字段");
      return;
    }
    setError("");
    if (preset) {
      if (fields.some((f) => f.id === preset.id || f.label === preset.label)) {
        setError(`已存在“${preset.label}”字段`);
        return;
      }
      setFields((prev) => [...prev, { ...preset }]);
      return;
    }
    setFields((prev) => [
      ...prev,
      {
        id: "f_" + crypto.randomUUID().slice(0, 8),
        label: "",
        required: false,
        placeholder: "",
      },
    ]);
  }

  function updateField(index: number, patch: Partial<CheckinField>) {
    setFields((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || activity.archived) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<{ fields?: CheckinField[] }>(
        `/activities/${encodeURIComponent(activity.id)}/checkin`,
        "PUT",
        {
          enabled,
          startsAt: startsAt ? beijingToIso(startsAt) : "",
          endsAt: endsAt ? beijingToIso(endsAt) : "",
          askCompany: fields.some((f) => f.id === "company"),
          askStore: fields.some((f) => f.id === "store"),
          fields,
        },
      );
      if (Array.isArray(saved.fields)) setFields(saved.fields);
      await refresh();
      setNotice("扫码报名设置与字段已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (syncing || activity.archived) return;
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const res = await api<{ synced: number; added: number; totalPeople: number }>(
        `/activities/${encodeURIComponent(activity.id)}/checkin/sync`,
        "POST",
        {},
      );
      await Promise.all([refresh(), loadSummary()]);
      setNotice(
        res.synced > 0
          ? `已同步 ${res.synced} 条扫码记录（新增 ${res.added} 人，当前名单共 ${res.totalPeople} 人）`
          : "当前没有待同步的扫码记录",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(checkinUrl);
      setNotice("扫码报名链接已复制");
    } catch {
      setNotice(`请手动复制链接：${checkinUrl}`);
    }
  }

  return (
    <section className="panel settings-content">
      <header className="settings-heading">
        <div>
          <h2>现场扫码报名</h2>
          <p>
            开启后，大屏欢迎页将自动展示活动二维码；支持自定义报名字段，观众扫码提交即可进入奖池。
          </p>
        </div>
      </header>

      <div className="checkin-stats-bar">
        <span>
          已扫码人数：<strong>{summary?.totalCount ?? 0}</strong> 人
        </span>
        <span>
          待同步到名单：<strong>{summary?.unsyncedCount ?? 0}</strong> 人
        </span>
        <button
          type="button"
          className="secondary"
          disabled={syncing || activity.archived}
          onClick={syncNow}
        >
          {syncing ? "正在同步…" : "立即同步到名单"}
        </button>
        <button type="button" className="ghost" onClick={loadSummary}>
          刷新统计
        </button>
      </div>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="host-notice">
          {notice}
        </p>
      )}

      <div className="checkin-admin-grid">
        <form className="settings-form" onSubmit={save}>
          <fieldset disabled={activity.archived || busy}>
            <div className="settings-group">
              <label className="check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span>开启现场扫码报名（关闭后立即停止接收新报名）</span>
              </label>
            </div>

            <div className="checkin-fields-editor">
              <div className="checkin-fields-header">
                <strong>报名表单字段设置</strong>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => addField()}
                >
                  + 新增字段
                </button>
              </div>
              <div className="checkin-field-fixed">
                <span>姓名（系统必填）</span>
                <span>手机号（系统必填，用于去重）</span>
              </div>
              <div className="checkin-quick-pills">
                {presetFields.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className="checkin-quick-pill"
                    onClick={() => addField(p)}
                  >
                    + {p.label.split(" / ")[0]}
                  </button>
                ))}
              </div>
              {fields.map((field, index) => (
                <div className="checkin-field-row" key={field.id}>
                  <input
                    type="text"
                    value={field.label}
                    maxLength={30}
                    required
                    placeholder="字段名称（如：桌号）"
                    aria-label={`自定义字段 ${index + 1} 名称`}
                    onChange={(e) => updateField(index, { label: e.target.value })}
                  />
                  <input
                    type="text"
                    value={field.placeholder ?? ""}
                    maxLength={60}
                    placeholder="提示文字（选填）"
                    aria-label={`自定义字段 ${index + 1} 提示`}
                    onChange={(e) =>
                      updateField(index, { placeholder: e.target.value })
                    }
                  />
                  <label className="checkin-field-req">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateField(index, { required: e.target.checked })
                      }
                    />
                    必填
                  </label>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => removeField(index)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            <div className="settings-group">
              <label>
                <span>开始时间（北京时间，可留空表示开启即生效）</span>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </label>
              <label>
                <span>结束时间（北京时间，可留空表示手动关闭前一直有效）</span>
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </label>
            </div>
            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存扫码设置"}
              </button>
            </div>
          </fieldset>
        </form>

        <aside className="checkin-qr-box">
          <img src={qrUrl} alt="现场扫码报名二维码" />
          <div className="actions" style={{ justifyContent: "center" }}>
            <button type="button" className="secondary" onClick={copyLink}>
              复制报名链接
            </button>
            <a className="button ghost" href={qrUrl} download={`checkin-${activity.id}.png`}>
              下载二维码
            </a>
          </div>
          <small style={{ color: "#7d625f", wordBreak: "break-all" }}>
            {checkinUrl}
          </small>
        </aside>
      </div>
    </section>
  );
}
