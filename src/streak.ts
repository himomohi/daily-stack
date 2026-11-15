// Daily Stack — streak and best-time persistence (task 9).
// Every localStorage access is guarded: private mode, disabled storage or corrupt
// JSON must never break gameplay, it simply starts from an empty streak.

const KEY = 'daily-stack-v1';

export interface StreakState {
  streak: number;
  bestStreak: number;
  lastWinDate: string | null;
  totalWins: number;
  bestTimes: Record<string, number>;
}

function emptyState(): StreakState {
  return { streak: 0, bestStreak: 0, lastWinDate: null, totalWins: 0, bestTimes: {} };
}

/** Read a stored non-negative count, falling back to 0 for corrupt values. */
function readCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Keep only valid date -> milliseconds entries. */
function readTimes(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [key, time] of Object.entries(v as Record<string, unknown>)) {
      if (typeof time === 'number' && Number.isFinite(time) && time >= 0) out[key] = time;
    }
  }
  return out;
}

export function loadStreak(): StreakState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();

    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptyState();

    const o = data as Record<string, unknown>;
    return {
      streak: readCount(o.streak),
      bestStreak: readCount(o.bestStreak),
      lastWinDate: typeof o.lastWinDate === 'string' ? o.lastWinDate : null,
      totalWins: readCount(o.totalWins),
      bestTimes: readTimes(o.bestTimes),
    };
  } catch {
    return emptyState(); // storage blocked, quota exceeded, or malformed JSON
  }
}

function save(state: StreakState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the returned state is still correct for this session.
  }
}

/** True when the previous win was on the calendar day directly before `next`. */
function isDayBefore(prev: string | null, next: string): boolean {
  if (prev === null) return false;
  const a = Date.parse(`${prev}T00:00:00Z`);
  const b = Date.parse(`${next}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b - a === 86400000;
}

export function recordWin(
  dateKey: string,
  timeMs: number,
): StreakState & { isNewBest: boolean; alreadyWonToday: boolean } {
  const prev = loadStreak();
  const alreadyWonToday = prev.lastWinDate === dateKey;

  // Streak grows on consecutive days, stays put on a repeat win, resets otherwise.
  const streak = alreadyWonToday
    ? prev.streak
    : isDayBefore(prev.lastWinDate, dateKey)
      ? prev.streak + 1
      : 1;

  const time = Math.max(0, Math.round(Number.isFinite(timeMs) ? timeMs : 0));
  const previousBest: number | undefined = prev.bestTimes[dateKey];
  const isNewBest = previousBest === undefined || time < previousBest;

  const bestTimes = { ...prev.bestTimes };
  if (isNewBest) bestTimes[dateKey] = time;

  const next: StreakState = {
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    lastWinDate: dateKey,
    totalWins: prev.totalWins + (alreadyWonToday ? 0 : 1),
    bestTimes,
  };
  save(next);
  return { ...next, isNewBest, alreadyWonToday };
}

export function hasWonToday(dateKey: string): boolean {
  return loadStreak().lastWinDate === dateKey;
}
