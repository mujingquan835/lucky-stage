import type { StagePhase } from '../../shared/stage';
type Player = Pick<HTMLAudioElement, 'currentTime' | 'volume' | 'loop' | 'play' | 'pause'>;
type State = { phase: StagePhase; roundId: string; replay: number; enabled: boolean; muted: boolean; volume: number; onError?: () => void };
export function updateStageSounds(rolling: Player, winner: Player, previous: string, state: State): string {
  const key = state.roundId ? `${state.roundId}:${state.phase}:${state.replay}` : '';
  const active = state.enabled && !state.muted;
  const changed = key !== previous;
  rolling.loop = true;
  rolling.volume = winner.volume = Math.max(0, Math.min(1, state.volume));
  if (state.phase === 'rolling' && key) {
    if (changed) rolling.currentTime = 0;
    if (active) void rolling.play().catch(() => state.onError?.());
    else rolling.pause();
  } else rolling.pause();
  if (!active) winner.pause();
  if (state.phase === 'revealed' && key && changed && previous && active) {
    winner.currentTime = 0;
    void winner.play().catch(() => state.onError?.());
  }
  return key;
}
