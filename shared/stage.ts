export type Scene = "welcome" | "gifts" | "draw" | "winners" | "end";
export const drawModeLabels = {
  batch: {
    title: "按奖项抽人",
    scene: "适用于年会盛典、发布会、商业活动现场",
    description: "定奖抽人：先选本轮奖品和名额，从名单随机抽中奖者，适用于年会盛典、发布会、商业活动现场。",
  },
  single: {
    title: "按人抽礼品",
    scene: "适用于门店回馈、成交有礼、VIP 对客活动",
    description: "定人抽礼：先选一位到场来宾，从奖池随机抽一份礼品，适用于门店回馈、成交有礼、VIP 对客活动。",
  },
} as const;
export type StagePhase = "idle" | "rolling" | "decelerating" | "revealed";
export type Scope = {
  salesperson?: string;
  company?: string;
  store?: string;
  checkedInOnly?: boolean;
};
export type StageConfig = {
  animation: "reels" | "names" | "photos";
  countdown: boolean;
  celebrate: boolean;
  volume: number;
  music: string;
  welcomeText: string;
  endText: string;
};
export type StageSession = {
  version: number;
  scene: Scene;
  phase: StagePhase;
  roundId: string | null;
  startedAt: string | null;
  revealAt: string | null;
  deadline: string | null;
  page: number;
  replay: number;
  selection: StageSelection | null;
};
export type StageSelection = {
  mode: "single" | "batch";
  personId?: string;
  giftId?: string;
  count?: number;
  scope?: Scope;
  planId?: string;
  assignments?: StageAssignment[];
};
export type StageAssignment = { personId: string; giftId?: string };
export type RoundPlan = {
  id: string;
  name: string;
  giftId: string;
  count: number;
  order: number;
  completedRoundId?: string;
  assignedPersonIds?: string[];
};
export type StageCommand = {
  requestId: string;
  expectedVersion: number;
  action:
    | "scene"
    | "prepare"
    | "save-draft"
    | "start"
    | "stop"
    | "skip"
    | "replay"
    | "next"
    | "page"
    | "config";
  scene?: Scene;
  selection?: StageSelection;
  page?: number;
  roundId?: string;
  config?: Partial<StageConfig>;
  display?: Partial<{ color: string; background: string; brandImage: string; showCompany: boolean; showStore: boolean }>;
};
export type StageGift = {
  id: string;
  name: string;
  image: string;
  total: number;
  remaining: number;
  enabled: boolean;
  singleEnabled: boolean;
};
export type StageWinner = {
  personPhoto?: string;
  id: string;
  personName: string;
  company: string;
  store: string;
  giftName: string;
  giftImage: string;
  giftId: string;
  voided: boolean;
  claimed?: boolean;
};
export type StageRound = {
  id: string;
  mode: "single" | "batch";
  createdAt: string;
  winners: StageWinner[];
};
export type StageView = {
  hostDraft?: StageSelection | null;
  testMode?: boolean;
  id: string;
  name: string;
  subtitle: string;
  color: string;
  background: string;
  brandImage: string;
  archived: boolean;
  showCompany: boolean;
  showStore: boolean;
  serverNow: string;
  session: StageSession;
  config: StageConfig;
  gifts: StageGift[];
  rounds: StageRound[];
  currentRound: StageRound | null;
  preview: {
    mode: "single" | "batch";
    personName?: string;
    giftName?: string;
    count: number;
  } | null;
  participants: { id: string; name: string; company: string; store: string; photo?: string }[];
  plans: RoundPlan[];
  checkin?: {
    enabled: boolean;
    open: boolean;
    count: number;
    recent: { name: string; createdAt: number }[];
  };
};
export const defaultStageConfig = (): StageConfig => ({
  animation: "reels",
  countdown: true,
  celebrate: true,
  volume: 0.4,
  music: "",
  welcomeText: "欢迎来到燃动双11幸运现场",
  endText: "感谢相聚，让幸运继续",
});
export function usesPortraits(view: StageView | null) {
  const selection = view?.session.selection;
  return !!view && selection?.mode === "batch" &&
    (!!selection.giftId || view.config.animation === "photos");
}
export const defaultStageSession = (): StageSession => ({
  version: 0,
  scene: "welcome",
  phase: "idle",
  roundId: null,
  startedAt: null,
  revealAt: null,
  deadline: null,
  page: 0,
  replay: 0,
  selection: null,
});
