import { useState, type FormEvent } from "react";
import type { RoundPlan } from "../../shared/stage";
import type { state } from "../../server/domain";
import { api } from "./api";
import { Icon, Modal } from "./components";

type Activity = Awaited<ReturnType<typeof state>>;

export default function RoundSettings({ activity, refresh, openHost }: {
  activity: Activity;
  refresh: () => Promise<void>;
  openHost: () => void;
}) {
  const [editor, setEditor] = useState<RoundPlan | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const endpoint = "/activities/" + activity.id + "/round-plans";
  const locked = activity.archived;
  const enabledGifts = activity.gifts.filter(gift => gift.enabled);
  const plans = [...activity.roundPlans].sort((a, b) => a.order - b.order);
  async function update(action: () => Promise<unknown>, message: string) {
    if (busy || locked) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await action();
      await refresh();
      setNotice(message);
      setEditor(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-content">
    <header className="settings-heading">
      <div><h2>抽奖轮次</h2><p>会前按奖项安排人数和指定名额。现场在主持台选用已保存的轮次。</p></div>
      <button type="button" className="button primary" disabled={locked || busy || !enabledGifts.length}
        onClick={() => { setError(""); setEditor("new"); }}>新增轮次</button>
    </header>
    {!editor && error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="host-notice">{notice}</p>}
    {!plans.length ? <div className="round-settings-empty">
      <Icon name="list" size={28} /><b>还没有安排抽奖轮次</b>
      <p>{enabledGifts.length ? "可以先建一等奖、二等奖，再分别填写人数。" : "请先到礼品管理添加并启用一个礼品。"}</p>
    </div> : <ol className="round-settings-list">
      {plans.map((plan, index) => {
        const assigned = plan.assignedPersonIds?.length ?? 0;
        const gift = activity.gifts.find(item => item.id === plan.giftId);
        return <li key={plan.id}>
          <span className="round-order">{index + 1}</span>
          <div className="round-settings-info">
            <h3>{plan.name} {plan.completedRoundId && <span className="badge neutral">已完成</span>}</h3>
            <p>{gift?.name ?? "礼品已移除"} · 共 {plan.count} 人 · 指定 {assigned} 人 · 随机 {plan.count - assigned} 人</p>
            {assigned > 0 && <small>{plan.assignedPersonIds!.map(id => activity.people.find(person => person.id === id)?.name ?? "名单已移除").join("、")}</small>}
          </div>
          {!plan.completedRoundId && <div className="round-settings-actions">
            <button className="button small" disabled={locked || busy || !index} aria-label={`上移 ${plan.name}`}
              onClick={() => void update(() => api(endpoint, "POST", { ...plan, order: index - 1 }), "轮次顺序已更新")}>上移</button>
            <button className="button small" disabled={locked || busy} onClick={() => { setError(""); setEditor(plan); }}>编辑</button>
            <button className="text-button" disabled={locked || busy} onClick={() => {
              if (confirm(`删除轮次「${plan.name}」？`)) void update(() => api(endpoint + "/" + plan.id, "DELETE"), "轮次已删除");
            }}>删除</button>
          </div>}
        </li>;
      })}
    </ol>}
    <footer className="settings-footer"><button type="button" className="button" onClick={openHost}>前往抽奖控制台</button></footer>
    {editor && <RoundEditor plan={editor === "new" ? undefined : editor} activity={activity} busy={busy} error={error}
      close={() => { if (!busy) setEditor(null); }}
      save={input => void update(() => api(endpoint, "POST", input), "轮次已保存")} />}
  </section>;
}

function RoundEditor({ plan, activity, busy, error, close, save }: {
  plan?: RoundPlan;
  activity: Activity;
  busy: boolean;
  error: string;
  close: () => void;
  save: (input: Pick<RoundPlan, "name" | "giftId" | "count" | "assignedPersonIds"> & { id?: string }) => void;
}) {
  const [giftId, setGiftId] = useState(plan?.giftId ?? "");
  const [count, setCount] = useState(plan?.count ?? 1);
  const [assigned, setAssigned] = useState(plan?.assignedPersonIds ?? []);
  const [personId, setPersonId] = useState("");
  const [query, setQuery] = useState("");
  const gift = activity.gifts.find(item => item.id === giftId);
  const people = new Map(activity.people.map(person => [person.id, person]));
  const matches = activity.people.filter(person => person.enabled && !assigned.includes(person.id)
    && [person.name, person.store, person.phone].join(" ").includes(query.trim())).slice(0, 100);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim() || gift?.name || "";
    save({ ...(plan ? { id: plan.id } : {}), name, giftId, count, assignedPersonIds: assigned });
  }
  return <Modal title={plan ? "编辑抽奖轮次" : "新增抽奖轮次"} error={error} onClose={close}>
    <form className="round-editor" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>轮次名称<input name="name" defaultValue={plan?.name} maxLength={80} placeholder="留空时使用礼品名称" /></label>
        <div className="form-grid">
          <label>本轮奖项<select value={giftId} required onChange={event => setGiftId(event.target.value)}>
            <option value="">请选择礼品</option>
            {activity.gifts.filter(item => item.enabled).map(item =>
              <option key={item.id} value={item.id}>{item.name} · 剩 {item.remaining} 份</option>)}
          </select></label>
          <label>本轮人数<input type="number" min={1} max={50} value={count} required
            onChange={event => setCount(Number(event.target.value))} /></label>
        </div>
        <div className="round-allocation">
          <div><h3>指定名额</h3><p>指定 {assigned.length} 人 · 随机 {Math.max(0, count - assigned.length)} 人</p></div>
          {assigned.length > 0 && <ul className="round-assigned">
            {assigned.map(id => <li key={id}>{people.get(id)?.name ?? "名单已移除"}
              <button type="button" className="text-button" aria-label={`移除 ${people.get(id)?.name ?? "指定人员"}`}
                onClick={() => setAssigned(current => current.filter(value => value !== id))}>移除</button>
            </li>)}
          </ul>}
          <label>搜索名单<input value={query} placeholder="姓名、门店或电话" onChange={event => { setQuery(event.target.value); setPersonId(""); }} /></label>
          <div className="round-person-picker">
            <label>指定人员<select value={personId} onChange={event => setPersonId(event.target.value)}>
              <option value="">请选择人员</option>
              {matches.map(person => <option key={person.id} value={person.id} disabled={!person.remainingChances}>
                {person.name} · {person.store || person.phone.slice(-4)}{person.remainingChances ? "" : " · 暂无抽奖机会"}
              </option>)}
            </select></label>
            <button type="button" className="button" disabled={!personId || assigned.length >= count} onClick={() => {
              setAssigned(current => [...current, personId]);
              setPersonId("");
            }}>添加指定人员</button>
          </div>
          {assigned.length >= count && <small>{assigned.length === count ? "本轮名额均已指定。" : "请增加本轮人数或移除部分指定人员。"}</small>}
        </div>
        <button type="submit" className="button primary" disabled={!giftId || count < 1 || assigned.length > count}>保存轮次</button>
      </fieldset>
    </form>
  </Modal>;
}
