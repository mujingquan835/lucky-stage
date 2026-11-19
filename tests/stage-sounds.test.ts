import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateStageSounds } from '../web/src/stage-sounds.ts';

test('滚动音效循环，停止后播放一次中奖音效，静音后不重复播放', () => {
  const make = () => ({ currentTime: 4, volume: 0, loop: false, plays: 0, pauses: 0, play() { this.plays++; return Promise.resolve(); }, pause() { this.pauses++; } });
  const rolling = make(), winner = make();
  let previous = '';
  const apply = (phase: 'idle'|'rolling'|'decelerating'|'revealed', muted = false) => previous = updateStageSounds(rolling, winner, previous, {phase,roundId:'round-a',replay:0,enabled:true,muted,volume:.4});
  apply('idle'); assert.equal(rolling.plays,0); assert.equal(winner.plays,0);
  apply('rolling'); assert.equal(rolling.loop,true); assert.equal(rolling.currentTime,0); assert.equal(rolling.plays,1);
  apply('decelerating'); assert.ok(rolling.pauses>0); assert.equal(winner.plays,0);
  apply('revealed'); assert.equal(winner.plays,1); assert.equal(winner.currentTime,0);
  apply('revealed',true); apply('revealed'); assert.equal(winner.plays,1);
  apply('rolling'); assert.equal(rolling.plays,2); apply('revealed'); assert.equal(winner.plays,2);
});
