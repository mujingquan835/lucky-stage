import { useRef, useState } from "react";
import { api, ApiError } from "./api";
export default function TestTools({
  activity,
  refresh,
  disabled,
}: {
  activity: any;
  refresh: () => Promise<void>;
  disabled: boolean;
}) {
  const key = "testing-pending-" + activity.id;
  const [count, setCount] = useState(100),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState<any>(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    });
  const lock = useRef(false);
  async function run(action: string, retry = false) {
    if (lock.current || (!retry && pending) || disabled) return;
    if (
      action === "reset" &&
      !retry &&
      !confirm(
        "清空本测试活动的全部中奖和领取记录，恢复礼品库存及中奖资格？名单、礼品配置和其他活动不受影响。",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    let body = pending;
    try {
      if (!retry) {
        const v =
          action === "reset"
            ? await api("/activities/" + activity.id + "/stage")
            : null;
        body = {
          action,
          count,
          requestId: crypto.randomUUID(),
          ...(v ? { expectedVersion: v.session.version } : {}),
        };
        setPending(body);
        sessionStorage.setItem(key, JSON.stringify(body));
      }
      const r = await api(
        "/activities/" + activity.id + "/testing",
        "POST",
        body,
      );
      setPending(null);
      sessionStorage.removeItem(key);
      await refresh();
      setMessage(
        r.reset
          ? "测试结果已清空，库存和中奖资格已恢复"
          : `已添加 ${r.peopleAdded} 位测试来宾、${r.giftsAdded} 种测试礼品${!r.giftsAdded && action === "gifts" ? "（已有测试礼品不会重复添加）" : ""}`,
      );
    } catch (e) {
      setMessage((e as Error).message);
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        setPending(null);
        sessionStorage.removeItem(key);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="test-tools panel" aria-label="测试模式工具箱">
      <div>
        <b>测试模式 · 独立测试活动</b>
        <p>
          测试数据不会添加到正式活动。电话为 TEST 编号，80%
          来宾标记到场；礼品使用示意图。
        </p>
      </div>
      <div className="test-tools-actions">
        <label>
          测试人数
          <select
            aria-label="测试人数"
            value={count}
            disabled={busy || !!pending || disabled}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[20, 100, 1000].map((n) => (
              <option key={n} value={n}>
                {n}人
              </option>
            ))}
          </select>
        </label>
        {[
          ["all", "一键准备测试数据"],
          ["people", "添加测试人员"],
          ["gifts", "添加测试礼品"],
          ["reset", "清空测试结果"],
        ].map(([action, label]) => (
          <button
            className={"button small " + (action === "all" ? "primary" : "")}
            key={action}
            disabled={busy || !!pending || disabled}
            onClick={() => run(action)}
          >
            {label}
          </button>
        ))}
        {pending && (
          <button
            className="button small"
            disabled={busy || disabled}
            onClick={() => run("", true)}
          >
            恢复测试操作
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
