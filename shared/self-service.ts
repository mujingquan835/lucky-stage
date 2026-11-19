export type SelfConfig = { enabled: boolean; startsAt: string; endsAt: string };
export function maskText(value: string) {
  const chars = Array.from(value);
  if (!chars.length) return "";
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return chars[0] + "*";
  const n = Math.min(2, chars.length - 2),
    start = Math.floor((chars.length - n) / 2);
  return (
    chars.slice(0, start).join("") +
    "*".repeat(n) +
    chars.slice(start + n).join("")
  );
}
export type SelfWinner = {
  id: string;
  personName: string;
  store: string;
  giftName: string;
  giftImage: string;
  createdAt: string;
  voided: boolean;
};
export function nextSelfPage(winners: { id: string }[], seen: string[]) {
  const valid = new Set(winners.map((w) => w.id));
  let previous = seen.filter((id) => valid.has(id)),
    visited = new Set(previous);
  let pending = winners.filter((w) => !visited.has(w.id));
  if (!pending.length) {
    previous = [];
    pending = winners;
  }
  const ids = pending.slice(0, 12).map((w) => w.id);
  return { ids, seen: [...previous, ...ids] };
}
export type SpotlightState = {
  known: string[];
  done: string[];
  queue: string[];
};
export function syncSpotlights(
  state: SpotlightState | null,
  winners: { id: string }[],
): SpotlightState {
  const ids = winners.map((w) => w.id),
    valid = new Set(ids);
  if (!state) return { known: ids, done: ids, queue: [] };
  const known = new Set(state.known),
    fresh = ids.filter((id) => !known.has(id));
  return {
    known: [...state.known, ...fresh],
    done: state.done.filter((id) => valid.has(id)),
    queue: [...state.queue.filter((id) => valid.has(id)), ...fresh],
  };
}
export function finishSpotlight(state: SpotlightState): SpotlightState {
  const [head, ...queue] = state.queue;
  return {
    ...state,
    queue,
    done: head ? [...new Set([...state.done, head])] : state.done,
  };
}
