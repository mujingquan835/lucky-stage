/** The settings input is a Beijing wall-clock time; stored timestamps stay UTC. */
export function beijingToIso(value: string): string {
  return new Date(value + "+08:00").toISOString();
}

export function beijingInput(iso: string): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 16);
}

export function beijingDisplay(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(iso));
}
