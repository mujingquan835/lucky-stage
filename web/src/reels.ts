/** 展示序列不产生随机结果；终点只能来自服务端回执。 */
export function buildReelTrack(
  ids: string[],
  targetId?: string,
  laps = 8,
  column = 0,
): string[] {
  const pool = [...new Set(ids)].slice(0, 12);
  if (targetId && !pool.includes(targetId)) pool.push(targetId);
  if (!pool.length) return [];
  const track: string[] = [];
  for (let i = 0; i < Math.max(3, laps) * pool.length; i++)
    track.push(pool[(i + column) % pool.length]);
  track.push(targetId ?? pool[column % pool.length]);
  return track;
}
export const REVEAL_MS = 4600;
