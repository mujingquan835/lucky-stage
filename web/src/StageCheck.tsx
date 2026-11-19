import { useEffect, useState } from "react";
import { api } from "./api";
import { defaultStageConfig, type StageView } from "../../shared/stage";
import { useLiveAudio } from "./live-support";
import "./live-support.css";
export default function StageCheck({ activityId }: { activityId: string }) {
  const [view, setView] = useState<StageView | null>(null),
    [connection, setConnection] = useState("检查中"),
    [images, setImages] = useState("待检查"),
    [heard, setHeard] = useState(false),
    [played, setPlayed] = useState(false),
    [full, setFull] = useState(!!document.fullscreenElement),
    [ran, setRan] = useState(0);
  const sound = useLiveAudio(view?.config ?? defaultStageConfig());
  useEffect(() => {
    let alive = true;
    setView(null);
    setHeard(false);
    setPlayed(false);
    setConnection("检查中");
    setImages("待检查");
    api<StageView>("/activities/" + activityId + "/stage")
      .then(async (v) => {
        if (!alive) return;
        setView(v);
        setConnection("已连接");
        const urls = [
          v.background,
          v.brandImage,
          ...v.gifts.map((g) => g.image),
        ].filter(Boolean);
        const outcomes = await Promise.all(
          urls.map(
            (url) =>
              new Promise<boolean>((resolve) => {
                const img = new Image();
                const t = setTimeout(() => resolve(false), 6000);
                img.onload = () => {
                  clearTimeout(t);
                  resolve(true);
                };
                img.onerror = () => {
                  clearTimeout(t);
                  resolve(false);
                };
                img.src = url;
              }),
          ),
        );
        if (alive)
          setImages(
            !urls.length
              ? "未上传图片，使用默认示意图"
              : outcomes.every(Boolean)
                ? `${urls.length} 张图片加载成功`
                : `${outcomes.filter((v) => !v).length} 张图片失败，请更换`,
          );
      })
      .catch((e) => {
        if (alive) setConnection(e.message);
      });
    return () => {
      alive = false;
    };
  }, [activityId, ran]);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  return (
    <section className="stage-check">
      <header>
        <h3>现场自检</h3>
        <button className="button small" onClick={() => setRan((v) => v + 1)}>
          重新检查
        </button>
      </header>
      <ul>
        <li>
          <b>后台连接</b>
          <span>{connection}</span>
        </li>
        <li>
          <b>名单与礼品</b>
          <span>
            {view
              ? `${view.participants.length} 位展示样本（最多120位） / ${view.gifts.reduce((s, g) => s + g.remaining, 0)} 份剩余礼品${view.participants.length === 0 || !view.gifts.some((g) => g.remaining > 0) ? "，当前无可抽名单或库存，请检查" : ""}`
              : "待连接后检查"}
          </span>
        </li>
        <li>
          <b>礼品与背景图片</b>
          <span>{images}</span>
        </li>
        <li>
          <b>扬声器试听</b>
          <span>{heard ? "人工确认听到声音" : "待人工确认，不能自动判定"}</span>
          <div>
            <button
              className="button small"
              onClick={() => {
                setHeard(false);
                setPlayed(false);
                void sound.test().then(setPlayed);
              }}
            >
              点击试听
            </button>
            <button
              className="button small"
              disabled={!played || !!sound.error}
              onClick={() => setHeard(true)}
            >
              我听到了
            </button>
          </div>
        </li>
        <li>
          <b>全屏展示</b>
          <span>{full ? "当前页已全屏" : "待在实际大屏进入全屏"}</span>
        </li>
        <li>
          <b>本轮规则</b>
          <span>
            {view?.preview
              ? `${view.preview.mode === "single" ? "单人" : "批量"} / ${view.preview.count} 人`
              : "尚未准备本轮，请在控制台设置"}
          </span>
        </li>
      </ul>
      {sound.error && <p className="error">{sound.error}</p>}
      <p className="muted">
        请在实际投影电脑试听、全屏和试读远处姓名。自动检查不能替代现场人员确认。
      </p>
    </section>
  );
}
