import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { state } from "../../server/domain";
import { api, ApiError, upload } from "./api";
import StageControl from "./StageControl";

type Activity = Awaited<ReturnType<typeof state>>;
type PendingGift = {
  requestId: string;
  name: string;
  total: number;
  image: string;
};

export default function MobileHost({ id }: { id: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [giftOpen, setGiftOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const path = "/activities/" + encodeURIComponent(id);
  const pendingKey = "mobile-host-gift-" + id;
  const [pending, setPending] = useState<PendingGift | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
    } catch {
      return null;
    }
  });
  const refresh = useCallback(async () => {
    setActivity(await api<Activity>(path));
  }, [path]);
  useEffect(() => {
    void refresh().catch((err) => setError((err as Error).message));
  }, [refresh]);

  async function saveGift(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (lock.current || active) return;
    const form = event ? new FormData(event.currentTarget) : null;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let payload = pending;
      if (!payload && form) {
        const photo = form.get("photo");
        payload = {
          requestId: crypto.randomUUID(),
          name: String(form.get("name") ?? "").trim(),
          total: Number(form.get("total")),
          image: photo instanceof File && photo.size ? await upload(photo) : "",
        };
        sessionStorage.setItem(pendingKey, JSON.stringify(payload));
        setPending(payload);
      }
      if (!payload) return;
      await api(path + "/gifts", "POST", payload);
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      setGiftOpen(false);
      setNotice(`已添加 ${payload.name} · ${payload.total} 份`);
      await refresh();
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401
      ) {
        sessionStorage.removeItem(pendingKey);
        setPending(null);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  if (!activity)
    return (
      <main className="mobile-host">
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p className="loading">正在连接本场活动…</p>
        )}
      </main>
    );
  return (
    <main className="mobile-host">
      <header className="mobile-host-header">
        <div>
          <small>手机主持台</small>
          <h1>{activity.name}</h1>
        </div>
        <button
          className="button small"
          type="button"
          disabled={active || busy || activity.archived}
          onClick={() => setGiftOpen((value) => !value)}
        >
          {giftOpen ? "收起" : "添加礼品"}
        </button>
      </header>
      {error && (
        <p role="alert" className="host-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="host-notice">
          {notice}
        </p>
      )}
      {pending ? (
        <div className="panel host-recovery">
          <p>「{pending.name}」的添加结果待确认。</p>
          <button
            type="button"
            className="button primary"
            disabled={active || busy || activity.archived}
            onClick={() => void saveGift()}
          >
            恢复添加礼品
          </button>
        </div>
      ) : (
        giftOpen && (
          <form className="panel mobile-gift" onSubmit={saveGift}>
            <label>
              礼品名称
              <input name="name" required maxLength={80} />
            </label>
            <label>
              数量
              <input
                name="total"
                type="number"
                inputMode="numeric"
                min={1}
                max={100000}
                defaultValue={1}
                required
              />
            </label>
            <label>
              礼品照片
              <input
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
              />
            </label>
            <button className="button primary" disabled={active || busy}>
              {busy ? "保存中…" : "保存礼品"}
            </button>
          </form>
        )
      )}
      <StageControl
        activity={activity}
        refresh={refresh}
        onActiveChange={setActive}
        mobile
      initialMode={new URLSearchParams(location.search).get("mode") === "batch" ? "batch" : "single"}
      />
    </main>
  );
}
