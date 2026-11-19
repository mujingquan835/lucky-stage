import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { api, ApiError } from "./api";
import { GiftArt, Modal, date } from "./components";
import PrizeMachine from "./PrizeMachine";
import PersonRoll, { Portrait } from "./PersonRoll";
import Rehearsal from "./Rehearsal";
import StageCheck from "./StageCheck";
import { exportResultImage, useLiveAudio } from "./live-support";
import { Confetti } from "./LiveEffects";
import {
  defaultStageConfig,
  drawModeLabels,
  usesPortraits,
  type StageView,
  type StageCommand,
  type StageSelection,
  type Scene,
  type StageAssignment,
} from "../../shared/stage";
import "./stage-control.css";
const scenes: { id: Scene; label: string }[] = [
  { id: "welcome", label: "欢迎页" },
  { id: "gifts", label: "礼品墙" },
  { id: "draw", label: "抽奖" },
  { id: "winners", label: "中奖墙" },
  { id: "end", label: "结束页" },
];
export default function StageControl({
  activity,
  refresh,
  onActiveChange,
  mobile = false,
  initialMode = "single",
  onModeChange,
  onOpenRounds,
}: {
  activity: any;
  refresh: () => Promise<void>;
  onActiveChange: (v: boolean) => void;
  mobile?: boolean;
  initialMode?: StageSelection["mode"];
  onModeChange?: (mode: StageSelection["mode"]) => void;
  onOpenRounds?: () => void;
}) {
  const id = activity.id,
    base = "/activities/" + id,
    key = "stage-pending-" + id;
  const [view, setView] = useState<StageView | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<StageCommand | null>(() => {
      try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
      } catch {
        return null;
      }
    }),
    [mode, setMode] = useState<StageSelection["mode"]>(initialMode),
    [person, setPerson] = useState(""),
    [count, setCount] = useState(1),
    [store, setStore] = useState(""),
    [salesperson, setSalesperson] = useState(""),
    [query, setQuery] = useState(""),
    [plan, setPlan] = useState(""),
    [giftId, setGiftId] = useState(""),
    [assignments, setAssignments] = useState<StageAssignment[]>([]),
    [modal, setModal] = useState<"" | "rehearsal" | "check" | "mobile">(""),
    [now, setNow] = useState(Date.now());
  const pendingRef = useRef(pending),
    lock = useRef(false),
    alive = useRef(true),
    latest = useRef(-1),
    viewRef = useRef(view),
    refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  viewRef.current = view;
  const active =
    view?.session.phase === "rolling" || view?.session.phase === "decelerating";
  const audio = useLiveAudio(
    view?.config ?? defaultStageConfig(),
    view?.session,
  );
  const sync = useCallback(async () => {
    const v = await api<StageView>(base + "/host-stage");
    if (alive.current && v.session.version >= latest.current) {
      latest.current = v.session.version;
      setView(v);
      setConnected(true);
    }
    return v;
  }, [base]);
  useEffect(() => {
    alive.current = true;
    let working = false;
    const run = async () => {
      if (working) return;
      working = true;
      try {
        await sync();
      } catch (e) {
        if (alive.current) {
          setConnected(false);
          setError((e as Error).message);
        }
      } finally {
        working = false;
      }
    };
    void run();
    const t = setInterval(run, 750),
      tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      alive.current = false;
      clearInterval(t);
      clearInterval(tick);
    };
  }, [sync]);
  useEffect(() => {
    setMode((prev) => (prev === initialMode ? prev : initialMode));
  }, [initialMode]);
  const switchMode = (next: StageSelection["mode"]) => {
    setMode(next);
    setPlan("");
    onModeChange?.(next);
  };
  useEffect(() => {
    onActiveChange(!!active || !!pending);
  }, [active, pending, onActiveChange]);
  useEffect(() => {
    const t = setInterval(() => {
      void refreshRef.current().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (active || pendingRef.current) {
        e.preventDefault();
        e.returnValue = "本轮仍在进行";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  const remember = (p: StageCommand | null) => {
    pendingRef.current = p;
    setPending(p);
    if (p) sessionStorage.setItem(key, JSON.stringify(p));
    else sessionStorage.removeItem(key);
  };
  async function command(input: Partial<StageCommand>, retry = false) {
    if (lock.current || (!retry && pendingRef.current)) return;
    const v = viewRef.current;
    if (!v || (!connected && !retry)) return;
    const cmd = retry
      ? pendingRef.current!
      : ({
          ...input,
          requestId: crypto.randomUUID(),
          expectedVersion: v.session.version,
        } as StageCommand);
    if (!cmd) return;
    lock.current = true;
    setBusy(true);
    setError("");
    remember(cmd);
    try {
      await api(base + "/stage-command", "POST", cmd);
      if (cmd.action === "start") {
        setAssignments([]);
        setPlan("");
      }
      remember(null);
      await sync();
      await refreshRef.current();
      setNotice("已同步到现场大屏");
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401
      ) {
        remember(null);
        await sync().catch(() => {});
        await refreshRef.current().catch(() => {});
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const selection: StageSelection = {
    mode,
    ...(mode === "single" ? { personId: person } : { count, giftId }),
    scope: {
      ...(salesperson ? { salesperson } : {}),
      ...(store ? { store } : {}),
    },
    ...(plan ? { planId: plan } : {}),
    ...(mode === "batch" && assignments.length ? { assignments } : {}),
  };
  const chosenPlan = view?.plans.find(p => p.id === plan);
  const totalCount = chosenPlan?.count ?? count;
  const assignedIds = chosenPlan?.assignedPersonIds ?? assignments.map(entry => entry.personId);
  const draft = view?.hostDraft;
  const loadDraft = (saved: StageSelection) => {
    setMode(saved.mode);
    setPerson(saved.personId ?? "");
    setCount(saved.count ?? 1);
    setStore(saved.scope?.store ?? "");
    setSalesperson(saved.scope?.salesperson ?? "");
    setPlan(saved.planId ?? "");
    setGiftId(saved.giftId ?? "");
    setAssignments(saved.assignments ?? []);
  };
  const eligible = activity.people.filter(
    (p: any) =>
      p.enabled &&
      (!salesperson || p.salesperson === salesperson) &&
      p.remainingChances > 0 &&
      (!store || p.store === store),
  );
  const options = activity.people.filter((p: any) => (!salesperson || p.salesperson === salesperson) && (!store || p.store === store))
    .filter(
      (p: any) =>
        query.trim() && [p.name, p.store].join(" ").includes(query),
    )
    .slice(0, 200);
  const roundGift = activity.gifts.find((gift: any) => gift.id === giftId && gift.enabled);
  const batchCapacity = roundGift ? Math.min(roundGift.remaining, roundGift.batchLimit ?? 50) : 0;
  const validAssignments = mode !== "batch" || (
    assignedIds.length <= totalCount &&
    assignedIds.every(id => eligible.some((p: any) => p.id === id)) &&
    new Set(assignedIds).size === assignedIds.length
  );
  const validSelection = validAssignments && (mode === "single"
      ? eligible.some((p: any) => p.id === person)
      : (!plan || !!chosenPlan && !chosenPlan.completedRoundId) && Number.isInteger(count) &&
        count >= 1 && count <= 50 && count <= batchCapacity && count <= eligible.length);
  const disabled = busy || !!pending || !connected || activity.archived;
  const current = view?.currentRound,
    winners = current?.winners.filter((w) => !w.voided) ?? [];
  const wall = view?.session.scene === "winners";
  const displayWinners = wall
    ? view!.rounds.flatMap((r) => r.winners).filter((w) => !w.voided)
    : winners;
  const pageCount = Math.max(
    1,
    Math.ceil(
      (view?.session.scene === "winners"
        ? view.rounds.flatMap((r) => r.winners).filter((w) => !w.voided).length
        : winners.length) / 8,
    ),
  );
  const start = () => {
    if (!validSelection || active || disabled) return;
    if (mode === "batch" && assignedIds.length && !window.confirm(
      `本轮共 ${totalCount} 人，其中指定 ${assignedIds.length} 人、随机 ${totalCount - assignedIds.length} 人。确认开始？`,
    )) return;
    void command({ action: "start", selection });
  };
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const target = e.target as HTMLElement;
    if (
      e.repeat ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      modal ||
      pendingRef.current ||
      lock.current ||
      document.querySelector('[role="dialog"]') ||
      target?.closest('input,select,textarea,button,a,[contenteditable="true"]')
    )
      return;
    const k = e.key.toLowerCase();
    if (k === "f") {
      e.preventDefault();
      (document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen()
      ).catch((err) => setError(err.message));
      return;
    }
    if (k === "m") {
      audio.toggleMute();
      return;
    }
    if (disabled) return;
    if (k === " ") {
      e.preventDefault();
      if (viewRef.current?.session.phase === "rolling")
        void command({ action: "stop" });
      else if (!active) start();
    } else if (k === "r" && !active && current)
      void command({ action: "replay" });
    else if ((k === "arrowright" || k === "pagedown") && !active) {
      e.preventDefault();
      void command({
        action: "page",
        page: Math.min(pageCount - 1, (viewRef.current?.session.page ?? 0) + 1),
      });
    } else if ((k === "arrowleft" || k === "pageup") && !active) {
      e.preventDefault();
      void command({
        action: "page",
        page: Math.max(0, (viewRef.current?.session.page ?? 0) - 1),
      });
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const configs = view?.config ?? defaultStageConfig();
  const displaySelection = active ? view?.session.selection : selection;
  const ticking =
    active && view?.session.startedAt
      ? Math.max(
          0,
          3 - Math.floor((now - Date.parse(view.session.startedAt)) / 1000),
        )
      : 0;
  return (
    <div className={`stage-control${mobile ? " stage-control-mobile" : ""}`} data-drawing={!!active}>
      <div className="host-bar panel">
        <div>
          <b>现场主持台</b>
          <span className={connected ? "badge green" : "badge neutral"}>
            {connected ? (mobile ? "已连接服务" : "大屏已连接") : "连接中断"}
          </span>
          <small>
            版本 {view?.session.version ?? "—"} ·{" "}
            {active ? "本轮进行中" : "主持人可操作"}
          </small>
        </div>
        <div className="desktop-host-tools">
          <button
            className="button small"
            onClick={() => window.open("/stage/" + id, "lottery-stage")}
          >
            打开现场大屏 ↗
          </button>
          {!mobile && <button className="button small" onClick={() => setModal("mobile")}>手机主持台</button>}
          <button
            className="button small"
            disabled={active || !!pending}
            onClick={() => setModal("rehearsal")}
          >
            独立彩排
          </button>
          <button className="button small" onClick={() => setModal("check")}>
            现场自检
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {notice && (
        <div className="host-notice" role="status">
          {notice}
        </div>
      )}
      {pending && (
        <div className="host-recovery">
          <b>有一条操作尚未确认</b>
          <p>保留原请求标识，恢复时不会重复抽奖。请勿在其他窗口重复开始。</p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => command({}, true)}
          >
            查询并恢复本轮结果
          </button>
        </div>
      )}
      <nav className="host-scenes" aria-label="舞台场景">
        {scenes.map((s) => (
          <button
            key={s.id}
            data-testid={"scene-" + s.id}
            className={view?.session.scene === s.id ? "selected" : ""}
            disabled={disabled || active}
            onClick={() => command({ action: "scene", scene: s.id })}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="host-layout">
        <section className="panel host-selection">
          <h2>设置本轮抽奖</h2>
          <div className="segmented">
            <button
              disabled={disabled || active}
              className={mode === "batch" ? "selected" : ""}
              onClick={() => switchMode("batch")}
            >
              {drawModeLabels.batch.title}
            </button>
            <button
              disabled={disabled || active}
              className={mode === "single" ? "selected" : ""}
              onClick={() => switchMode("single")}
            >
              {drawModeLabels.single.title}
            </button>
          </div>
          <p className="muted">{drawModeLabels[mode].description}</p>
          {mode === "batch" && <div className="host-planned-round">
            <label>选用已保存轮次
              <select value={plan} disabled={disabled || active} onChange={e => {
                const next = view?.plans.find(item => item.id === e.target.value);
                setPlan(next?.id ?? "");
                setAssignments([]);
                if (next) {
                  setCount(next.count);
                  setGiftId(next.giftId);
                  setStore("");
                  setSalesperson("");
                }
              }}>
                <option value="">临时随机抽奖</option>
                {view?.plans.filter(item => !item.completedRoundId).map(item =>
                  <option key={item.id} value={item.id}>{item.name} · {item.count} 人</option>)}
              </select>
            </label>
            {chosenPlan ? <small>共 {totalCount} 人 · 指定 {assignedIds.length} 人 · 随机 {totalCount - assignedIds.length} 人</small>
              : <small>指定名额在「活动设置 → 抽奖轮次」会前安排。</small>}
            {chosenPlan && !validAssignments && <small role="alert">指定人员当前不在可抽范围，请核对参与资格或调整轮次。</small>}
            {onOpenRounds && <button type="button" className="text-button" disabled={active || !!pending}
              onClick={onOpenRounds}>管理抽奖轮次</button>}
          </div>}
          <fieldset disabled={disabled || active}>
            <legend>参与范围</legend>

            <label>
              门店
              <select
                value={store}
                disabled={!!chosenPlan}
                onChange={(e) => {
                  setStore(e.target.value);
                  setPerson("");
                }}
              >
                <option value="">全部门店</option>
                {[
                  ...new Set<string>(
                    activity.people
                      .map((p: any) => p.store)
                      .filter(Boolean),
                  ),
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>

            <label>查找销售<select aria-label="查找销售" value={salesperson} disabled={!!chosenPlan} onChange={e => { setSalesperson(e.target.value); setPerson(""); setQuery(""); }}><option value="">全部销售</option>{Array.from(new Set<string>(activity.people.map((p: any) => p.salesperson).filter(Boolean))).map(name => <option key={name}>{name}</option>)}</select></label>
            <p className="host-capacity">
              本轮可抽 <b>{eligible.length}</b> 人
            </p>
            {mode === "single" ? (
              <>
                <label>
                  选择可抽来宾
                  <select aria-label="选择可抽来宾" value={person} onChange={(e) => setPerson(e.target.value)}>
                    <option value="">请选择来宾</option>
                    {eligible.map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name} · {p.store || "来宾"} · 剩余 {p.remainingChances} 次</option>
                    ))}
                  </select>
                </label>
                <label>
                  查找来宾
                  <input
                    value={query}
                    onChange={(e) => { const q = e.target.value; setQuery(q); const matches = eligible.filter((p: any) => [p.name, p.store].join(" ").includes(q)); setPerson(q.trim() && matches.length === 1 ? matches[0].id : ""); }}
                    placeholder="姓名或门店"
                  />
                </label>
                <div aria-label="匹配来宾">{options.map((p: any) => <button type="button" className={person === p.id ? "button primary" : "button"} key={p.id} disabled={!p.enabled || p.remainingChances === 0} onClick={() => setPerson(p.id)}>{p.name} · {p.store || "来宾"}{p.remainingChances === 0 ? " · 已抽奖，不可选取" : ` · 剩余 ${p.remainingChances} 次`}{person === p.id ? " · 已选中" : ""}</button>)}{query.trim() && !options.length && <p>暂无符合条件的来宾</p>}</div>
                {eligible.length > 200 && (
                  <small>最多显示200位，请搜索缩小范围。</small>
                )}
              </>
            ) : (
              <>
                <label>本轮礼品
                  <select value={giftId} disabled={!!chosenPlan} onChange={e => {
                    setGiftId(e.target.value);
                    setPlan("");
                  }}>
                    <option value="">请选择奖项或礼品</option>
                    {activity.gifts.filter((gift: any) => gift.enabled).map((gift: any) =>
                      <option key={gift.id} value={gift.id} disabled={!gift.remaining}>{gift.name} · 剩 {gift.remaining} 份</option>)}
                  </select>
                </label>
                {roundGift && <p className="muted">本轮最多可抽 {Math.min(batchCapacity, eligible.length)} 人，中奖者均获得 {roundGift.name}。</p>}
                <label>
                  本轮人数
                  <input
                    aria-label="本轮人数"
                    type="number"
                    min="1"
                    max="50"
                    disabled={!!chosenPlan}
                    value={count}
                    onChange={(e) => {
                      setCount(Number(e.target.value));
                      setPlan("");
                    }}
                  />
                </label>
              </>
            )}
            <div className="host-draft-actions">
              <button type="button" className="button small" disabled={!validSelection}
                onClick={() => void command({ action: "save-draft", selection })}>保存下一轮草稿</button>
              {draft && <>
                <button type="button" className="button small" onClick={() => loadDraft(draft)}>载入已保存草稿</button>
                <button type="button" className="button small" onClick={() => void command({ action: "save-draft" })}>清除草稿</button>
              </>}
            </div>
          </fieldset>
          <div className="host-actions">
            {view?.session.phase === "rolling" ? (
              <button
                data-testid="host-stop"
                className="button primary full"
                disabled={disabled}
                onClick={() => command({ action: "stop" })}
              >
                停止并揭晓
              </button>
            ) : view?.session.phase === "decelerating" ? (
            <p className="host-capacity">正在减速揭晓…</p>
            ) : (
              <button
                className="button primary full"
                data-testid="host-start"
                disabled={disabled || !validSelection}
                onClick={start}
              >
                开始抽奖
              </button>
            )}
            <div>
              <button
                className="button small"
                disabled={disabled || active || !validSelection}
                onClick={() => command({ action: "prepare", selection })}
              >
                预览本轮
              </button>
              <button
                className="button small"
                data-testid="host-skip"
                disabled={disabled || !active}
                onClick={() => command({ action: "skip" })}
              >
                跳过动画
              </button>

            </div>
          </div>
          <small>
            空格开始 / 停止 · F全屏 · M静音 · R重播
            <br />
            开始即保存结果，停止只控制揭晓。30秒未停止自动揭晓。
          </small>
        </section>
        <section className="panel host-preview">
          <div className="host-preview-heading">
            <b>
              {view?.session.phase === "rolling"
                ? "好运正在转动"
                : view?.session.phase === "decelerating"
                  ? "即将揭晓"
                  : "幸运现场 · 抽奖大屏"}
            </b>
            <span>
              {view?.preview?.personName ||
                view?.preview?.giftName ||
                "先看好礼，再启幸运"}
            </span>
          </div>
          {view && ((usesPortraits(view) && view.session.phase !== "revealed") || (mode === "batch" && !active && view.session.phase !== "revealed"))
            ? <PersonRoll people={active ? view.participants : eligible.slice(0, 5)} running={!!active} masked={false} />
            : view && !usesPortraits(view) && <PrizeMachine
            key={`${view.session.roundId ?? "ready"}-${view.session.replay}`}
            gifts={view.session.selection?.giftId ? view.gifts.filter(g => g.id === view.session.selection?.giftId) : view.gifts.filter(g => g.singleEnabled)}
            running={!!active}
            outcome={view.session.phase === "decelerating" && winners[0] ? { id: winners[0].giftId, name: winners[0].giftName, image: winners[0].giftImage } : undefined}
          />}
          <div className="host-result">
            <h2>中奖数据</h2>
            {displayWinners.length &&
            (wall || view?.session.phase === "revealed") ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>姓名</th>
                      
                      <th>门店</th>
                      <th>中奖礼品</th>
                      <th>领取状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayWinners
                      .slice(
                        Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) * 8,
                        (Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) + 1) * 8,
                      )
                      .map((w) => (
                        <tr key={w.id}>
                          <td>{usesPortraits(view) && w.personPhoto && <Portrait key={w.personPhoto} name={w.personName} photo={w.personPhoto} />}{w.personName}</td>
                          
                          <td>{w.store || "—"}</td>
                          <td>{w.giftName}</td>
                          <td>{w.claimed ? "已领取" : "待领取"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {" "}
                {active ? "抽奖进行中，停止后显示中奖数据" : "暂无中奖数据"}
              </p>
            )}
          </div>
          <Confetti
            trigger={!!configs.celebrate && view?.session.phase === "revealed"}
          />
          <div className="host-review">
            <button
              className="button small"
              data-testid="host-replay"
              disabled={disabled || active || !current}
              onClick={() => command({ action: "replay" })}
            >
              重播本轮
            </button>
            <button
              className="button small"
              disabled={(!current && !wall) || active}
              onClick={() =>
                view &&
                exportResultImage(view, wall ? null : current).catch((e) =>
                  setError(e.message),
                )
              }
            >
              下载结果图
            </button>
            <button
              className="button small"
              disabled={
                disabled ||
                active ||
                Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) <= 0
              }
              onClick={() =>
                command({
                  action: "page",
                  page: Math.max(
                    0,
                    Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) - 1,
                  ),
                })
              }
            >
              上一页
            </button>
            <span>
              {Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) + 1}/{pageCount}
            </span>
            <button
              className="button small"
              disabled={
                disabled ||
                active ||
                Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) >= pageCount - 1
              }
              onClick={() =>
                command({
                  action: "page",
                  page: Math.min(
                    pageCount - 1,
                    Math.min(Math.max(0, view?.session.page ?? 0), pageCount - 1) + 1,
                  ),
                })
              }
            >
              下一页
            </button>
          </div>
        </section>
      </div>
      <details className="panel host-settings">
        <summary>本机声音</summary>
        <div className="host-review">
          <button
            className="button small"
            onClick={() =>
              audio.enabled ? audio.toggleMute() : audio.activate()
            }
          >
            {audio.enabled
              ? audio.muted
                ? "开启本机声音"
                : "本机静音"
              : "开启本机声音"}
          </button>
          <button className="button small" onClick={() => audio.test()}>
            试听
          </button>
          <small>投影大屏需在大屏窗口单独点击开启声音。</small>
          {audio.error && <span className="error">{audio.error}</span>}
        </div>
      </details>
      {view && view.rounds.length > 0 && (
        <section className="panel host-history">
          <h2>历史轮次回看</h2>
          <div>
            {view.rounds
              .slice()
              .reverse()
              .map((r, i) => (
                <button
                  className="button small"
                  key={r.id}
                  disabled={disabled || active}
                  onClick={() =>
                    command({ action: "scene", scene: "draw", roundId: r.id })
                  }
                >
                  {date(r.createdAt)} ·{" "}
                  {r.winners.filter((w) => !w.voided).length}位来宾
                </button>
              ))}
          </div>
        </section>
      )}
      {modal === "mobile" && (
        <Modal title="手机主持台" onClose={() => setModal("")}>
          <div className="host-qr">
            <img src={`/api${base}/host-qr`} width={240} height={240} alt="手机主持台二维码" />
            <a href={`/host/${id}`} target="_blank" rel="noreferrer">打开本场手机主持台</a>
            <p>用手机扫码并登录管理员账号。手机与大屏需访问同一个服务地址。</p>
          </div>
        </Modal>
      )}
      {modal === "rehearsal" && (
        <Modal title="独立彩排 · 不影响正式数据" onClose={() => setModal("")}>
          <Rehearsal activity={activity} onClose={() => setModal("")} />
        </Modal>
      )}
      {modal === "check" && (
        <Modal title="现场自检" onClose={() => setModal("")}>
          <StageCheck activityId={id} />
        </Modal>
      )}
    </div>
  );
}
