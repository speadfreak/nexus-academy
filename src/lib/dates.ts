/** Local-timezone "YYYY-MM-DD" for a date. Used for streak day comparisons. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local-midnight start / next-midnight end for a date. */
export function localDayWindow(date: Date): {
  date: string;
  startMs: number;
  endMs: number;
} {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { date: localDateKey(date), startMs: start.getTime(), endMs: end.getTime() };
}

/** Last n days ending today, oldest first — for the weekly activity strip. */
export function lastNDayWindows(n: number) {
  const days: { date: string; startMs: number; endMs: number }[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    days.push(localDayWindow(day));
  }
  return days;
}

/** Compact relative timestamp: "just now", "5m", "3h", "2d", then a date. */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Full clock time, e.g. "14:03". */
export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** MM:SS from a seconds count. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
