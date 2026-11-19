import { useCallback, useEffect, useRef, useState } from "react";
import { syncRollingMusic } from "./rolling-music";
import { updateStageSounds } from "./stage-sounds";
import type {
  StageConfig,
  StageSession,
  StageView,
  StageRound,
  StageSelection,
} from "../../shared/stage";
export function useLiveAudio(config: StageConfig, session?: StageSession) {
  const [enabled, setEnabled] = useState(false),
    [muted, setMuted] = useState(true),
    [error, setError] = useState("");
  const ctx = useRef<AudioContext | null>(null),
    master = useRef<GainNode | null>(null),
    music = useRef<HTMLAudioElement | null>(null),
    seen = useRef(""),
    musicRound = useRef(""),
    soundState = useRef(""),
    rollingSound = useRef<HTMLAudioElement | null>(null),
    winnerSound = useRef<HTMLAudioElement | null>(null);
  const volume = useRef(config.volume);
  volume.current = Math.max(0, Math.min(1, config.volume));
  const tone = useCallback((frequency: number, duration = 0.12, delay = 0) => {
    const c = ctx.current;
    if (!c || !master.current || c.state !== "running") return;
    const o = c.createOscillator(),
      g = c.createGain(),
      at = c.currentTime + delay;
    o.type = "sine";
    o.frequency.value = frequency;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.16, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, at + duration);
    o.connect(g).connect(master.current);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    o.start(at);
    o.stop(at + duration + 0.02);
  }, []);
  const activate = useCallback(async () => {
    try {
      if (!ctx.current || ctx.current.state === "closed") {
        ctx.current = new AudioContext();
        master.current = ctx.current.createGain();
        master.current.connect(ctx.current.destination);
      }
      await ctx.current.resume();
      if (ctx.current.state !== "running") throw new Error("audio suspended");
      master.current!.gain.value = volume.current;
      setEnabled(true);
      setMuted(false);
      setError("");
      tone(660);
    } catch {
      setError("声音未开启，请检查浏览器与扬声器设置");
    }
  }, [tone]);
  const test = useCallback(async () => {
    if (volume.current <= 0) {
      setError("当前音量为0，请先在主持台调高音量再试听");
      return false;
    }
    await activate();
    if (ctx.current?.state !== "running") return false;
    tone(523, 0.15);
    tone(659, 0.15, 0.2);
    tone(784, 0.25, 0.4);
    return true;
  }, [activate, tone]);
  useEffect(() => {
    if (!config.music) {
      music.current = null;
      return;
    }
    const a = new Audio(config.music);
    music.current = a;
    a.preload = "none";
    a.loop = true;
    a.onerror = () => setError("背景音乐加载失败，请检查音频文件");
    return () => {
      a.pause();
      a.removeAttribute("src");
      a.load();
      music.current = null;
    };
  }, [config.music]);
  useEffect(() => {
    if (master.current)
      master.current.gain.value = enabled && !muted ? volume.current : 0;
    const a = music.current;
    if (!a) return;
    musicRound.current = syncRollingMusic(a, musicRound.current, {
      phase: session?.phase ?? "idle",
      roundId: session?.roundId ?? "",
      enabled,
      muted,
      volume: volume.current,
      onError: () => setError("音乐未播放，请点击开启声音后重试"),
    });
  }, [enabled, muted, config.music, config.volume, session?.phase, session?.roundId]);
  useEffect(() => {
    const rolling = new Audio("/campaign/sounds/rolling.mp3");
    const winner = new Audio("/campaign/sounds/winner.mp3");
    rolling.preload = winner.preload = "auto";
    rollingSound.current = rolling;
    winnerSound.current = winner;
    return () => { rolling.pause(); winner.pause(); rollingSound.current = null; winnerSound.current = null; };
  }, []);
  useEffect(() => {
    if (!rollingSound.current || !winnerSound.current) return;
    soundState.current = updateStageSounds(rollingSound.current, winnerSound.current, soundState.current, {
      phase: session?.phase ?? "idle", roundId: session?.roundId ?? "", replay: session?.replay ?? 0,
      enabled, muted, volume: volume.current,
      onError: () => setError("音效未播放，请检查大屏声音设置"),
    });
  }, [session?.phase, session?.roundId, session?.replay, enabled, muted, config.volume]);
  useEffect(() => {
    const key = session
      ? `${session.roundId}:${session.phase}:${session.replay}`
      : "";
    if (!key || !enabled || muted || !session) return;
    const newPhase = key !== seen.current;
    seen.current = key;
    if (session.phase === "rolling") {
      if (newPhase && config.countdown && session.startedAt) {
        const elapsed = Math.max(
          0,
          (Date.now() - Date.parse(session.startedAt)) / 1000,
        );
        for (let i = 0; i < 3; i++)
          if (i >= elapsed - 0.3)
            tone(i === 2 ? 880 : 440, 0.14, Math.max(0, i - elapsed));
      }
    }
    if (newPhase && session.phase === "decelerating") {
      tone(520, 0.14);
      tone(660, 0.16, 0.2);
    }
  }, [
    session?.roundId,
    session?.phase,
    session?.replay,
    enabled,
    muted,
    config.countdown,
    tone,
  ]);
  useEffect(
    () => () => {
      music.current?.pause();
      void ctx.current?.close();
    },
    [],
  );
  return {
    enabled,
    muted,
    error,
    activate,
    toggleMute: useCallback(() => setMuted((v) => !v), []),
    test,
  };
}
export function resultLines(
  view: Pick<StageView, "name" | "showCompany" | "showStore"> &
    Partial<Pick<StageView, "rounds" | "session">>,
  round?: StageRound | null,
) {
  const allWallWinners = (view.rounds ?? []).flatMap((r) =>
    r.winners.filter((w) => !w.voided),
  );
  const pageCount = Math.max(1, Math.ceil(allWallWinners.length / 8));
  const safePage = Math.min(Math.max(0, view.session?.page ?? 0), pageCount - 1);
  const winners = round
    ? round.winners.filter((w) => !w.voided)
    : allWallWinners.slice(safePage * 8, (safePage + 1) * 8);
  return [
    view.name,
    round ? "幸运中奖名单" : `幸运中奖墙 · 第 ${safePage + 1} 页`,
    round
      ? new Date(round.createdAt).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
        })
      : "",
    ...(winners.flatMap((w, i) => [
      `${i + 1}. ${w.personName}  ·  ${w.giftName}`,
      [view.showCompany ? w.company : "", view.showStore ? w.store : ""]
        .filter(Boolean)
        .join(" / "),
    ]) ?? []),
  ];
}
export async function exportResultImage(
  view: StageView,
  round: StageRound | null = view.currentRound,
) {
  if (
    !(round ? round.winners : view.rounds.flatMap((r) => r.winners)).some(
      (w) => !w.voided,
    )
  )
    throw new Error("当前没有可导出的中奖结果");
  const lines = resultLines(view, round),
    canvas = document.createElement("canvas"),
    c = canvas.getContext("2d");
  if (!c) throw new Error("浏览器不支持结果图片导出");
  const font = '"PingFang SC","Microsoft YaHei",sans-serif';
  c.font = `24px ${font}`;
  const wrapped: { text: string; heading: boolean }[] = [];
  for (const [index, line] of lines.entries()) {
    const heading = index < 2;
    c.font = `${heading ? "bold 32" : "24"}px ${font}`;
    let part = "";
    for (const ch of line) {
      if (c.measureText(part + ch).width > 1040) {
        wrapped.push({ text: part, heading });
        part = "";
      }
      part += ch;
    }
    wrapped.push({ text: part, heading });
  }
  canvas.width = 1200;
  canvas.height = Math.max(700, wrapped.length * 48 + 170);
  c.fillStyle = "#e6f6ff";
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#ffffff";
  c.fillRect(40, 40, 1120, canvas.height - 80);
  wrapped.forEach((line, i) => {
    c.font = `${line.heading ? "bold 32" : "24"}px ${font}`;
    c.fillStyle = line.heading ? "#ed632b" : "#245674";
    c.fillText(line.text, 80, 110 + i * 48);
  });
  const blob = await new Promise<Blob>((r, j) =>
    canvas.toBlob(
      (b) => (b ? r(b) : j(new Error("图片生成失败"))),
      "image/png",
    ),
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `${view.name.replace(/[\\/:*?"<>|]/g, "_")}-中奖名单.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function rehearsalDraw(source: any, selection: StageSelection) {
  const a = structuredClone(source);
  a.rounds ??= [];
  const active = a.rounds
    .flatMap((r: any) => r.winners)
    .filter((w: any) => !w.voided);
  const eligible = a.people.filter(
    (p: any) =>
      p.enabled &&
      (a.allowRepeat || !active.some((w: any) => w.personId === p.id)) &&
      (!selection.scope?.company || p.company === selection.scope.company) &&
      (!selection.scope?.store || p.store === selection.scope.store) &&
      (!selection.scope?.checkedInOnly || p.checkedIn),
  );
  const stock = (g: any) =>
    g.total - active.filter((w: any) => w.giftId === g.id).length;
  const pick = (n: number) => {
    const space = 4294967296,
      limit = space - (space % n);
    let v;
    do {
      v = crypto.getRandomValues(new Uint32Array(1))[0];
    } while (v >= limit);
    return v % n;
  };
  let pairs: any[] = [];
  if (selection.mode === "single") {
    const p = eligible.find((p: any) => p.id === selection.personId);
    if (!p) throw new Error("请选择符合资格的彩排来宾");
    const gs = a.gifts.filter(
      (g: any) => g.enabled && g.singleEnabled && stock(g) > 0,
    );
    const sum = gs.reduce((n: number, g: any) => n + stock(g), 0);
    if (!sum) throw new Error("彩排礼品库存不足");
    let ticket = pick(sum);
    const g = gs.find((g: any) => (ticket -= stock(g)) < 0);
    pairs = [{ p, g }];
  } else {
    const g = a.gifts.find((g: any) => g.id === selection.giftId && g.enabled),
      count = selection.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 50)
      throw new Error("人数须为1–50");
    if (!g || stock(g) < count || eligible.length < count)
      throw new Error("彩排库存或资格人数不足");
    for (let i = 0; i < count; i++)
      pairs.push({ p: eligible.splice(pick(eligible.length), 1)[0], g });
  }
  const winners = pairs.map(({ p, g }) => ({
    id: crypto.randomUUID(),
    personId: p.id,
    personName: p.name,
    company: p.company ?? "",
    store: p.store ?? "",
    giftId: g.id,
    giftName: g.name,
    giftImage: g.image ?? "",
    voided: false,
  }));
  a.rounds.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    mode: selection.mode,
    winners,
  });
  return { activity: a, winners };
}
