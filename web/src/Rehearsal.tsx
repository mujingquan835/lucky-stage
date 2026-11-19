import { useEffect, useState } from "react";
import { rehearsalDraw } from "./live-support";
import PrizeMachine, { PrizePool } from "./PrizeMachine";
import "./live-support.css";
export default function Rehearsal({
  activity,
  onClose,
}: {
  activity: any;
  onClose: () => void;
}) {
  const initial = () => ({ ...structuredClone(activity), rounds: [] });
  const initialScope = activity.stageSession?.selection?.scope ?? {};
  const [a, setA] = useState(initial),
    [mode, setMode] = useState<"single" | "batch">("single"),
    [person, setPerson] = useState(""),
    [gift, setGift] = useState(""),
    [count, setCount] = useState(1),
    [result, setResult] = useState<any[]>([]),
    [error, setError] = useState(""),
    [rolling, setRolling] = useState(false),
    [company, setCompany] = useState(initialScope.company ?? ""),
    [store, setStore] = useState(initialScope.store ?? ""),
    [checkedInOnly, setCheckedInOnly] = useState(!!initialScope.checkedInOnly),
    [animation, setAnimation] = useState(
      activity.stageConfig?.animation ?? "reels",
    ),
    [tick, setTick] = useState(0);
  const scope = { company, store, checkedInOnly };
  const won = new Set(
    a.rounds.flatMap((r: any) =>
      r.winners.filter((w: any) => !w.voided).map((w: any) => w.personId),
    ),
  );
  const people = a.people.filter(
    (p: any) =>
      p.enabled &&
      (a.allowRepeat || !won.has(p.id)) &&
      (!company || p.company === company) &&
      (!store || p.store === store) &&
      (!checkedInOnly || p.checkedIn),
  );
  useEffect(() => {
    if (!rolling || animation !== "names") return;
    const timer = setInterval(() => setTick((v) => v + 1), 110);
    return () => clearInterval(timer);
  }, [rolling, animation]);
  const gs = a.gifts.map((g: any) => ({
    ...g,
    remaining:
      g.total -
      a.rounds
        .flatMap((r: any) => r.winners)
        .filter((w: any) => w.giftId === g.id).length,
  }));
  async function run() {
    if (rolling) return;
    try {
      const r = rehearsalDraw(a, {
        mode,
        personId: person,
        giftId: gift,
        count,
        scope,
      });
      setError("");
      setRolling(true);
      setResult(r.winners);
      await new Promise((r) => setTimeout(r, 4600));
      setA(r.activity);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRolling(false);
    }
  }
  return (
    <section className="rehearsal" role="dialog" aria-label="独立彩排">
      <header>
        <div>
          <b>独立彩排</b>
          <p>从完整库存开始独立彩排，不写入正式库存、中奖记录和领奖状态</p>
        </div>
        <button className="button" disabled={rolling} onClick={onClose}>
          退出彩排
        </button>
      </header>
      <div className="rehearsal-watermark">彩排 · 非正式中奖</div>
      <div className="rehearsal-controls">
        <label>
          彩排方式
          <select
            value={mode}
            disabled={rolling}
            onChange={(e) => setMode(e.target.value as any)}
          >
            <option value="single">单人抽礼品</option>
            <option value="batch">批量抽来宾</option>
          </select>
        </label>
        {mode === "single" ? (
          <label>
            彩排来宾
            <select
              disabled={rolling}
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">请选择</option>
              {people.map((p: any) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              彩排礼品
              <select
                disabled={rolling}
                value={gift}
                onChange={(e) => setGift(e.target.value)}
              >
                <option value="">请选择</option>
                {gs
                  .filter((g: any) => g.enabled && g.remaining > 0)
                  .map((g: any) => (
                    <option value={g.id} key={g.id}>
                      {g.name}（{g.remaining}份）
                    </option>
                  ))}
              </select>
            </label>
            <label>
              人数
              <input
                disabled={rolling}
                type="number"
                min="1"
                max="50"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          </>
        )}
        <label>
          彩排公司
          <select
            value={company}
            disabled={rolling}
            onChange={(e) => {
              setCompany(e.target.value);
              setPerson("");
            }}
          >
            <option value="">全部公司</option>
            {[
              ...new Set<string>(
                a.people.map((p: any) => p.company).filter(Boolean),
              ),
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          彩排门店
          <select
            value={store}
            disabled={rolling}
            onChange={(e) => {
              setStore(e.target.value);
              setPerson("");
            }}
          >
            <option value="">全部门店</option>
            {[
              ...new Set<string>(
                a.people.map((p: any) => p.store).filter(Boolean),
              ),
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          动画玩法
          <select
            value={animation}
            disabled={rolling}
            onChange={(e) => setAnimation(e.target.value)}
          >
            <option value="reels">礼品老虎机</option>
            <option value="names">姓名卡滚动</option>
          </select>
        </label>
        <label className="rehearsal-check">
          <input
            type="checkbox"
            disabled={rolling}
            checked={checkedInOnly}
            onChange={(e) => {
              setCheckedInOnly(e.target.checked);
              setPerson("");
            }}
          />
          仅已到场（当前可抽 {people.length} 人）
        </label>
        <button className="button primary" disabled={rolling} onClick={run}>
          {rolling ? "彩排揭晓中…" : "开始彩排"}
        </button>
        <button
          className="button"
          disabled={rolling}
          onClick={() => {
            setA(initial());
            setResult([]);
            setError("");
          }}
        >
          重置彩排进度
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="rehearsal-body">
        <PrizePool gifts={gs} />
        <div>
          {animation === "names" && rolling ? (
            <div className="rehearsal-name-grid" aria-label="彩排姓名滚动">
              {Array.from({ length: 9 }, (_, i) => (
                <article key={i}>
                  <strong>
                    {people[(tick * 3 + i * 7) % Math.max(1, people.length)]
                      ?.name ?? "幸运来宾"}
                  </strong>
                </article>
              ))}
            </div>
          ) : (
            <PrizeMachine
              gifts={
                mode === "batch"
                  ? gs.filter((g: any) => g.id === gift)
                  : gs.filter((g: any) => g.singleEnabled && g.enabled)
              }
              running={rolling}
              outcome={
                rolling && result[0]
                  ? {
                      id: result[0].giftId,
                      name: result[0].giftName,
                      image: result[0].giftImage,
                    }
                  : undefined
              }
            />
          )}
          {!rolling && result.length > 0 && (
            <div className="rehearsal-results">
              {result.map((w) => (
                <article key={w.id}>
                  <strong>{w.personName}</strong>
                  <span>{w.giftName}</span>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
