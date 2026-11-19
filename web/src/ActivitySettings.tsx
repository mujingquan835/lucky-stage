import { useState, type FormEvent, type ReactNode } from "react";
import type { state } from "../../server/domain";
import type { StageView } from "../../shared/stage";
import { api, upload } from "./api";
import { Icon } from "./components";
import RoundSettings from "./RoundSettings";
import { SelfSettings } from "./SelfService";
import "./activity-settings.css";

const categories = [
  { id: "basics", title: "基本信息", icon: "edit" },
  { id: "rounds", title: "抽奖轮次", icon: "list" },
  { id: "stage", title: "舞台与展示", icon: "screen" },
  { id: "self", title: "自主抽奖", icon: "play" },
  { id: "management", title: "活动管理", icon: "settings" },
] as const;
export type SettingsSection = (typeof categories)[number]["id"];
type Activity = Awaited<ReturnType<typeof state>>;

export default function ActivitySettings({ activity, section, setSection, refresh, openHost, management }: {
  activity: Activity;
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  refresh: () => Promise<void>;
  openHost: () => void;
  management: ReactNode;
}) {
  return <div className="activity-settings-layout">
    <nav className="settings-nav panel" aria-label="活动设置分类">
      {categories.map(item => <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined}
        onClick={() => setSection(item.id)}><Icon name={item.icon} size={17} />{item.title}</button>)}
    </nav>
    <div className="settings-body">
      {section === "basics" && <SettingsForm key="basics" activity={activity} refresh={refresh} />}
      {section === "rounds" && <RoundSettings activity={activity} refresh={refresh} openHost={openHost} />}
      {section === "stage" && <SettingsForm key="stage" activity={activity} refresh={refresh} stage />}
      {section === "self" && <SelfSettings key={activity.id} activity={activity} refresh={refresh} />}
      {section === "management" && <section className="panel settings-content">
        <header className="settings-heading"><div><h2>活动管理</h2><p>复制、归档或删除活动，查看操作记录。</p></div></header>
        {management}
      </section>}
    </div>
  </div>;
}

function SettingsForm({ activity, refresh, stage = false }: {
  activity: Activity;
  refresh: () => Promise<void>;
  stage?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeMusic, setRemoveMusic] = useState(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const path = "/activities/" + activity.id;
  const config = activity.stageConfig;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || activity.archived) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!stage) {
        await api(path, "PATCH", { name: form.get("name"), subtitle: form.get("subtitle") });
      } else {
        const background = form.get("background") as File;
        const brand = form.get("brandImage") as File;
        const music = form.get("music") as File;
        const images = await Promise.all([background.size ? upload(background) : undefined, brand.size ? upload(brand) : undefined]);
        const musicUrl = music.size ? (await api<{ url: string }>("/audio", "POST", music)).url : removeMusic ? "" : undefined;
        const view = await api<StageView>(path + "/host-stage");
        await api(path + "/stage-command", "POST", {
          requestId: crypto.randomUUID(), expectedVersion: view.session.version, action: "config",
          config: { welcomeText: form.get("welcome"), endText: form.get("end"), countdown: form.has("countdown"),
            celebrate: form.has("celebrate"), volume: Number(form.get("volume")), ...(musicUrl !== undefined ? { music: musicUrl } : {}) },
          display: { color: form.get("color"), showCompany: form.has("showCompany"), showStore: form.has("showStore"),
            ...(images[0] ? { background: images[0] } : {}), ...(images[1] ? { brandImage: images[1] } : {}) },
        });
        setRemoveMusic(false);
      }
      await refresh();
      setSavedRevision(value => value + 1);
      setNotice(stage ? "舞台与展示设置已保存" : "基本信息已保存");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-content">
    <header className="settings-heading"><div>
      <h2>{stage ? "舞台与展示" : "基本信息"}</h2>
      <p>{stage ? "设置投影画面、欢迎语、揭晓效果和音乐。" : "设置活动名称和用于现场展示的副标题。"}</p>
    </div></header>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="host-notice">{notice}</p>}
    <form className="settings-form" onSubmit={submit} key={savedRevision}>
      <fieldset disabled={activity.archived || busy}>
        {stage ? <>
          <div className="settings-group">
            <h3>画面与信息</h3>
            <div className="form-grid">
              <label>大屏背景图<input type="file" name="background" accept="image/png,image/jpeg,image/webp" />
                {activity.background && <img className="upload-preview" src={activity.background} alt="当前背景" />}</label>
              <label>品牌图片<input type="file" name="brandImage" accept="image/png,image/jpeg,image/webp" />
                {activity.brandImage && <img className="upload-preview" src={activity.brandImage} alt="当前品牌图片" />}</label>
              <label>活动主色<input type="color" name="color" defaultValue={activity.color} /></label>
            </div>
            <label className="settings-switch"><b>大屏展示公司名称</b><input type="checkbox" name="showCompany" defaultChecked={activity.showCompany} /></label>
            <label className="settings-switch"><b>大屏展示门店名称</b><input type="checkbox" name="showStore" defaultChecked={activity.showStore} /></label>
          </div>
          <div className="settings-group">
            <h3>现场文案与揭晓</h3>
            <div className="form-grid">
              <label>欢迎语<input name="welcome" maxLength={120} defaultValue={config.welcomeText} /></label>
              <label>结束语<input name="end" maxLength={120} defaultValue={config.endText} /></label>
            </div>
            <label className="settings-switch"><b>开启 3-2-1 倒计时</b><input type="checkbox" name="countdown" defaultChecked={config.countdown} /></label>
            <label className="settings-switch"><b>揭晓彩带</b><input type="checkbox" name="celebrate" defaultChecked={config.celebrate} /></label>
          </div>
          <div className="settings-group">
            <h3>音乐</h3>
            <label>音量<input type="range" name="volume" min={0} max={1} step={0.1} defaultValue={config.volume} /></label>
            <label>上传活动音乐<input type="file" name="music" accept="audio/mpeg,audio/wav,audio/ogg" /></label>
            {config.music && <label className="settings-switch"><b>移除已上传音乐</b><input type="checkbox" checked={removeMusic} onChange={e => setRemoveMusic(e.target.checked)} /></label>}
          </div>
        </> : <div className="form-grid">
          <label>活动名称<input name="name" defaultValue={activity.name} maxLength={80} required /></label>
          <label>活动副标题<input name="subtitle" defaultValue={activity.subtitle} maxLength={120} /></label>
        </div>}
        <footer className="settings-footer"><button type="submit" className="button primary">{busy ? "保存中…" : "保存设置"}</button></footer>
      </fieldset>
    </form>
  </section>;
}
