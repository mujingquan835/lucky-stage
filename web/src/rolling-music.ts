import type { StagePhase } from '../../shared/stage';

type Player = Pick<HTMLAudioElement, 'currentTime' | 'volume' | 'play' | 'pause'>;
type State = { phase: StagePhase; roundId: string; enabled: boolean; muted: boolean; volume: number; onError?: () => void };

export function syncRollingMusic(audio: Player, previous: string, state: State): string {
  const key = state.phase === 'rolling' && state.roundId ? state.roundId : '';
  audio.volume = Math.max(0, Math.min(1, state.volume));
  if (key && key !== previous) audio.currentTime = 0;
  if (key && state.enabled && !state.muted) void audio.play().catch(() => state.onError?.());
  else audio.pause();
  return key;
}
