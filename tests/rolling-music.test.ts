import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncRollingMusic } from '../web/src/rolling-music.ts';

test('音乐只在滚动时播放，每轮从头开始，暂停后可继续', async () => {
  let plays = 0, pauses = 0;
  const audio = { currentTime: 9, volume: 0, play: async () => { plays++; }, pause: () => { pauses++; } };
  let previous = '';
  previous = syncRollingMusic(audio, previous, { phase: 'idle', roundId: '', enabled: true, muted: false, volume: .5 });
  assert.equal(plays, 0);
  previous = syncRollingMusic(audio, previous, { phase: 'rolling', roundId: 'a', enabled: true, muted: false, volume: .5 });
  assert.equal(plays, 1); assert.equal(audio.currentTime, 0);
  audio.currentTime = 4;
  previous = syncRollingMusic(audio, previous, { phase: 'rolling', roundId: 'a', enabled: true, muted: true, volume: .5 });
  previous = syncRollingMusic(audio, previous, { phase: 'rolling', roundId: 'a', enabled: true, muted: false, volume: .5 });
  assert.equal(audio.currentTime, 4); assert.equal(plays, 2);
  previous = syncRollingMusic(audio, previous, { phase: 'revealed', roundId: 'a', enabled: true, muted: false, volume: .5 });
  assert.ok(pauses >= 2);
  previous = syncRollingMusic(audio, previous, { phase: 'rolling', roundId: 'b', enabled: true, muted: false, volume: .5 });
  assert.equal(audio.currentTime, 0); assert.equal(plays, 3);
});
