import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReelTrack } from "../web/src/reels.ts";
test("滚轴展示真实礼品并准确停到服务端指定礼品", () => {
  const ids = ["cup", "case", "coffee"];
  const track = buildReelTrack(ids, "coffee", 6, 1);
  assert.ok(track.length > ids.length * 5);
  assert.equal(track.at(-1), "coffee");
  assert.deepEqual(new Set(track), new Set(ids));
});
test("零库存刚被抽中的目标也能加入展示，展示不会改变原奖池", () => {
  const ids = ["cup"];
  const track = buildReelTrack(ids, "last-prize", 6, 0);
  assert.equal(track.at(-1), "last-prize");
  assert.deepEqual(ids, ["cup"]);
});
test("空奖池不伪造礼品，单一礼品不会产生其他奖品", () => {
  assert.deepEqual(buildReelTrack([], undefined, 6, 0), []);
  assert.ok(buildReelTrack(["cup"], "cup", 6, 2).every((v) => v === "cup"));
});
