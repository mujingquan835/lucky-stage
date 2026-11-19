import { Participate, SelfStage } from "./SelfService";
import { CheckinPage } from "./CheckinPage";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import { api, ApiError, upload, download } from "./api";
import { Icon, GiftArt, Modal, Empty, date } from "./components";
import Stage from "./Stage";
import StageControl from "./StageControl";
import ActivitySettings, { type SettingsSection } from "./ActivitySettings";
import PersonPhotos from "./PersonPhotos";
import MobileHost from "./MobileHost";
import { drawModeLabels, type StageSelection } from "../../shared/stage";
import TestTools from "./TestTools";
import PrizeMachine, { PrizePool } from "./PrizeMachine";
import { REVEAL_MS } from "./reels";
import type {
  state,
  DrawInput,
  RoundReceipt,
  Person,
  Gift,
} from "../../server/domain";
type State = Awaited<ReturnType<typeof state>>;
type Tab = "overview" | "people" | "gifts" | "draw" | "records" | "settings";
const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: "overview", label: "活动概览", icon: "grid" },
  { key: "people", label: "参与名单", icon: "people" },
  { key: "gifts", label: "礼品管理", icon: "gift" },
  { key: "draw", label: "抽奖控制台", icon: "play" },
  { key: "records", label: "中奖记录", icon: "list" },
  { key: "settings", label: "活动设置", icon: "settings" },
];
export default function App() {
  if (location.pathname.startsWith("/participate/")) return <Participate id={location.pathname.split("/")[2]} />;
  if (location.pathname.startsWith("/checkin/")) return <CheckinPage id={location.pathname.split("/")[2]} />;
  return <AdminApp />;
}
function AdminApp() {
  const [user, setUser] = useState<string | null>(null),
    [checking, setChecking] = useState(true);
  useEffect(() => {
    api("/auth/me")
      .then((r) => setUser(r.username))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  if (checking)
    return <div className="loading">正在连接燃动双11抽奖工作台…</div>;
  if (!user) return <Login onLogin={setUser} />;
  if (location.pathname.startsWith("/host/"))
    return <MobileHost id={location.pathname.split("/")[2]} />;
  if (location.pathname.startsWith("/self-stage/")) return <SelfStage id={location.pathname.split("/")[2]} />;
  if (location.pathname.startsWith("/stage/"))
    return <Stage id={location.pathname.split("/")[2]} />;
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}
function Login({ onLogin }: { onLogin: (u: string) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api("/auth/login", "POST", {
        username: f.get("username"),
        password: f.get("password"),
      });
      onLogin(r.username);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-story campaign-login-story">
        <div className="campaign-login-top">
          <span>2026 购房节</span>
          <b>活动抽奖工作台</b>
        </div>
        <img
          className="campaign-login-kv"
          src="/campaign/double11-kv.jpg"
          alt="58同城 安居客 2026燃动双11活动主视觉"
        />
        <div className="campaign-login-caption">
          <h1>燃动好礼，幸运开场。</h1>
          <p>准备来宾名单，开启双11专属幸运时刻。</p>
        </div>
      </div>
      <div className="login-form">
        <span className="muted">欢迎回来</span>
        <h2>登录活动工作台</h2>
        <p>准备好下一场令人期待的相聚。</p>
        <form onSubmit={submit}>
          <label>
            管理员账号
            <input
              name="username"
              autoComplete="username"
              defaultValue="admin"
              required
            />
          </label>
          <label>
            登录密码
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? "正在登录…" : "登录工作台"}
            <Icon name="arrow" />
          </button>
        </form>
        <small>
          <Icon name="shield" size={15} /> 名单与抽奖记录仅管理员可访问
        </small>
      </div>
    </div>
  );
}
function Dashboard({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [activities, setActivities] = useState<any[]>([]),
    [id, setId] = useState(localStorage.getItem("lottery-activity") ?? ""),
    [s, setS] = useState<State | null>(null),
    [tab, setTab] = useState<Tab>("overview"),
    [initialDrawMode, setInitialDrawMode] = useState<StageSelection["mode"]>(() => {
      const saved = localStorage.getItem("lottery-draw-mode");
      return saved === "batch" || saved === "single" ? saved : "single";
    }),
    [online, setOnline] = useState(() => navigator.onLine !== false),
    [settingsSection, setSettingsSection] = useState<SettingsSection>("basics"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<string | null>(null),
    [editing, setEditing] = useState<any>(null),
    [giftLibrary, setGiftLibrary] = useState<{name: string; image: string}[]>([]),
    [search, setSearch] = useState(""),
    [peopleStore, setPeopleStore] = useState(""),
    [peopleSalesperson, setPeopleSalesperson] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [clearPending, setClearPending] = useState<{requestId:string; peopleVersion:string; count:number; activityName:string} | null>(null),
    [clearConfirmation, setClearConfirmation] = useState(""),
    [claimPending, setClaimPending] = useState<any>(null);
  const [mode, setMode] = useState<"single" | "batch">("single"),
    [personId, setPersonId] = useState(""),
    [giftId, setGiftId] = useState(""),
    [count, setCount] = useState(1),
    [result, setResult] = useState<RoundReceipt | null>(null),
    [drawing, setDrawing] = useState(false),
    [rollingOutcome, setRollingOutcome] = useState<RoundReceipt | null>(null),
    [pending, setPending] = useState<DrawInput | null>(null);
  const pendingRef = useRef<DrawInput | null>(null);
  const claimLock = useRef(false);
  const currentId = useRef(id);
  const loadGeneration = useRef(0);
  const selectActivity = (value: string) => {
    if (drawing || pendingRef.current || busy || claimPending || clearPending || preview) return;
    currentId.current = value;
    loadGeneration.current++;
    setS(null);
    setDrawing(false);
    setPreview(null);
    setModal(null);
    setError("");
    setTab("overview");
    setSettingsSection("basics");
    setId(value);
  };
  const closeModal = () => {
    if (busy) return;
    setModal(null);
    setError("");
  };
  const switchDrawMode = (nextMode: StageSelection["mode"], goToDraw = false) => {
    if (drawing || pendingRef.current) {
      setError("正在开奖，揭晓后可切换模式");
      return;
    }
    setInitialDrawMode(nextMode);
    localStorage.setItem("lottery-draw-mode", nextMode);
    if (goToDraw && s && !s.archived && tab !== "draw") {
      setTab("draw");
      setSearch("");
      setError("");
    }
  };
  useEffect(() => {
    const up = () => setOnline(true),
      down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const loadList = useCallback(async () => {
    const list = await api<any[]>("/activities");
    setOnline(true);
    setActivities(list);
    return list;
  }, []);
  const load = useCallback(async () => {
    if (currentId.current !== id) return;
    if (!id) {
      setS(null);
      return;
    }
    if (currentId.current !== id) return;
    const generation = ++loadGeneration.current;
    const loaded = await api<State>("/activities/" + id);
    if (currentId.current === id && generation === loadGeneration.current) {
      setOnline(true);
      setS(loaded);
      const phase = (loaded as any).stageSession?.phase;
      setDrawing(phase === "rolling" || phase === "decelerating");
    }
  }, [id]);
  useEffect(() => {
    loadList()
      .then((list) => {
        if (!list.some((a) => a.id === id)) selectActivity(list[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, [loadList]);
  useEffect(() => {
    setS(null);
    setPeopleStore("");
    setPeopleSalesperson("");
    try { setPreview(JSON.parse(sessionStorage.getItem("import-pending-" + id) ?? "null")); }
    catch { setPreview(null); }
    try {
      const pendingClear = JSON.parse(sessionStorage.getItem("clear-people-pending-" + id) ?? "null");
      setClearPending(pendingClear);
      setClearConfirmation("");
      if (pendingClear) setModal("clear-people");
    } catch { setClearPending(null); }
    setResult(null);
    setPersonId("");
    setGiftId("");
    setSearch("");
    try {
      setClaimPending(
        JSON.parse(sessionStorage.getItem("claim-pending-" + id) ?? "null"),
      );
    } catch {
      setClaimPending(null);
    }
    if (id) localStorage.setItem("lottery-activity", id);
    let p = null;
    try {
      p = JSON.parse(sessionStorage.getItem("pending-" + id) ?? "null");
    } catch {}
    setPending(p);
    pendingRef.current = p;
    load().catch((e) => setError(e.message));
  }, [id, load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const refresh = async () => {
    await load();
    await loadList();
  };
  async function perform(action: () => Promise<void>, success = "已保存") {
    const opId = id;
    if (currentId.current !== opId) return;
    if (drawing || pendingRef.current) {
      setError("请先完成或恢复本轮抽奖");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      if (currentId.current === opId) {
        setModal(null);
        if (success) setNotice(success);
      }
    } catch (e) {
      if (currentId.current === opId) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const path = "/activities/" + id;
  const changeTab = (t: Tab) => {
    if (
      (drawing || pendingRef.current) &&
      tab === "draw" &&
      t !== tab &&
      !confirm(
        "本轮仍在进行。离开主持台后，已保存结果会在30秒内自动揭晓。确认离开？",
      )
    )
      return;
    setTab(t);
    setSearch("");
    setError("");
    if (t === "settings")
      void load().catch((error: Error) => setError(error.message));
  };
  async function newActivity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (drawing || pendingRef.current) return;
    const f = new FormData(e.currentTarget);
    await perform(async () => {
      const a = await api("/activities", "POST", { name: f.get("name") });
      selectActivity(a.id);
      await loadList();
    }, "活动已创建");
  }
  async function drawNow(retry = false) {
    if (drawing || (pendingRef.current && !retry)) return;
    const input = retry
      ? pendingRef.current!
      : {
          requestId: crypto.randomUUID(),
          mode,
          ...(mode === "single" ? { personId } : { giftId, count }),
        };
    if (!input) return;
    const drawActivity = id;
    pendingRef.current = input;
    setPending(input);
    sessionStorage.setItem("pending-" + drawActivity, JSON.stringify(input));
    setDrawing(true);
    setRollingOutcome(null);
    setError("");
    setResult(null);
    try {
      let r: RoundReceipt;
      if (retry) {
        try {
          r = await api(`${path}/requests/${input.requestId}`);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404) throw e;
          r = await api(`${path}/draw`, "POST", input);
        }
      } else r = await api(`${path}/draw`, "POST", input);
      setRollingOutcome(r);
      await new Promise((r) => setTimeout(r, REVEAL_MS));
      setResult(r);
      pendingRef.current = null;
      setPending(null);
      sessionStorage.removeItem("pending-" + drawActivity);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401
      ) {
        pendingRef.current = null;
        setPending(null);
        sessionStorage.removeItem("pending-" + drawActivity);
      }
    } finally {
      setDrawing(false);
    }
  }
  async function claim(w?: any) {
    const opId = id;
    if (claimLock.current || busy || drawing || pendingRef.current) return;
    let input = claimPending;
    if (!input) {
      if (!w) return;
      const reason = w.claimed
        ? prompt("撤销领取核销，请填写原因")
        : "领取确认";
      if (reason === null) return;
      if (!reason?.trim()) {
        setError("撤销核销必须填写原因");
        return;
      }
      claimLock.current = true;
      setBusy(true);
      try {
        const stage = await api(path + "/stage");
        input = {
          wid: w.id,
          body: {
            requestId: crypto.randomUUID(),
            expectedVersion: stage.session.version,
            claimed: !w.claimed,
            reason,
          },
        };
      } catch (e) {
        if (currentId.current === opId) setError((e as Error).message);
        claimLock.current = false;
        setBusy(false);
        return;
      }
      sessionStorage.setItem("claim-pending-" + opId, JSON.stringify(input));
      if (currentId.current === opId) setClaimPending(input);
    }
    claimLock.current = true;
    setBusy(true);
    setError("");
    try {
      await api(path + "/winners/" + input.wid + "/claim", "POST", input.body);
      sessionStorage.removeItem("claim-pending-" + opId);
      if (currentId.current === opId) {
        setClaimPending(null);
        await refresh();
        setNotice(input.body.claimed ? "已确认领取" : "已撤销领取核销");
      }
    } catch (e) {
      if (currentId.current === opId) setError((e as Error).message);
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 401
      ) {
        sessionStorage.removeItem("claim-pending-" + opId);
        if (currentId.current === opId) setClaimPending(null);
      }
    } finally {
      claimLock.current = false;
      setBusy(false);
    }
  }
  async function giftSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await perform(async () => {
      let image = editing?.image ?? "";
      const file = f.get("image") as File;
      if (file?.size) image = await upload(file);
      else if (editing?.libraryImage) {
        const response = await fetch(editing.libraryImage);
        if (!response.ok) throw new Error("礼品库图片读取失败，请重试");
        image = await upload(new File([await response.blob()], "gift.webp", { type: "image/webp" }));
      }
      await api(path + "/gifts", "POST", {
        ...(editing?.id ? { id: editing.id } : {}),
        name: f.get("name"),
        total: Number(f.get("total")),
        batchLimit: f.get("batchLimit") === "" ? null : Number(f.get("batchLimit")),
        image,
        singleEnabled: f.get("singleEnabled") === "on",
        enabled: f.get("enabled") === "on",
      });
    }, "礼品已保存");
  }
  async function personSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      person = Object.fromEntries(
        ["name", "phone", "store", "salesperson", "department"].map((k) => [k, f.get(k)]),
      );
    Object.assign(person, { drawChances: Number(f.get("drawChances")) });
    await perform(async () => {
      if (editing?.id)
        await api(path + "/people/" + editing.id, "PATCH", person);
      else await api(path + "/people", "POST", { rows: [person] });
    }, "名单已保存");
  }
  const stores = [...new Set((s?.people ?? []).map(p => p.store).filter(Boolean))].sort((a,b) => a.localeCompare(b, "zh-CN"));
  const salespeople = [...new Set((s?.people ?? []).map(p => p.salesperson ?? "").filter(Boolean))].sort((a,b) => a.localeCompare(b, "zh-CN"));
  const hasPeopleFilter = !!(search || peopleStore || peopleSalesperson);
  const people = s?.people.filter((p) =>
    [p.name, p.phone, p.store, p.salesperson].join(" ").includes(search) &&
    (!peopleStore || p.store === peopleStore) &&
    (!peopleSalesperson || p.salesperson === peopleSalesperson),
  ) ?? [];
  const allWinners =
    s?.rounds.flatMap((r) =>
      r.winners.map((w) => ({ ...w, createdAt: r.createdAt, mode: r.mode })),
    ) ?? [];
  const winners = allWinners.filter((w) =>
    [w.personName, w.store, w.giftName, w.phone]
      .join(" ")
      .includes(search),
  );
  const openStage = () => window.open("/stage/" + id, "lottery-stage");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Icon name="spark" size={24} />
          </span>
          <span>
            燃动双11<small>活动抽奖工作台</small>
          </span>
        </a>
        <div className="sidebar-label">工作空间</div>
        <nav>
          {tabs.map((t) => (
            <button
              key={t.key}
              aria-label={t.label}
              className={tab === t.key ? "active" : ""}
              onClick={() => changeTab(t.key)}
            >
              <Icon name={t.icon} />
              {t.label}
              {t.key === "people" && s && (
                <span className="nav-count">{s.people.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="tip-card">
            <Icon name="screen" size={23} />
            <b>把惊喜搬上大屏</b>
            <p>全屏展示每一个幸运时刻</p>
            <button disabled={!id} onClick={openStage}>
              打开现场大屏 <Icon name="arrow" size={16} />
            </button>
          </div>
          <button
            className="profile"
            onClick={() =>
              perform(async () => {
                await api("/auth/logout", "POST", {});
                onLogout();
              }, "")
            }
          >
            <span className="avatar">管</span>
            <span>
              活动管理员<small>{user}</small>
            </span>
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="topbar-left">
            <div className="breadcrumb">
              工作空间 <span>/</span>{" "}
              <b>{tabs.find((t) => t.key === tab)?.label}</b>
            </div>
            <div
              className="mode-switcher"
              role="group"
              aria-label="抽奖模式切换"
              data-testid="topbar-mode-switcher"
            >
              {(["batch", "single"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={initialDrawMode === m ? "active" : ""}
                  disabled={drawing || !!pending}
                  title={
                    drawing || !!pending
                      ? "正在开奖，揭晓后可切换模式"
                      : drawModeLabels[m].description
                  }
                  aria-pressed={initialDrawMode === m}
                  onClick={() => switchDrawMode(m, true)}
                >
                  <Icon name={m === "batch" ? "people" : "gift"} size={14} />
                  <span>{drawModeLabels[m].title}</span>
                  <em className="mode-tooltip" role="tooltip">
                    {drawModeLabels[m].scene}
                  </em>
                </button>
              ))}
            </div>
          </div>
          <div className="topbar-actions">
            <span className={"online" + (online ? "" : " offline")}>
              <i />
              {online ? "已连接" : "连接断开"}
            </span>
            <select
              aria-label="当前活动"
              value={id}
              disabled={drawing || !!pending || busy || !!claimPending || !!clearPending || !!preview}
              onChange={(e) => selectActivity(e.target.value)}
            >
              <option value="" disabled>
                选择活动
              </option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.testMode ? "【测试】" : ""}
                  {a.name}
                  {a.archived ? "（已归档）" : ""}
                </option>
              ))}
            </select>
            <button
              className="button small"
              disabled={drawing || !!pending || busy}
              onClick={() =>
                perform(async () => {
                  const a = await api("/testing/activities", "POST", {});
                  selectActivity(a.id);
                }, "已进入独立测试活动，请一键准备测试数据")
              }
            >
              新建测试活动
            </button>
            <button
              className="icon-button"
              aria-label="创建新活动"
              disabled={drawing || !!pending || busy}
              onClick={() => setModal("activity")}
            >
              <Icon name="plus" />
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="heading-context">
                {s?.archived
                  ? "已归档活动"
                  : s
                    ? "活动筹备与现场管理"
                    : "开始你的第一场活动"}
              </div>
              <h1>{tabs.find((t) => t.key === tab)?.label}</h1>
              <p>
                {
                  {
                    overview: "把准备留在这里，把惊喜留给现场。",
                    people: "提前整理好每一位来宾，让幸运不遗漏任何人。",
                    gifts: "每一份心意，都值得认真准备。",
                    draw: "选择抽奖方式，开启下一个幸运时刻。",
                    records: "每一份幸运，都有记录可循。",
                    settings: "为这场相聚，设置专属的模样。",
                  }[tab]
                }
              </p>
            </div>
            <div className="heading-buttons">
              {id && (
                <button className="button" onClick={openStage}>
                  <Icon name="screen" size={18} />
                  现场大屏
                </button>
              )}
              {tab === "overview" && (
                <button
                  className="button primary"
                  disabled={drawing || !!pending || busy}
                  onClick={() => setModal("activity")}
                >
                  <Icon name="plus" size={18} />
                  新建活动
                </button>
              )}
              {tab === "people" && s && !s.archived && (
                <button
                  className="button primary"
                  onClick={() => {
                    setEditing(null);
                    setModal("person");
                  }}
                >
                  <Icon name="plus" size={18} />
                  添加参与者
                </button>
              )}
              {tab === "gifts" && s && !s.archived && (
                <button className="button" onClick={async () => {
                  try { setGiftLibrary(await api("/gift-library")); setModal("gift-library"); }
                  catch (e) { setError((e as Error).message); }
                }}>从礼品库选择</button>
              )}
              {tab === "gifts" && s && !s.archived && (
                <button
                  className="button primary"
                  onClick={() => {
                    setEditing(null);
                    setModal("gift");
                  }}
                >
                  <Icon name="plus" size={18} />
                  添加礼品
                </button>
              )}
            </div>
          </div>
          {error && !modal && !preview && (
            <div className="error global-error" role="alert">
              <span>{error}</span>
              <button aria-label="关闭提示" onClick={() => setError("")}>
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Icon name="check" size={18} />
              {notice}
            </div>
          )}
          {!s ? (
            <Empty
              title={id ? "正在加载活动…" : "让下一场活动，从这里开始"}
              description="创建活动后，即可录入名单、设置礼品并开启抽奖。"
            >
              <div className="empty-actions">
                <button
                  className="button primary"
                  disabled={drawing || !!pending || busy}
                  onClick={() => setModal("activity")}
                >
                  创建活动
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      const a = await api("/demo", "POST", {});
                      selectActivity(a.id);
                    }, "已创建示例活动，可随时新建正式活动")
                  }
                >
                  体验示例活动
                </button>
              </div>
            </Empty>
          ) : (
            <>
              {s.testMode && (
                <TestTools
                  key={s.id}
                  activity={s}
                  refresh={refresh}
                  disabled={drawing || !!pending || busy || s.archived}
                />
              )}
              {s.archived && (
                <div className="banner">
                  此活动已归档，仅可查看与导出。
                  <button
                    onClick={() => {
                      setEditing({ name: s.name + " · 新活动" });
                      setModal("copy");
                    }}
                  >
                    复制配置，开展新活动
                  </button>
                </div>
              )}
              {tab === "overview" && (
                <>
                  <section
                    className="event-hero"
                    style={{ "--event-color": s.color } as any}
                  >
                    <div className="hero-copy">
                      <span className="campaign-partners">
                        58同城 × 安居客 · 2026 购房节
                      </span>
                      <div className="campaign-lockup">
                        燃动<span>双11</span>
                      </div>
                      <span className="event-status">
                        <i />
                        {s.archived
                          ? "活动已归档"
                          : s.rounds.length
                            ? "活动进行中"
                            : "准备就绪，期待开场"}
                      </span>
                      <h2>{s.name}</h2>
                      <p>{s.subtitle}</p>
                      <button
                        className="button hero-button"
                        disabled={s.archived}
                        onClick={() => changeTab("draw")}
                      >
                        进入抽奖控制台
                        <Icon name="arrow" size={18} />
                      </button>
                    </div>
                    <div className="campaign-poster">
                      <img
                        src="/campaign/double11-kv.jpg"
                        alt="燃动双11主视觉"
                      />
                      <span>好礼不断 · 幸运翻倍</span>
                    </div>
                    <span className="hero-orbit orbit-one" />
                    <span className="hero-orbit orbit-two" />
                  </section>
                  <section className="draw-mode-links" aria-label="抽奖方式">
                    {(["batch", "single"] as const).map(mode => (
                      <button className="panel draw-mode-link" key={mode} disabled={s.archived || drawing || !!pending}
                        onClick={() => switchDrawMode(mode, true)}>
                        <Icon name={mode === "single" ? "gift" : "people"} size={22} />
                        <span><b>{drawModeLabels[mode].title}</b><small>{drawModeLabels[mode].description}</small></span>
                        <Icon name="arrow" size={16} />
                      </button>
                    ))}
                  </section>
                  <section className="stats">
                    {[
                      {
                        label: "参与来宾",
                        value: s.summary.peopleCount,
                        unit: "人",
                        icon: "people",
                        note: "已录入活动名单",
                      },
                      {
                        label: "待抽来宾",
                        value: s.summary.eligibleCount,
                        unit: "人",
                        icon: "spark",
                        note: "按个人剩余抽奖机会参与",
                      },
                      {
                        label: "剩余礼品",
                        value: s.summary.remainingCount,
                        unit: "份",
                        icon: "gift",
                        note: `共 ${s.gifts.length} 种礼品`,
                      },
                      {
                        label: "已送出幸运",
                        value: s.summary.winnerCount,
                        unit: "份",
                        icon: "check",
                        note: `已完成 ${s.rounds.length} 轮抽奖`,
                      },
                    ].map((v) => (
                      <div className="stat" key={v.label}>
                        <div className="stat-title">
                          {v.label}
                          <Icon name={v.icon} />
                        </div>
                        <strong>
                          {v.value}
                          <small>{v.unit}</small>
                        </strong>
                        <p>{v.note}</p>
                      </div>
                    ))}
                  </section>
                  <div className="overview-columns">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>
                          本场礼品 <span>{s.gifts.length}</span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => changeTab("gifts")}
                        >
                          管理礼品
                          <Icon name="arrow" size={15} />
                        </button>
                      </div>
                      {!s.gifts.length ? (
                        <Empty
                          title="还没有准备礼品"
                          description="添加礼品名称、图片和数量，即可开启抽奖。"
                        >
                          <button
                            className="button"
                            onClick={() => changeTab("gifts")}
                          >
                            准备礼品
                          </button>
                        </Empty>
                      ) : (
                        <div className="gift-preview">
                          {s.gifts.slice(0, 3).map((g, i) => (
                            <article key={g.id}>
                              <GiftArt
                                index={i}
                                image={g.image}
                                name={g.name}
                              />
                              <h3>{g.name}</h3>
                              <p>
                                剩余 <b>{g.remaining}</b>
                                <span> / {g.total} 份</span>
                              </p>
                              <div className="stock-track">
                                <i
                                  style={{
                                    width:
                                      Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          g.total
                                            ? (g.remaining / g.total) * 100
                                            : 0,
                                        ),
                                      ) + "%",
                                  }}
                                />
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                    <section className="panel prep-panel">
                      <div className="section-heading">
                        <h2>开场准备</h2>
                        <Icon name="spark" size={19} />
                      </div>
                      {[
                        {
                          title: "录入参与名单",
                          desc: s.people.length
                            ? `已准备 ${s.people.length} 位来宾`
                            : "支持 Excel 批量导入",
                          done: !!s.people.length,
                          tab: "people",
                        },
                        {
                          title: "准备活动礼品",
                          desc: s.gifts.length
                            ? `已准备 ${s.gifts.length} 种礼品`
                            : "上传图片并设置数量",
                          done: !!s.gifts.length,
                          tab: "gifts",
                        },
                        {
                          title: "检查现场大屏",
                          desc: "全屏投放，迎接幸运时刻",
                          done: false,
                          tab: "stage",
                        },
                      ].map((v, i) => (
                        <button
                          className="prep-item"
                          key={v.title}
                          onClick={() =>
                            v.tab === "stage"
                              ? openStage()
                              : changeTab(v.tab as Tab)
                          }
                        >
                          <span className={v.done ? "step done" : "step"}>
                            {v.done ? <Icon name="check" size={15} /> : i + 1}
                          </span>
                          <span>
                            <b>{v.title}</b>
                            <small>{v.desc}</small>
                          </span>
                          <Icon name="arrow" size={16} />
                        </button>
                      ))}
                      <div className="privacy-note">
                        <Icon name="shield" size={17} />
                        现场大屏默认隐藏联系电话
                      </div>
                    </section>
                  </div>
                  <section className="panel recent">
                    <div className="section-heading">
                      <h2>最近的幸运时刻</h2>
                      <button
                        className="text-button"
                        onClick={() => changeTab("records")}
                      >
                        全部记录
                        <Icon name="arrow" size={15} />
                      </button>
                    </div>
                    {allWinners.length ? (
                      <WinnerTable rows={allWinners.slice(0, 5)} />
                    ) : (
                      <div className="recent-empty">
                        <Icon name="clock" size={20} />
                        <span>下一位幸运来宾，正在等待揭晓。</span>
                        <button
                          className="text-button"
                          onClick={() => changeTab("draw")}
                        >
                          开始第一轮抽奖
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}
              {tab === "people" && (
                <section className="panel">
                  <div className="table-toolbar">
                    <Search
                      value={search}
                      onChange={setSearch}
                      placeholder="搜索姓名、电话或门店"
                    />
                    <div>
                      <button
                        className="button small"
                        onClick={() =>
                          download("/template", "名单导入模板.xlsx").catch(
                            (e) => setError(e.message),
                          )
                        }
                      >
                        <Icon name="download" size={16} />
                        下载模板
                      </button>
                      <label
                        className={
                          "button small " + (s.archived ? "disabled" : "")
                        }
                      >
                        <Icon name="upload" size={16} />
                        导入 Excel
                        <input
                          type="file"
                          accept=".xlsx"
                          hidden
                          disabled={s.archived || busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            perform(async () => {
                              if (file.size > 5 * 1024 * 1024)
                                throw new Error("Excel 文件不能超过 5 MB");
                              const p = await api(
                                path + "/import-preview",
                                "POST",
                                new Blob([file], {
                                  type: "application/octet-stream",
                                }),
                              );
                              setPreview({ ...p, requestId: crypto.randomUUID() });
                            }, "预览已生成，请检查后确认导入");
                          }}
                        />
                      </label>
                      <button
                        className="button small"
                        onClick={() =>
                          download(
                            path + "/export/people",
                            "参与名单.xlsx",
                          ).catch((e) => setError(e.message))
                        }
                      >
                        导出名单
                      </button>
                      <button className="button small" disabled={s.archived || busy || !s.people.length}
                        onClick={() => setModal("person-photos")}>批量匹配照片</button>
                      {s.checkin?.enabled && (
                        <button
                          className="button small"
                          disabled={s.archived || busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              await api(path + "/checkin/sync", "POST", {});
                              await refresh();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          同步扫码名单
                        </button>
                      )}
                      <button
                        className="button small"
                        disabled={s.archived || busy || drawing || !!pending || !s.people.length}
                        onClick={() => {
                          setError("");
                          setClearConfirmation("");
                          setClearPending({requestId:crypto.randomUUID(),peopleVersion:s.peopleVersion,count:s.people.length,activityName:s.name});
                          setModal("clear-people");
                        }}
                      >一键清空名单</button>
                    </div>
                  </div>
                  <div className="people-filters">
                    <label>门店
                      <select aria-label="按门店筛选" value={peopleStore} onChange={e => setPeopleStore(e.target.value)}>
                        <option value="">全部门店</option>
                        {stores.map(store => <option key={store} value={store}>{store}</option>)}
                      </select>
                    </label>
                    <label>对应销售
                      <select aria-label="按对应销售筛选" value={peopleSalesperson} onChange={e => setPeopleSalesperson(e.target.value)}>
                        <option value="">全部销售</option>
                        {salespeople.map(person => <option key={person} value={person}>{person}</option>)}
                      </select>
                    </label>
                    {hasPeopleFilter && <button type="button" className="text-button" onClick={() => { setSearch(""); setPeopleStore(""); setPeopleSalesperson(""); }}>清除筛选</button>}
                  </div>
                  <div className="people-stats" aria-label="参与名单统计">
                    <span>名单人数 <strong>{s.summary.peopleStats.totalPeople}</strong></span>
                    <span>已抽奖人数 <strong>{s.summary.peopleStats.drawnPeople}</strong></span>
                    <span>总抽奖机会 <strong>{s.summary.peopleStats.totalChances}</strong></span>
                    <span>剩余可用机会 <strong>{s.summary.peopleStats.remainingChances}</strong></span>
                  </div>
                  <div className="table-meta">
                    {hasPeopleFilter ? `当前筛选找到 ${people.length} 位` : "以上为本活动全部名单统计"}
                    <span>总机会含停用人员；剩余可用机会仅计启用人员</span>
                  </div>
                  {people.length ? (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>姓名</th>
                            
                            <th>联系电话</th>
                            <th>门店名称</th><th>对应销售</th><th>抽奖机会</th>
                            <th>状态 / 到场</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {people.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <span className="person-cell">
                                  <span className="person-avatar">
                                    {p.name.slice(-2)}
                                  </span>
                                  <b>{p.name}</b>
                                </span>
                                {p.extra && Object.keys(p.extra).length > 0 && (
                                  <small style={{ display: "block", color: "#7d625f", marginTop: 2 }}>
                                    {Object.entries(p.extra)
                                      .map(([k, v]) => `${k}: ${v}`)
                                      .join(" · ")}
                                  </small>
                                )}
                              </td>
                              
                              <td className="phone-cell">{p.phone}</td>
                              <td>{p.store || "—"}</td><td>{p.salesperson || "—"}</td><td>{p.remainingChances ? `剩余 ${p.remainingChances} / ${p.drawChances} 次` : "已抽完奖"}</td>
                              <td>
                                <span
                                  className={
                                    "badge " +
                                    (!p.enabled
                                      ? "neutral"
                                      : (p.remainingChances === 0)
                                        ? "gold"
                                        : "green")
                                  }
                                >
                                  {!p.enabled
                                    ? "已停用"
                                    : (p.remainingChances === 0)
                                      ? "已抽完奖"
                                      : "待抽奖"}
                                </span>
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    disabled={s.archived || busy || drawing}
                                    onClick={() =>
                                      perform(
                                        async () => {
                                          await api(
                                            path + "/people/" + p.id,
                                            "PATCH",
                                            { checkedIn: !p.checkedIn },
                                          );
                                        },
                                        p.checkedIn
                                          ? "已撤销到场"
                                          : "已标记到场",
                                      )
                                    }
                                  >
                                    {p.checkedIn ? "已到场 · 撤销" : "标记到场"}
                                  </button>
                                  <button
                                    disabled={s.archived || busy}
                                    onClick={() => {
                                      setEditing(p);
                                      setModal("person");
                                    }}
                                  >
                                    编辑
                                  </button>
                                  <button
                                    disabled={s.archived || busy}
                                    onClick={() =>
                                      perform(async () => {
                                        await api(
                                          path + "/people/" + p.id,
                                          "PATCH",
                                          { enabled: !p.enabled },
                                        );
                                      })
                                    }
                                  >
                                    {p.enabled ? "停用" : "启用"}
                                  </button>
                                  <button
                                    disabled={s.archived || busy}
                                    onClick={() => {
                                      if (confirm(`删除参与者 ${p.name}？`))
                                        perform(async () => {
                                          await api(
                                            path + "/people/" + p.id,
                                            "DELETE",
                                          );
                                        }, "参与者已删除");
                                    }}
                                  >
                                    删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      title={hasPeopleFilter ? "没有找到匹配的来宾" : "先把来宾请进名单"}
                      description={hasPeopleFilter ? "可调整筛选条件或清除筛选。" : "下载模板填写后导入，或手动添加参与者。"}
                    />
                  )}
                </section>
              )}
              {tab === "gifts" && (
                <>
                  <div className="info-line">
                    <Icon name="gift" size={18} />共 {s.gifts.length}{" "}
                    种礼品，剩余 {s.summary.remainingCount} 份
                    <span>单人抽奖按剩余份数分配概率</span>
                  </div>
                  {s.gifts.length ? (
                    <div className="gift-grid">
                      {s.gifts.map((g, i) => (
                        <article
                          className={
                            "gift-card " + (!g.enabled ? "inactive" : "")
                          }
                          key={g.id}
                        >
                          <GiftArt image={g.image} index={i} name={g.name} />
                          <div className="gift-card-body">
                            <div className="gift-title">
                              <h2>{g.name}</h2>
                              <span
                                className={
                                  "badge " + (g.enabled ? "green" : "neutral")
                                }
                              >
                                {g.enabled ? "启用中" : "已停用"}
                              </span>
                            </div>
                            <div className="gift-stock">
                              <span>剩余数量</span>
                              <strong>
                                {g.remaining}
                                <small> / {g.total} 份</small>
                              </strong>
                            </div>
                            <div className="stock-track">
                              <i
                                style={{
                                  width: (g.remaining / g.total) * 100 + "%",
                                }}
                              />
                            </div>
                            <p className="muted">
                              {g.singleEnabled
                                ? "参与单人随机抽奖"
                                : "仅用于批量抽奖"}
                            </p>
                            {g.batchLimit && <p className="muted">单批最多抽取 {g.batchLimit} 人</p>}
                            <div className="gift-actions">
                              <button
                                className="button small"
                                disabled={s.archived || busy}
                                onClick={() => {
                                  setEditing(g);
                                  setModal("gift");
                                }}
                              >
                                <Icon name="edit" size={15} />
                                编辑礼品
                              </button>
                              <button
                                className="button small"
                                disabled={s.archived || busy || drawing}
                                onClick={() => {
                                  const value = prompt(
                                    `为 ${g.name} 临时增加多少份？`,
                                    "1",
                                  );
                                  if (value === null) return;
                                  const amount = Number(value);
                                  if (
                                    !Number.isSafeInteger(amount) ||
                                    amount < 1
                                  ) {
                                    setError("请输入大于0的整数");
                                    return;
                                  }
                                  void perform(async () => {
                                    await api(
                                      path + "/gifts/" + g.id + "/increase",
                                      "POST",
                                      { amount },
                                    );
                                  }, "礼品数量已增加");
                                }}
                              >
                                增加数量
                              </button>
                              <button
                                className="text-button"
                                disabled={s.archived || busy || i === 0}
                                onClick={() =>
                                  perform(async () => {
                                    await api(path + "/gifts", "POST", {
                                      ...g,
                                      position: i - 1,
                                    });
                                  })
                                }
                              >
                                前移
                              </button>
                              <button
                                className="text-button"
                                disabled={s.archived || busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      `删除礼品 ${g.name}？已有抽奖记录时不能删除。`,
                                    )
                                  )
                                    perform(async () => {
                                      await api(
                                        path + "/gifts/" + g.id,
                                        "DELETE",
                                      );
                                    }, "礼品已删除");
                                }}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="准备第一份惊喜"
                      description="添加礼品后，来宾就有机会把它带回家。"
                    >
                      <button
                        className="button primary"
                        onClick={() => {
                          setEditing(null);
                          setModal("gift");
                        }}
                      >
                        添加礼品
                      </button>
                    </Empty>
                  )}
                </>
              )}
              {tab === "draw" && (
                <>
                  {pending && (
                    <div className="error">
                      有一轮旧版抽奖请求待恢复。
                      <button
                        className="button small"
                        disabled={drawing}
                        onClick={() => drawNow(true)}
                      >
                        查询并恢复本轮结果
                      </button>
                    </div>
                  )}
                  <StageControl
                    key={s.id}
                    activity={s}
                    refresh={refresh}
                    onActiveChange={setDrawing}
                    initialMode={initialDrawMode}
                    onModeChange={(next) => switchDrawMode(next, false)}
                    onOpenRounds={() => { setSettingsSection("rounds"); changeTab("settings"); }}
                  />
                </>
              )}
              {tab === "records" && (
                <section className="panel">
                  <div className="table-toolbar">
                    <Search
                      value={search}
                      onChange={setSearch}
                      placeholder="搜索中奖人、门店或礼品"
                    />
                    <button
                      className="button small"
                      onClick={() =>
                        download(
                          path + "/export/winners",
                          "中奖明细.xlsx",
                        ).catch((e) => setError(e.message))
                      }
                    >
                      <Icon name="download" size={16} />
                      导出中奖记录
                    </button>
                  </div>
                  <div className="table-meta">
                    有效中奖 {s.summary.winnerCount} 份 · 共 {s.rounds.length}{" "}
                    轮<span>作废后释放库存，原记录始终保留</span>
                  </div>
                  {claimPending && (
                    <div className="error">
                      有一条领取操作尚未确认。
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => claim()}
                      >
                        恢复领取操作
                      </button>
                    </div>
                  )}
                  {winners.length ? (
                    <WinnerTable
                      rows={winners}
                      onClaim={s.archived ? undefined : (w) => claim(w)}
                      claimBusy={busy || drawing || !!claimPending}
                      onVoid={
                        s.archived
                          ? undefined
                          : (w) => {
                              setEditing(w);
                              setModal("void");
                            }
                      }
                    />
                  ) : (
                    <Empty
                      title="暂时没有中奖记录"
                      description="完成抽奖后，每一位幸运来宾都会记录在这里。"
                    />
                  )}
                </section>
              )}
              {tab === "settings" && (
                <ActivitySettings key={s.id} activity={s} section={settingsSection}
                  setSection={setSettingsSection} refresh={refresh}
                  openHost={() => { setInitialDrawMode("batch"); changeTab("draw"); }}
                  management={<>
                  <div className="settings-actions">
                    <div>
                      <h3>开展下一场活动</h3>
                      <p>复制背景、礼品和规则，名单和中奖记录从零开始。</p>
                    </div>
                    <button
                      className="button"
                      onClick={() => {
                        setEditing({ name: s.name + " · 新活动" });
                        setModal("copy");
                      }}
                    >
                      <Icon name="copy" size={16} />
                      复制配置
                    </button>
                  </div>
                  {!s.archived && (
                    <div className="settings-actions danger-zone">
                      <div>
                        <h3>归档本场活动</h3>
                        <p>归档后只可查看和导出，历史记录完整保留。</p>
                      </div>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "归档后无法再修改或抽奖。确定归档本场活动？",
                            )
                          )
                            perform(async () => {
                              await api(path, "PATCH", { archived: true });
                            }, "活动已归档");
                        }}
                      >
                        归档活动
                      </button>
                    </div>
                  )}
                  <div className="settings-actions danger-zone">
                    <div><h3>删除本场活动</h3><p>永久删除活动、名单和中奖记录，无法恢复。</p></div>
                    <button className="button danger" disabled={busy || drawing || !!pending} onClick={() => {
                      if (prompt(`将永久删除活动“${s.name}”及其名单、中奖记录。请输入“确认”删除：`)?.trim() !== "确认") return;
                      void (async () => { setBusy(true); setError(""); try {
                        await api(path, "DELETE");
                        const list = await loadList();
                        selectActivity(list[0]?.id ?? "");
                        setNotice("活动已删除");
                      } catch (e) { setError((e as Error).message); } finally { setBusy(false); } })();
                    }}>删除活动</button>
                  </div>
                  <details className="audit">
                    <summary>操作日志（{s.logs.length} 条）</summary>
                    {s.logs
                      .slice()
                      .reverse()
                      .map((l) => (
                        <div key={l.id}>
                          <span>{date(l.at)}</span>
                          <b>{l.action}</b>
                          <small>
                            {l.actor} · {l.detail}
                          </small>
                        </div>
                      ))}
                  </details>
                  </>}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>燃动双11 · 好礼不断，幸运相随</span>
            <span>名单与抽奖记录安全保存</span>
          </footer>
        </main>
      </div>
      {modal === "person-photos" && s && (
        <PersonPhotos path={path} people={s.people} refresh={refresh} onClose={() => setModal(null)} />
      )}
      {modal === "clear-people" && clearPending && (
        <Modal error={error} title="清空参与名单" onClose={() => {
          if (busy) return;
          if (sessionStorage.getItem("clear-people-pending-" + id)) { setError("本次清空结果尚未确认，请恢复同一次请求。"); return; }
          setModal(null);
          setClearPending(null);
        }}>
          <form onSubmit={e => {
            e.preventDefault();
            if (clearConfirmation !== "清空") { setError("请输入“清空”以确认"); return; }
            void perform(async () => {
              try { sessionStorage.setItem("clear-people-pending-" + id, JSON.stringify(clearPending)); }
              catch { throw new Error("无法保存恢复信息，请检查浏览器存储空间"); }
              try { await api(path + "/people/clear", "POST", {requestId:clearPending.requestId,peopleVersion:clearPending.peopleVersion}); }
              catch (e) {
                if (e instanceof ApiError && (e.status === 400 || e.status === 409)) sessionStorage.removeItem("clear-people-pending-" + id);
                throw e;
              }
              sessionStorage.removeItem("clear-people-pending-" + id);
              setClearPending(null);
            }, "参与名单已清空");
          }}>
            <p>将清空“{clearPending.activityName}”的全部 {clearPending.count} 人，包括筛选范围之外的人员，并使这些人的个人抽奖码失效。</p>
            <p>礼品和中奖记录不会删除。名单中存在有效中奖记录时，系统会拒绝清空。</p>
            <label>请输入“清空”确认<input value={clearConfirmation} onChange={e => setClearConfirmation(e.target.value)} autoComplete="off" /></label>
            <button className="button primary full" disabled={busy || clearConfirmation !== "清空"}>确认清空全部名单</button>
          </form>
        </Modal>
      )}
      {modal === "activity" && (
        <Modal
          error={error}
          title="创建新活动"
          onClose={closeModal}
        >
          <form onSubmit={newActivity}>
            <label>
              活动名称
              <input
                name="name"
                autoFocus
                placeholder="例如：年度客户答谢会"
                maxLength={80}
                required
              />
            </label>
            <p className="muted">每场活动独立管理名单、礼品和中奖记录。</p>
            <button className="button primary full" disabled={busy}>
              创建活动
            </button>
          </form>
        </Modal>
      )}
      {modal === "person" && (
        <Modal
          error={error}
          title={editing ? "编辑参与者" : "添加参与者"}
          onClose={closeModal}
        >
          <form onSubmit={personSubmit}>
            <div className="form-grid">
              <label>抽奖机会<input name="drawChances" type="number" min="1" max="10000" step="1" defaultValue={editing?.drawChances ?? 1} required /></label>
              {[
                { k: "name", label: "姓名", required: true },
                
                { k: "phone", label: "联系电话", required: true },
                { k: "department", label: "部门" },
                { k: "store", label: "门店名称" },
                { k: "salesperson", label: "对应销售" },
              ].map((v) => (
                <label key={v.k}>
                  {v.label}
                  {v.required ? " *" : ""}
                  <input
                    name={v.k}
                    defaultValue={editing?.[v.k] ?? ""}
                    required={v.required}
                    maxLength={v.k === "phone" ? 40 : 80}
                  />
                </label>
              ))}
            </div>
            <button className="button primary full" disabled={busy}>
              保存参与者
            </button>
          </form>
        </Modal>
      )}
      {modal === "gift-library" && (
        <Modal error={error} title="默认礼品库" onClose={() => setModal(null)}>
          <p className="muted">选择礼品后可为本场活动设置数量和抽奖规则。</p>
          <div className="gift-library-grid">
            {giftLibrary.map(g => <button type="button" className="gift-library-item" key={g.name} onClick={() => { setEditing({ name: g.name, libraryImage: g.image }); setModal("gift"); }}>
              <img src={g.image} alt="" /><span>{g.name}</span>
            </button>)}
          </div>
        </Modal>
      )}
      {modal === "gift" && (
        <Modal
          error={error}
          title={editing?.id ? "编辑礼品" : "添加礼品"}
          onClose={closeModal}
        >
          <form onSubmit={giftSubmit}>
            {editing?.libraryImage && <p className="muted">已选择礼品库图片，可上传新图片替换。</p>}
            <label>
              礼品名称
              <input
                name="name"
                defaultValue={editing?.name ?? ""}
                required
                maxLength={80}
              />
            </label>
            <label>
              礼品总数量
              <input
                name="total"
                type="number"
                min="1"
                max="100000"
                defaultValue={editing?.total ?? 1}
                required
              />
            </label>
            <label>
              单批最多抽取人数（选填）
              <input name="batchLimit" type="number" min="1" max="50" step="1" defaultValue={editing?.batchLimit ?? ""} placeholder="留空表示不限" />
              <small>限制每一批抽中此礼品的数量，不影响单人抽奖。</small>
            </label>
            <label className="upload-field">
              <Icon name="upload" />
              上传礼品图片
              <input
                name="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
              />
              <small>
                JPEG / PNG / WebP，最大 5 MB
                {editing?.image ? "；留空保留原图" : ""}
              </small>
            </label>
            <label className="check-label">
              <input
                name="singleEnabled"
                type="checkbox"
                defaultChecked={editing?.singleEnabled ?? true}
              />
              参与单人随机抽奖
            </label>
            <label className="check-label">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={editing?.enabled ?? true}
              />
              启用礼品
            </label>
            <button className="button primary full" disabled={busy}>
              {busy ? "正在保存…" : "保存礼品"}
            </button>
          </form>
        </Modal>
      )}
      {modal === "copy" && (
        <Modal
          error={error}
          title="复制配置，开启新活动"
          onClose={closeModal}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              perform(async () => {
                const a = await api(path + "/copy", "POST", {
                  name: f.get("name"),
                });
                selectActivity(a.id);
              }, "新活动已创建");
            }}
          >
            <label>
              新活动名称
              <input
                name="name"
                defaultValue={editing?.name}
                required
                maxLength={80}
              />
            </label>
            <p className="muted">
              复制礼品总数量和活动设置，不复制名单、中奖记录及归档状态。
            </p>
            <button className="button primary full" disabled={busy}>
              创建新活动
            </button>
          </form>
        </Modal>
      )}
      {modal === "void" && (
        <Modal
          error={error}
          title="作废中奖记录"
          onClose={closeModal}
        >
          <p>
            {editing?.personName} · {editing?.giftName}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              perform(async () => {
                await api(path + "/winners/" + editing.id + "/void", "POST", {
                  reason: f.get("reason"),
                });
              }, "记录已作废，库存已恢复");
            }}
          >
            <label>
              作废原因
              <textarea
                name="reason"
                required
                maxLength={300}
                placeholder="请填写原因，原记录将保留"
              />
            </label>
            <button className="button danger full" disabled={busy}>
              确认作废并恢复库存
            </button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          error={error}
          title="确认导入名单"
          onClose={() => {
            if (busy) return;
            if (sessionStorage.getItem("import-pending-" + id)) {
              setError("本次导入结果尚未确认，请点击确认导入以恢复同一次请求。");
              return;
            }
            setPreview(null);
          }}
        >
          <p>共读取 {preview.sheets.length} 个工作表、{preview.sourceRows} 行，合并为 {preview.rows.length} 人；每行增加 1 次机会。</p>
          {preview.errors.length > 0 && (
            <div className="error">{preview.errors.join("；")}</div>
          )}
          {preview.warnings?.length > 0 && <div className="error">{preview.warnings.join("；")}</div>}
          <div className="table-scroll import-preview">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  
                  <th>电话</th>
                  <th>门店</th>
                  <th>本次增加</th><th>导入后总次数</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 30).map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    
                    <td>{r.phone}</td>
                    <td>{r.store}</td>
                    <td>{r.addChances} 次</td><td>{r.totalChances} 次</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            仅预览前 30 行。导入时再次校验，全部成功后才保存。
          </p>
          <button
            className="button primary full"
            disabled={busy || preview.errors.length > 0}
            onClick={() =>
              perform(async () => {
                try {
                  sessionStorage.setItem("import-pending-" + id, JSON.stringify(preview));
                } catch {
                  throw new Error("无法保存导入恢复信息，请检查浏览器存储空间后重试");
                }
                try {
                  await api(path + "/import-confirm", "POST", { rows: preview.entries, requestId: preview.requestId, planToken: preview.planToken });
                } catch (e) {
                  if (e instanceof ApiError && (e.status === 400 || e.status === 409)) sessionStorage.removeItem("import-pending-" + id);
                  throw e;
                }
                sessionStorage.removeItem("import-pending-" + id);
                setPreview(null);
              }, "名单已全部导入")
            }
          >
            确认导入 {preview.rows.length} 人
          </button>
        </Modal>
      )}
    </div>
  );
}
function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function WinnerTable({
  rows,
  onVoid,
  onClaim,
  claimBusy,
}: {
  rows: any[];
  onVoid?: (w: any) => void;
  onClaim?: (w: any) => void;
  claimBusy?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>幸运来宾</th>
            <th>门店</th>
            <th>获得礼品</th>
            <th>中奖时间</th>
            <th>状态</th>
            {onVoid && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td>
                <span className="person-cell">
                  <span className="person-avatar">
                    {w.personName.slice(-2)}
                  </span>
                  <b>{w.personName}</b>
                </span>
              </td>
              <td>
                
                <small className="muted">{w.store}</small>
              </td>
              <td>
                <span className="prize-name">
                  <Icon name="gift" size={16} />
                  {w.giftName}
                </span>
                {w.assignment && <small className="void-reason">{w.assignment === "assigned" ? "指定" : "随机"}</small>}
              </td>
              <td>{date(w.createdAt)}</td>
              <td>
                <span className={"badge " + (w.voided ? "neutral" : "gold")}>
                  {w.voided ? "已作废" : w.claimed ? "已领取" : "待领取"}
                </span>
                {w.claimedAt && (
                  <small className="void-reason">
                    领取于 {date(w.claimedAt)}
                  </small>
                )}
                {w.claimHistory?.length > 0 && (
                  <details>
                    <summary className="muted">
                      核销记录 {w.claimHistory.length} 条
                    </summary>
                    {w.claimHistory.map((h: any, i: number) => (
                      <small className="void-reason" key={i}>
                        {date(h.at)} · {h.claimed ? "领取" : "撤销"} · {h.actor}{" "}
                        · {h.reason}
                      </small>
                    ))}
                  </details>
                )}
                {w.voided && (
                  <small className="void-reason">{w.voidReason}</small>
                )}
              </td>
              {onVoid && (
                <td>
                  {onClaim && (
                    <button
                      className="text-button"
                      disabled={w.voided || claimBusy}
                      onClick={() => onClaim(w)}
                    >
                      {w.claimed ? "撤销核销" : "确认领取"}
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={w.voided || w.claimed || claimBusy}
                    title={w.claimed ? "先撤销核销，再作废" : undefined}
                    onClick={() => onVoid(w)}
                  >
                    作废
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
