import { beijingInput, beijingToIso, beijingDisplay } from "./beijing-time";
import PrizeMachine, { type DisplayGift } from "./PrizeMachine";
import { GiftArt } from "./components";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type CSSProperties,
} from "react";
import { api, ApiError } from "./api";
import {
  nextSelfPage,
  syncSpotlights,
  finishSpotlight,
  type SpotlightState,
  type SelfWinner,
} from "../../shared/self-service";
import "./self-service.css";
const message = (e: unknown) => (e as Error).message;
export function Participate({ id }: { id: string }) {
  const path = "/participate/" + id;
  const pendingKey = (personId: string) =>
    "self-pending-" + id + "-" + personId;
  const [me, setMe] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(true),
    [pending, setPending] = useState(""),
    [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<"idle" | "rolling" | "revealed">("idle"),
    [outcome, setOutcome] = useState<any>(null),
    [pool, setPool] = useState<DisplayGift[]>([]);
  const lock = useRef(false),
    offset = useRef(0),
    generation = useRef(0);
  async function load() {
    const gen = ++generation.current;
    const data = await api(path + "/me");
    if (gen !== generation.current) return;
    offset.current = Date.parse(data.serverNow) - Date.now();
    setNow(Date.now() + offset.current);
    setMe(data);
    const key = pendingKey(data.personId),
      requestId =
        localStorage.getItem(key) || data.pendingDraw?.requestId || "";
    if (requestId) localStorage.setItem(key, requestId);
    setPending(requestId);
  }
  useEffect(() => {
    load()
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setChecking(false));
  }, [id]);
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => {
      setNow(Date.now() + offset.current);
      if (lock.current) return;
      load().catch((e) => {
        if (e.status === 401) {
          setMe(null);
          setPhase("idle");
        }
        setError(e.message);
      });
    }, 5000);
    return () => clearInterval(t);
  }, [id, !!me]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api(path + "/login", "POST", { code: f.get("code") });
      setOutcome(null);
      setPhase("idle");
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start() {
    if (lock.current) return;
    const key = pendingKey(me.personId);
    lock.current = true;
    setBusy(true);
    setError("");
    setOutcome(null);
    setPool(
      (me.gifts ?? []).map((g: DisplayGift) =>
        pending ? { ...g, remaining: Math.max(1, g.remaining ?? 1) } : g,
      ),
    );
    let requestId = pending;
    try {
      if (!requestId) {
        requestId = crypto.randomUUID();
        localStorage.setItem(key, requestId);
        setPending(requestId);
      }
      setPhase("rolling");
      const result = await api(path + "/draw", "POST", { requestId });
      setOutcome(result[0]);
      await load();
    } catch (e) {
      setError(message(e));
      setPhase("idle");
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401 &&
        e.status !== 429
      ) {
        localStorage.removeItem(key);
        setPending("");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function stop() {
    if (lock.current || !pending || !me) return;
    const pid = me.personId;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(path + "/reveal", "POST", {
        requestId: pending,
      });
      setOutcome(result[0]);
      setPhase("revealed");
      localStorage.removeItem(pendingKey(pid));
      setPending("");
      await load();
    } catch (e) {
      setError(message(e));
      setPhase("idle");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (phase !== "rolling" || busy || !pending) return;
    const deadline = me?.pendingDraw?.revealAt
      ? Date.parse(me.pendingDraw.revealAt) - offset.current
      : Date.now();
    const t = setTimeout(
      () => {
        void stop();
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(t);
  }, [phase, busy, pending, me?.pendingDraw?.revealAt]);
  const config = me?.config,
    opened =
      config?.enabled &&
      !me?.archived &&
      now >= Date.parse(config.startsAt) &&
      now < Date.parse(config.endsAt);
  const status = me?.archived
    ? "活动已归档"
    : !config?.enabled
      ? "抽奖已暂停"
      : now < Date.parse(config.startsAt)
        ? "尚未开放"
        : now >= Date.parse(config.endsAt)
          ? "抽奖已结束"
          : "抽奖进行中";
  const landed = outcome
    ? { id: outcome.giftId, name: outcome.giftName, image: outcome.giftImage }
    : undefined;
  return (
    <main className="self-mobile">
      <div className="self-mobile-card">
        <span className="self-eyebrow">幸运现场 · 自主抽奖</span>
        <h1>{me?.activityName ?? "让幸运，与你相遇"}</h1>
        {checking ? (
          <p>正在连接活动…</p>
        ) : !me ? (
          <form onSubmit={login}>
            <p>输入专属抽奖码，亲手开启你的幸运。</p>
            <label>
              我的抽奖码
              <input
                name="code"
                required
                maxLength={24}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="请输入抽奖码"
              />
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "正在验证…" : "验证抽奖码"}
            </button>
          </form>
        ) : (
          <>
            <p className="self-identity">
              {me.name}
              <span>{me.store}</span>
            </p>
            <div className="self-draw-status">
              <strong className="self-status">{status}</strong>
              <span>剩余 {me.remainingChances} 次机会</span>
            </div>
            <section className="self-machine-wrap" aria-label="我的滚动抽奖">
              <PrizeMachine
                columns={3}
                gifts={phase === "idle" ? (me.gifts ?? []) : pool}
                running={phase === "rolling"}
                outcome={phase === "revealed" ? landed : undefined}
                caption={
                  phase === "rolling"
                    ? "点击停止，揭晓你的幸运好礼"
                    : phase === "revealed"
                      ? "幸运已揭晓，恭喜你！"
                      : "点击开始，让好运转起来"
                }
              />
            </section>
            {phase === "rolling" ? (
              <button
                className="button primary full self-stop"
                onClick={stop}
                disabled={busy}
              >
                {busy ? "正在确认…" : "停止揭晓"}
              </button>
            ) : (
              <button
                className="button primary full"
                onClick={start}
                disabled={
                  busy || (!pending && (!opened || me.remainingChances <= 0))
                }
              >
                {busy
                  ? "正在连接…"
                  : pending
                    ? "恢复本次抽奖"
                    : phase === "revealed" && me.remainingChances > 0
                      ? "再抽一次"
                      : "开始抽奖"}
              </button>
            )}
            {phase === "rolling" && (
              <p className="self-draw-hint">
                好礼正在滚动，由你决定何时停止 · 30秒自动揭晓
              </p>
            )}
            {phase === "revealed" && outcome && (
              <section className="self-outcome" role="status">
                <span>{outcome.voided ? "本次记录已作废" : "恭喜中奖"}</span>
                <GiftArt
                  image={outcome.giftImage}
                  name={outcome.giftName}
                  index={0}
                />
                <h2>{outcome.giftName}</h2>
                <p>
                  {me.name} · {me.store}
                </p>
              </section>
            )}
            <details className="self-times">
              <summary>查看活动开放时间</summary>
              <p>
                北京时间（UTC+8）
                <br />
                {config.startsAt
                  ? beijingDisplay(config.startsAt)
                  : "未设置"}
                <br />至{" "}
                {config.endsAt
                  ? beijingDisplay(config.endsAt)
                  : "未设置"}
              </p>
            </details>
            <section className="self-my-results">
              <h2>我的中奖记录</h2>
              {!me.winners.length ? (
                <p>
                  {phase === "rolling" ? "本次幸运即将揭晓…" : "幸运即将揭晓"}
                </p>
              ) : (
                me.winners.map((w: SelfWinner) => (
                  <article key={w.id}>
                    {w.giftImage && <img src={w.giftImage} alt="" />}
                    <div>
                      <b>{w.giftName}</b>
                      <p>{w.voided ? "已作废" : "已中奖"}</p>
                      <small>
                        {new Date(w.createdAt).toLocaleString("zh-CN", {
                          timeZone: "Asia/Shanghai",
                        })}
                      </small>
                    </div>
                  </article>
                ))
              )}
            </section>
            <button
              className="button"
              disabled={busy || !!pending || phase === "rolling"}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                generation.current++;
                setBusy(true);
                try {
                  await api(path + "/logout", "POST");
                  setMe(null);
                  setPhase("idle");
                  setOutcome(null);
                } catch (e) {
                  setError(message(e));
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              更换抽奖码
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {pending && phase !== "rolling" && (
          <p className="muted">本次抽奖尚未完成，请恢复后停止揭晓。</p>
        )}
      </div>
    </main>
  );
}

export function SelfSettings({
  activity,
  refresh,
}: {
  activity: any;
  refresh: () => Promise<void>;
}) {
  const config = activity.selfService ?? {
    enabled: false,
    startsAt: "",
    endsAt: "",
  };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const path = "/activities/" + activity.id + "/self",
    link = location.origin + "/participate/" + activity.id;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function exportCodes(rows: any[]) {
    const safe = (s: string) => {
      const value = /^[=+\-@\t\r\n]/.test(s) ? "'" + s : s;
      return '"' + value.replaceAll('"', '""') + '"';
    };
    const csv =
      "\uFEFF" +
      [
        ["姓名", "部门", "门店", "销售", "抽奖码"],
        ...rows.map((r) => [r.name, r.department ?? "", r.store, r.salesperson ?? "", r.code]),
      ]
        .map((r) => r.map(safe).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "个人抽奖码.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="panel self-settings">
      <h2>用户自主抽奖</h2>
      <p>用户在开放时间随时抽奖，与主持台共用次数和库存。</p>
      <label>
        用户抽奖链接
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <div className="self-actions">
        <button
          className="button"
          onClick={() =>
            navigator.clipboard
              .writeText(link)
              .then(() => setNotice("链接已复制"))
              .catch(() => setError("请选中链接手动复制"))
          }
        >
          复制链接
        </button>
        <a
          className="button"
          href={"/self-stage/" + activity.id}
          target="_blank"
          rel="noreferrer"
        >
          打开自主抽奖大屏
        </a>
      </div>
      <form
        key={
          activity.id +
          "-" +
          config.startsAt +
          "-" +
          config.endsAt +
          "-" +
          config.enabled
        }
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(async () => {
            await api(path, "PUT", {
              enabled: f.get("enabled") === "on",
              startsAt: beijingToIso(String(f.get("startsAt"))),
              endsAt: beijingToIso(String(f.get("endsAt"))),
            });
            setNotice("开放时间已保存");
          });
        }}
      >
        <p>
          时间按北京时间（UTC+8）填写：
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        <div className="self-actions">
          <label>
            开始时间
            <input
              name="startsAt"
              type="datetime-local"
              defaultValue={beijingInput(config.startsAt)}
              required
            />
          </label>
          <label>
            结束时间
            <input
              name="endsAt"
              type="datetime-local"
              defaultValue={beijingInput(config.endsAt)}
              required
            />
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={config.enabled}
          />{" "}
          开放自主抽奖（关闭即暂停）
        </label>
        <button className="button primary" disabled={busy || activity.archived}>
          保存自主抽奖设置
        </button>
      </form>
      <hr />
      <div className="self-actions">
        <button
          className="button"
          disabled={busy || activity.archived}
          onClick={() =>
            run(async () => {
              exportCodes(await api(path + "/codes", "POST", {}));
              setNotice("已补生成并导出抽奖码，已有码保持不变");
            })
          }
        >
          生成 / 导出个人抽奖码
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const personId = String(
            new FormData(e.currentTarget).get("personId"),
          );
          if (!confirm("更换后旧码及旧会话立即失效，确认更换？")) return;
          run(async () => {
            const rows = await api(path + "/codes", "POST", { personId });
            exportCodes(rows.filter((r: any) => r.personId === personId));
            setNotice("已更换并导出该客户的新码");
          });
        }}
      >
        <label>
          更换个人抽奖码
          <select name="personId" required defaultValue="">
            <option value="" disabled>
              选择客户
            </option>
            {activity.people.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.store || "无门店"}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={busy || activity.archived}>
          更换并导出该客户新码
        </button>
      </form>
      <p className="muted">
        抽奖码等同个人抽奖凭证，请单独发给本人。手机需能访问此地址；localhost
        仅限本机。
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
export function SelfStage({ id }: { id: string }) {
  const key = "self-stage-view-" + id,
    spotKey = key + "-spotlights";
  const [view, setView] = useState<{
      name: string;
      testMode: boolean;
      winners: SelfWinner[];
    } | null>(null),
    [error, setError] = useState(""),
    [paused, setPaused] = useState(false);
  const [page, setPage] = useState<{ ids: string[]; seen: string[] }>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(key) ?? "null");
      if (p && Array.isArray(p.ids) && Array.isArray(p.seen)) return p;
    } catch {}
    return { ids: [], seen: [] };
  });
  const [presentation, setPresentation] = useState<SpotlightState | null>(
    () => {
      try {
        const p = JSON.parse(localStorage.getItem(spotKey) ?? "null");
        if (
          p &&
          ["known", "done", "queue"].every(
            (k) =>
              Array.isArray(p[k]) &&
              p[k].every((v: unknown) => typeof v === "string"),
          )
        )
          return p;
      } catch {}
      return null;
    },
  );
  const [returning, setReturning] = useState(false),
    [returnStyle, setReturnStyle] = useState<CSSProperties>({});
  const latest = useRef<SelfWinner[]>([]),
    presentationRef = useRef(presentation),
    focusCard = useRef<HTMLElement | null>(null),
    grid = useRef<HTMLElement | null>(null);
  function savePresentation(p: SpotlightState) {
    presentationRef.current = p;
    setPresentation(p);
    localStorage.setItem(spotKey, JSON.stringify(p));
  }
  function available() {
    const done = new Set(presentationRef.current?.done ?? []);
    return latest.current.filter((w) => done.has(w.id));
  }
  useEffect(() => {
    let alive = true,
      inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await api("/activities/" + id + "/self/stage");
        if (!alive) return;
        latest.current = data.winners;
        setView(data);
        setError("");
        const state = syncSpotlights(presentationRef.current, data.winners);
        savePresentation(state);
        const eligible = data.winners.filter((w: SelfWinner) =>
          state.done.includes(w.id),
        );
        setPage((p) =>
          p.ids.some((wid) =>
            data.winners.some((w: SelfWinner) => w.id === wid),
          )
            ? p
            : nextSelfPage(eligible, p.seen),
        );
      } catch (e) {
        if (alive) setError(message(e));
      } finally {
        inFlight = false;
      }
    }
    load();
    const t = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(page));
  }, [page, key]);
  const spotlight = view?.winners.find((w) => w.id === presentation?.queue[0]);
  useEffect(() => {
    setReturning(false);
    setReturnStyle({});
    if (!spotlight) return;
    const winnerId = spotlight.id;
    const hold = setTimeout(() => {
      setPage((p) => ({
        ids: p.ids.includes(winnerId)
          ? p.ids
          : p.ids.length < 12
            ? [...p.ids, winnerId]
            : [winnerId],
        seen: [...new Set([...p.seen, winnerId])],
      }));
      setReturning(true);
    }, 2000);
    const finish = setTimeout(() => {
      const state = presentationRef.current;
      if (state?.queue[0] === winnerId)
        savePresentation(finishSpotlight(state));
      setReturning(false);
      setReturnStyle({});
    }, 2320);
    return () => {
      clearTimeout(hold);
      clearTimeout(finish);
    };
  }, [spotlight?.id]);
  useLayoutEffect(() => {
    if (!returning || !spotlight || !focusCard.current || !grid.current) return;
    const target = Array.from(
      grid.current.querySelectorAll<HTMLElement>("[data-winner-id]"),
    ).find((el) => el.dataset.winnerId === spotlight.id);
    if (!target) return;
    const from = focusCard.current.getBoundingClientRect(),
      to = target.getBoundingClientRect();
    setReturnStyle({
      transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width},${to.height / from.height})`,
      opacity: 0.2,
    });
  }, [returning, spotlight?.id]);
  function next() {
    setPage((p) => nextSelfPage(available(), p.seen));
  }
  function previous() {
    setPage((p) => {
      const list = available(),
        start = Math.max(0, list.findIndex((w) => w.id === p.ids[0]) - 12);
      return { ...p, ids: list.slice(start, start + 12).map((w) => w.id) };
    });
  }
  useEffect(() => {
    if (paused || spotlight) return;
    const t = setInterval(next, 8000);
    return () => clearInterval(t);
  }, [paused, !!spotlight]);
  const done = new Set(presentation?.done ?? []),
    visible = page.ids
      .map((wid) =>
        view?.winners.find(
          (w) =>
            w.id === wid &&
            (done.has(w.id) || (returning && w.id === spotlight?.id)),
        ),
      )
      .filter((w): w is SelfWinner => !!w),
    pending =
      view?.winners.filter((w) => !page.seen.includes(w.id)).length ?? 0;
  return (
    <main className="self-stage">
      <header>
        <span className="self-eyebrow">
          幸运现场 · 实时中奖榜 {view?.testMode ? "【测试模式】" : ""}
        </span>
        <h1>{view?.name ?? "正在连接活动…"}</h1>
        <p>幸运持续发生 · 恭喜各位中奖客户</p>
      </header>
      <div className="self-stage-summary">
        <b>已中奖 {view?.winners.length ?? 0} 人次</b>
        <span>待展示 {pending} 人 · 每页最多12人</span>
      </div>
      {error && (
        <p role="alert" className="self-stage-error">
          同步中断：{error}，保留已收到的结果
        </p>
      )}
      <section className="self-winner-grid" ref={grid}>
        {visible.map((w) => (
          <article
            key={w.id}
            data-testid="self-winner"
            data-winner-id={w.id}
            style={
              returning && w.id === spotlight?.id
                ? { visibility: "hidden" }
                : undefined
            }
          >
            <SelfWinnerContent winner={w} />
          </article>
        ))}
      </section>
      {!visible.length && !spotlight && (
        <p className="self-stage-empty">等待第一份幸运揭晓</p>
      )}
      {spotlight && (
        <div
          className={"self-spotlight " + (returning ? "is-returning" : "")}
          key={spotlight.id}
          data-testid="self-spotlight"
          data-winner-id={spotlight.id}
          role="status"
        >
          <article
            ref={focusCard}
            className="self-spotlight-card"
            style={returnStyle}
          >
            <span className="self-spotlight-label">✦ 恭喜中奖 ✦</span>
            <div className="self-spotlight-content">
              <SelfWinnerContent winner={spotlight} />
            </div>
          </article>
        </div>
      )}
      <footer>
        <button onClick={previous} disabled={!!spotlight}>
          上一页
        </button>
        <button onClick={() => setPaused(!paused)}>
          {paused ? "继续自动翻页" : "暂停翻页"}
        </button>
        <button onClick={next} disabled={!!spotlight}>
          下一页
        </button>
        <button
          onClick={() => {
            const fn = document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen();
            fn.catch((e) => setError(message(e)));
          }}
        >
          全屏切换
        </button>
        <span>
          {spotlight
            ? "新中奖展示 · 停留2秒"
            : paused
              ? "已暂停"
              : "每8秒自动翻页"}
        </span>
      </footer>
    </main>
  );
}
function SelfWinnerContent({ winner: w }: { winner: SelfWinner }) {
  return (
    <>
      <div className="self-gift-thumb">
        {w.giftImage ? <img src={w.giftImage} alt="" /> : <span>礼</span>}
      </div>
      <div>
        <h2 title={w.personName}>{w.personName}</h2>
        <p title={w.store}>{w.store || " "}</p>
        <strong title={w.giftName}>{w.giftName}</strong>
      </div>
    </>
  );
}
