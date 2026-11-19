import { maskText as mask } from "../../shared/self-service";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { GiftArt, Icon } from "./components";
import PrizeMachine, { PrizePool } from "./PrizeMachine";
import PersonRoll, { Portrait } from "./PersonRoll";
import {
  defaultStageConfig,
  usesPortraits,
  type StageView,
  type StageWinner,
} from "../../shared/stage";
import { exportResultImage, useLiveAudio } from "./live-support";
import { Confetti } from "./LiveEffects";
import "./stage-v2.css";

const sceneLabels = {
  welcome: "欢迎来宾",
  gifts: "本场好礼",
  draw: "幸运抽奖",
  winners: "幸运荣誉墙",
  end: "感谢相聚",
};
const pageSize = 8;

export default function Stage({ id }: { id: string }) {
  const [view, setView] = useState<StageView | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [toolsVisible, setToolsVisible] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [connectedAt, setConnectedAt] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const latestVersion = useRef(-1);
  const frozenPool = useRef<StageView["gifts"]>([]);
  const activeRound = useRef<string | null>(null);
  const config = view?.config ?? defaultStageConfig();
  const audio = useLiveAudio(config, view?.session);

  useEffect(() => {
    let active = true;
    let inflight = false;
    latestVersion.current = -1;
    activeRound.current = null;
    frozenPool.current = [];
    setView(null);
    setError("");
    async function load() {
      if (inflight) return;
      inflight = true;
      try {
        const started = Date.now();
        const data = await api<StageView>(`/activities/${id}/stage`);
        if (!active || data.session.version < latestVersion.current) return;
        latestVersion.current = data.session.version;
        if (
          data.session.roundId !== activeRound.current &&
          (data.session.phase === "rolling" ||
            data.session.phase === "decelerating")
        ) {
          frozenPool.current = data.gifts;
          activeRound.current = data.session.roundId;
        }
        if (
          data.session.phase === "idle" ||
          data.session.phase === "revealed"
        ) {
          frozenPool.current = [];
          activeRound.current = data.session.roundId;
        }
        setView(data);
        setClockOffset(Date.parse(data.serverNow) - (started + Date.now()) / 2);
        setConnectedAt(Date.now());
        setError("");
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        inflight = false;
      }
    }
    void load();
    const poll = setInterval(load, 500);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setActionError("");
    } catch {
      setActionError("无法进入全屏，请使用浏览器的全屏功能。");
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target?.closest(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void fullscreen();
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        audio.toggleMute();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [audio.toggleMute]);

  const session = view?.session;
  const phase = session?.phase ?? "idle";
  const scene = session?.scene ?? "welcome";
  const serverNow = now + clockOffset;
  const countdown =
    session?.startedAt && config.countdown && phase === "rolling"
      ? Math.ceil((Date.parse(session.startedAt) + 3000 - serverNow) / 1000)
      : 0;
  const isRolling = phase === "rolling" || phase === "decelerating";
  const current = view?.currentRound;
  const currentWinners = current?.winners.filter((w) => !w.voided) ?? [];
  const history = useMemo(
    () => view?.rounds.flatMap((r) => r.winners.filter((w) => !w.voided)) ?? [],
    [view?.rounds],
  );
  const shownWinners = scene === "winners" ? history : currentWinners;
  const pages = Math.ceil(shownWinners.length / pageSize);
  const page = Math.min(
    Math.max(0, session?.page ?? 0),
    Math.max(0, pages - 1),
  );
  const visibleWinners = shownWinners.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );
  const gifts = view?.gifts ?? [];
  const pool =
    isRolling && frozenPool.current.length ? frozenPool.current : gifts;
  const selection = session?.selection;
  const photoDraw = usesPortraits(view);
  const candidates = view?.participants ?? [];
  const spinGifts =
    selection?.giftId
      ? pool.filter((g) => g.id === selection.giftId)
      : pool.filter((g) => g.singleEnabled);
  const landed = phase === "decelerating" ? currentWinners[0] : undefined;
  const outcome = landed
    ? { id: landed.giftId, name: landed.giftName, image: landed.giftImage }
    : undefined;
  const connectionLost = !!error || (!!connectedAt && now - connectedAt > 5000);
  const stageName = view?.name ?? "正在连接活动…";
  const pendingSeconds =
    session?.deadline && phase === "rolling"
      ? Math.max(
          0,
          Math.ceil((Date.parse(session.deadline) - serverNow) / 1000),
        )
      : null;

  return (
    <div
      className={`stage stage-v2 scene-${scene} phase-${phase}`}
      data-scene={scene}
      data-phase={phase}
      style={
        {
          "--event-color": view?.color ?? "#ff4b2d",
          ...(view?.background
            ? {
                backgroundImage: `linear-gradient(0deg,rgba(11,69,105,.18),rgba(54,170,241,.05)),url(${view.background})`,
              }
            : {}),
        } as any
      }
    >
      {phase === "revealed" && scene === "draw" && config.celebrate && (
        <Confetti key={`${session?.roundId}-${session?.replay}`} trigger />
      )}
      <header className="stage-header v2-header">
        {view?.brandImage ? (
          <img src={view.brandImage} alt="活动品牌" />
        ) : (
          <span className="stage-brand">
            <Icon name="spark" />
            幸运现场
          </span>
        )}
        <div className="v2-tools-wrap">
          {toolsVisible && (
            <div className="stage-tools v2-tools">
              <span
                className={`v2-connection ${connectionLost ? "lost" : ""}`}
                role="status"
              >
                <i />
                {connectionLost ? "连接恢复中" : "展示已同步"}
              </span>
              <a href="/" target="_blank" rel="noreferrer">
                主持工作台
              </a>
              <button onClick={() => void fullscreen()}>
                <Icon name="screen" size={16} />
                全屏 F
              </button>
              <button
                onClick={() => {
                  if (!audio.enabled) void audio.activate();
                  else audio.toggleMute();
                }}
              >
                {!audio.enabled
                  ? "点击开启声音"
                  : audio.muted
                    ? "取消静音 M"
                    : "静音 M"}
              </button>
              {shownWinners.length > 0 &&
                (phase === "revealed" || scene === "winners") && (
                  <button
                    onClick={() =>
                      view &&
                      void exportResultImage(
                        view,
                        scene === "winners" ? null : current,
                      ).catch((e) => setActionError(e.message))
                    }
                  >
                    {scene === "winners" ? "导出本页结果图" : "导出结果图"}
                  </button>
                )}
            </div>
          )}
          <button
            className="v2-tools-toggle"
            onClick={() => setToolsVisible((v) => !v)}
            aria-label={toolsVisible ? "收起工具栏" : "展开工具栏"}
          >
            {toolsVisible ? "收起" : "工具"}
          </button>
        </div>
      </header>
      {(connectionLost || actionError || audio.error) && (
        <div className="stage-error v2-status-error" role="alert">
          {actionError ||
            audio.error ||
            `${error || "与后台暂时失去连接"}，正在恢复；已保存结果不会丢失。`}
        </div>
      )}
      <div className="stage-title v2-title">
        <img className="stage-title-art" src="/campaign/stage-title.png" alt="幸运现场 超级豪礼抽不停" />
        {view?.testMode && <strong className="stage-test-label">【测试模式】</strong>}
      </div>

      {scene === "welcome" && (
        <section className="v2-scene-panel v2-welcome">
          <span className="v2-welcome-star">✧</span>
          <p>欢迎各位来宾</p>
          <h2>{config.welcomeText}</h2>
          <div className="v2-welcome-line" />
          <div className="v2-welcome-summary">
            <span>
              <Icon name="gift" />
              {gifts.length} 种好礼已就位
            </span>
            <span>
              <Icon name="spark" />
              期待每一个幸运时刻
            </span>
          </div>
          {view?.plans.length ? (
            <div className="v2-plan-ribbon" aria-label="本场奖项安排">
              {view.plans
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((p) => (
                  <span
                    className={p.completedRoundId ? "completed" : ""}
                    key={p.id}
                  >
                    {p.name}
                    <small>
                      {p.completedRoundId ? "已完成" : `${p.count} 位`}
                    </small>
                  </span>
                ))}
            </div>
          ) : null}
        </section>
      )}

      {scene === "gifts" && (
        <section className="v2-scene-panel v2-gallery-scene">
          <div className="v2-panel-heading">
            <h2>本场惊喜好礼</h2>
            <span>
              共 {gifts.length} 种 · 剩余{" "}
              {gifts.reduce((n, g) => n + g.remaining, 0)} 份
            </span>
          </div>
          {gifts.length ? (
            <div className="v2-gift-gallery">
              {gifts.map((g, i) => (
                <article
                  className={g.remaining === 0 ? "empty-stock" : ""}
                  key={g.id}
                >
                  <GiftArt image={g.image} index={i} name={g.name} />
                  <h3>{g.name}</h3>
                  <span>
                    {g.remaining > 0 ? (
                      <>
                        剩余 <b>{g.remaining}</b> / {g.total} 份
                      </>
                    ) : (
                      "本份好礼已全部送出"
                    )}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="v2-empty">礼品准备中，敬请期待</p>
          )}
        </section>
      )}

      {scene === "draw" && (
        <section className="stage-center machine-stage v2-draw-panel">
          <div className="stage-reveal v2-draw-main">
            <div className="stage-section-title">
              <span />
              <b>
                {phase === "rolling"
                  ? "好运正在转动"
                  : phase === "decelerating"
                    ? "幸运即将揭晓"
                    : phase === "revealed"
                      ? "恭喜以下幸运来宾"
                      : "下一份幸运，即将登场"}
              </b>
              <span />
            </div>
            {view?.preview?.personName && phase !== "revealed" && (
              <div className="v2-current-person">
                抽奖来宾：{mask(view.preview.personName)}
              </div>
            )}
            {photoDraw && view?.preview?.giftName && (
              <div className="v2-current-person">本轮奖项 · {view.preview.giftName}</div>
            )}
            {phase === "revealed" ? (
              <WinnerGrid
                winners={visibleWinners}
                showGift
                showPhotos={photoDraw}
              />
            ) : photoDraw ? (
              <PersonRoll people={candidates} running={isRolling} />
            ) : (
              <PrizeMachine
                key={`${session?.roundId ?? "ready"}-${session?.replay}`}
                gifts={spinGifts}
                running={isRolling}
                outcome={outcome}
                caption={
                  phase === "rolling"
                    ? "等待主持人停止揭晓"
                    : phase === "decelerating"
                      ? "正在减速停奖，请共同期待"
                      : view?.preview?.personName
                        ? `已准备：${mask(view.preview.personName)}`
                        : "礼品已就位，请在主持工作台开始"
                }
              />
            )}
            {phase === "rolling" && pendingSeconds !== null && (
              <small className="v2-auto-reveal">
                {pendingSeconds > 0
                  ? `最长 ${pendingSeconds} 秒后自动揭晓，防止现场中断`
                  : "正在恢复并揭晓已保存结果"}
              </small>
            )}
            {phase === "revealed" && shownWinners.length === 0 && (
              <p className="v2-empty">本轮记录已作废或暂无有效中奖来宾</p>
            )}
            {phase === "revealed" && pages > 1 && (
              <div className="stage-pagination">
                第 {page + 1} / {pages} 页 · 由主持台同步翻页
              </div>
            )}
            {phase === "revealed" && current && (
              <small className="v2-result-saved">
                本轮结果已保存 · 重播与回看不会再次抽奖
              </small>
            )}
          </div>
          {phase !== "revealed" && !photoDraw && <div className="stage-bottom-pool"><PrizePool gifts={pool} /></div>}
        </section>
      )}

      {scene === "winners" && (
        <section className="v2-scene-panel v2-winners-scene">
          <div className="v2-panel-heading">
            <h2>每一份幸运，都有名字</h2>
            <span>{history.length} 份有效中奖记录</span>
          </div>
          <WinnerGrid winners={visibleWinners} showGift showPhotos />
          {!history.length && (
            <p className="v2-empty">本场幸运来宾，即将揭晓</p>
          )}
          {pages > 1 && (
            <div className="stage-pagination">
              第 {page + 1} / {pages} 页 · 由主持台同步翻页
            </div>
          )}
        </section>
      )}

      {scene === "end" && (
        <section className="v2-scene-panel v2-end-scene">
          <span>✧</span>
          <p>本场活动圆满结束</p>
          <h2>{config.endText}</h2>
          <div className="v2-end-summary">
            <b>{history.length}</b>
            <span>份幸运已经送出</span>
          </div>
          <small>感谢每一位来宾，让美好在相聚中发生。</small>
        </section>
      )}

      <footer className="stage-footer v2-footer">
        <span>幸运现场 · Lucky Stage</span>
        <span>
          {view?.archived
            ? "本场活动已归档"
            : connectionLost
              ? "连接恢复中，保留当前画面"
              : `${sceneLabels[scene]} · 祝各位来宾好运`}
        </span>
      </footer>
    </div>
  );
}

function WinnerGrid({
  winners,
  showGift,
  showPhotos,
}: {
  winners: StageWinner[];
  showGift: boolean;
  showPhotos?: boolean;
}) {
  return (
    <div
      className={`stage-winners v2-winner-grid ${winners.length === 1 ? "single-winner" : ""}`}
    >
      {winners.map((w) => (
        <article key={w.id}>
          <div className="winner-person">
          {showPhotos && <Portrait key={w.personPhoto} name={w.personName} photo={w.personPhoto} />}
          <b>{mask(w.personName)}</b>
          
          {w.store && <small>{mask(w.store)}</small>}</div>
          {showGift && <div className="winner-gift"><GiftArt image={w.giftImage} name={w.giftName} index={0} /><strong>{w.giftName}</strong></div>}
          {w.claimed && <i>已领取</i>}
        </article>
      ))}
    </div>
  );
}

