import { GiftArt, Icon } from "./components";
import { buildReelTrack } from "./reels";
export type DisplayGift = {
  id: string;
  name: string;
  image: string;
  remaining?: number;
  singleEnabled?: boolean;
  enabled?: boolean;
};
export function PrizePool({ gifts }: { gifts: DisplayGift[] }) {
  return (
    <section className="prize-pool" aria-label="本场礼品展示">
      <div className="pool-heading">
        <Icon name="gift" size={18} />
        <b>本场好礼</b>
        <span>{gifts.length} 种</span>
      </div>
      {gifts.length ? (
        <div className="pool-list">
          {Array.from({ length: 8 }, (_, i) => gifts[i % gifts.length]).map(
            (g, i) => (
              <article
                className={g.remaining === 0 ? "exhausted" : ""}
                key={`${g.id}-${i}`}
              >
                <GiftArt image={g.image} index={i} name={g.name} />
                <div>
                  <b>{g.name}</b>
                  <span>
                    {g.remaining === 0
                      ? "已抽完"
                      : g.remaining === undefined
                        ? "本轮礼品"
                        : `剩余 ${g.remaining} 份`}
                  </span>
                </div>
              </article>
            ),
          )}
        </div>
      ) : (
        <p className="muted">请先在后台添加礼品</p>
      )}
    </section>
  );
}
export default function PrizeMachine({
  gifts,
  running = false,
  outcome,
  caption,
  columns = 5,
}: {
  gifts: DisplayGift[];
  running?: boolean;
  outcome?: DisplayGift;
  caption?: string;
  columns?: 3 | 5;
}) {
  const pool = gifts.filter((g) => g.enabled !== false);
  const rolling = pool.filter((g) => (g.remaining ?? 1) > 0);
  const shown = [...rolling];
  if (outcome && !shown.some((g) => g.id === outcome.id)) shown.push(outcome);
  return (
    <div
      className={"prize-machine " + (running ? "machine-running" : "")}
      data-phase={running ? "spinning" : "idle"}
      aria-label="礼品老虎机"
    >
      <header className="machine-marquee">
        <span>✦</span>
        <b>
          {running ? "好运正在转动" : outcome ? "幸运已揭晓" : "好礼已就位"}
        </b>
        <span>✦</span>
      </header>
      <div className="machine-cabinet">
        <div className="machine-lights" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ animationDelay: i * 0.08 + "s" }} />
          ))}
        </div>
        <div className="reels">
          {Array.from({ length: columns }, (_, i) => i).map((column) => {
            const ids = buildReelTrack(
              shown.map((g) => g.id),
              outcome?.id,
              8 + column,
              column,
            );
            const sequence = running
              ? ids
              : ([
                  outcome?.id ?? shown[column % Math.max(1, shown.length)]?.id,
                ].filter(Boolean) as string[]);
            return (
              <div className="reel-window" key={column}>
                <div
                  key={(outcome?.id ?? "waiting") + String(running)}
                  className={
                    "reel-track " +
                    (running ? (outcome ? "reel-landing" : "reel-loop") : "")
                  }
                  style={
                    {
                      "--steps": sequence.length - 1,
                      "--duration": (3.2 + column * 0.28).toFixed(2) + "s",
                    } as any
                  }
                  aria-hidden="true"
                >
                  {sequence.map((id, i) => {
                    const g = shown.find((g) => g.id === id)!;
                    const index = pool.findIndex((p) => p.id === id);
                    return (
                      <div className="reel-cell" key={i}>
                        <GiftArt
                          image={g.image}
                          index={Math.max(0, index)}
                          name={g.name}
                        />
                        <b>{g.name}</b>
                      </div>
                    );
                  })}
                  {!sequence.length && (
                    <div className="reel-cell reel-empty">
                      <Icon name="gift" size={45} />
                      <b>等待礼品入场</b>
                    </div>
                  )}
                </div>
                <div className="reel-glass" aria-hidden="true" />
              </div>
            );
          })}
        </div>
        <div className="machine-pointer left" />
        <div className="machine-pointer right" />
      </div>
      <div className="machine-caption" role="status">
        {caption ??
          (running ? "礼品正在滚动，等待揭晓…" : "先看好礼品，再开启幸运时刻")}
      </div>
      <p className="machine-note">图片滚动仅作展示，礼品按后台规则抽取</p>
    </div>
  );
}
